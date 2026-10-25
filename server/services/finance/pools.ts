// Allocation rules and valuation for savings pools. Pure functions: live linked
// data, prices, and stored allocations go in; capacities, validation errors,
// and pool values come out.
//
// Rules:
// - Pools are earmarks. They never add to net worth and never move money.
// - Dollars allocated from a bank account can't exceed the lower of its current
//   and available balance (available reflects pending debits).
// - Shares allocated from a holding can't exceed the shares held.
// - Dollars and shares allocated from one investment account together can't
//   exceed the account's value, so the same money is never earmarked twice.
// - A change that increases what's taken from a source must fit. A change that
//   reduces it is always allowed, even when the source is already short.
// - When a source shrinks below what's allocated (a balance drops, a price
//   falls), allocations are kept and valued pro rata, and flagged.

import {
  LIABILITY_CLASSES,
  type AssetClass,
  type InstitutionSummary,
  type LinkedAccount,
  type LinkedHolding,
} from "@shared/finance";
import type {
  Allocation,
  AllocationView,
  FundingSource,
  Pool,
  PoolView,
  UnallocatedByClass,
} from "@shared/pools";
import { accountValue } from "./overview";
import { addMonths, monthsUntil } from "./projections";

export { monthsUntil };

export interface PriceQuote {
  price: number;
  asOf: string;
  source: string;
}

const EPSILON = 0.005;
const round = (value: number) => Math.round(value * 100) / 100;
const roundShares = (value: number) => Math.round(value * 1e6) / 1e6;

const amountKey = (accountKey: string) => `amount:${accountKey}`;
const sharesKey = (accountKey: string, securityKey: string) => `shares:${accountKey}:${securityKey}`;

function accountLabel(account: LinkedAccount) {
  return `${account.name}${account.mask ? ` ••${account.mask}` : ""}`;
}

interface SourceIndex {
  sources: FundingSource[];
  byKey: Map<string, FundingSource>;
}

// Capacities only; `allocated` is filled in by applyAllocations.
export function buildFundingSources(
  accounts: LinkedAccount[],
  holdings: LinkedHolding[],
  quotes: Record<string, PriceQuote>
): FundingSource[] {
  const sources: FundingSource[] = [];
  for (const account of accounts) {
    if (LIABILITY_CLASSES.includes(account.assetClass)) continue;
    if (account.currency !== null && account.currency !== "USD") continue;
    const label = accountLabel(account);
    const isDepository = account.type === "depository";
    let capacity: number | null;
    let basis: string;
    if (isDepository) {
      const values = [account.currentBalance, account.availableBalance].filter((v): v is number => v !== null && Number.isFinite(v));
      capacity = values.length > 0 ? Math.min(...values) : null;
      basis = account.availableBalance !== null && account.currentBalance !== null
        ? "Lower of current and available balance (accounts for pending transactions)"
        : "Balance reported by the institution";
    } else {
      capacity = accountValue(account, holdings);
      basis = "Account value reported by the institution";
    }
    if (capacity === null) continue;
    sources.push({
      kind: "amount",
      accountKey: account.key,
      securityKey: null,
      itemId: account.itemId,
      label,
      institutionName: account.institutionName,
      assetClass: account.assetClass,
      symbol: null,
      capacity: round(Math.max(0, capacity)),
      allocated: 0,
      remaining: 0,
      price: null,
      priceSource: null,
      priceAsOf: null,
      basisPrice: null,
      basis,
    });

    if (isDepository) continue;
    for (const holding of holdings.filter((h) => h.accountKey === account.key)) {
      // Cash held in a brokerage is earmarked as dollars from the account instead.
      if (holding.isCashEquivalent || holding.quantity <= 0) continue;
      if (holding.currency !== null && holding.currency !== "USD") continue;
      const quote = holding.symbol ? quotes[holding.symbol] : undefined;
      const institutionPrice = holding.price ?? (holding.value !== null && holding.quantity > 0 ? holding.value / holding.quantity : null);
      sources.push({
        kind: "shares",
        accountKey: account.key,
        securityKey: holding.securityKey,
        itemId: account.itemId,
        label: `${holding.symbol ?? holding.name} in ${label}`,
        institutionName: account.institutionName,
        assetClass: account.assetClass,
        symbol: holding.symbol,
        capacity: roundShares(holding.quantity),
        allocated: 0,
        remaining: 0,
        price: quote?.price ?? institutionPrice,
        priceSource: quote ? quote.source : institutionPrice !== null ? "Institution-reported price" : null,
        priceAsOf: quote ? quote.asOf : holding.priceAsOf,
        basisPrice: institutionPrice ?? quote?.price ?? null,
        basis: "Shares held",
      });
    }
  }
  return sources;
}

// Fills in allocated/remaining for each source from a set of allocations.
export function applyAllocations(baseSources: FundingSource[], allocations: Allocation[]): SourceIndex {
  const sources = baseSources.map((s) => ({ ...s, allocated: 0, remaining: 0 }));
  const byKey = new Map<string, FundingSource>();
  for (const s of sources) {
    byKey.set(s.kind === "amount" ? amountKey(s.accountKey) : sharesKey(s.accountKey, s.securityKey!), s);
  }
  for (const a of allocations) {
    if (a.kind === "amount") {
      const source = byKey.get(amountKey(a.accountKey));
      if (source) source.allocated += a.amount;
    } else {
      const shareSource = byKey.get(sharesKey(a.accountKey, a.securityKey));
      if (!shareSource) continue;
      shareSource.allocated += a.shares;
      // Earmarked shares also use up their account's value, at the same
      // institution prices that value is based on.
      const accountSource = byKey.get(amountKey(a.accountKey));
      if (accountSource && shareSource.basisPrice !== null) accountSource.allocated += a.shares * shareSource.basisPrice;
    }
  }
  for (const s of sources) {
    s.allocated = s.kind === "amount" ? round(s.allocated) : roundShares(s.allocated);
    s.remaining = s.kind === "amount" ? round(Math.max(0, s.capacity - s.allocated)) : roundShares(Math.max(0, s.capacity - s.allocated));
  }
  return { sources, byKey };
}

// Checks a proposed set of allocations against live capacities. Only sources
// whose use goes up are checked, so a user can always reduce or remove an
// allocation even when a balance has already dropped below it.
export function validateAllocations(
  baseSources: FundingSource[],
  before: Allocation[],
  after: Allocation[]
): string[] {
  const errors: string[] = [];
  const prev = applyAllocations(baseSources, before);
  const next = applyAllocations(baseSources, after);
  const fingerprint = (a: Allocation) =>
    a.kind === "amount" ? `${a.poolId}|amount|${a.accountKey}|${a.amount}` : `${a.poolId}|shares|${a.accountKey}|${a.securityKey}|${a.shares}`;
  const unchanged = new Map(before.map((a) => [a.id, fingerprint(a)]));

  // New or edited allocations must point at a source that exists right now.
  for (const a of after) {
    if (unchanged.get(a.id) === fingerprint(a)) continue;
    const key = a.kind === "amount" ? amountKey(a.accountKey) : sharesKey(a.accountKey, a.securityKey);
    if (!next.byKey.has(key)) {
      errors.push(a.kind === "amount"
        ? "That account isn't available to allocate from right now. Refresh your linked accounts and try again."
        : "That holding isn't available to allocate from right now. Refresh your linked accounts and try again.");
    }
  }

  for (const source of next.sources) {
    const key = source.kind === "amount" ? amountKey(source.accountKey) : sharesKey(source.accountKey, source.securityKey!);
    const was = prev.byKey.get(key)?.allocated ?? 0;
    if (source.allocated <= was + EPSILON) continue;
    if (source.allocated > source.capacity + EPSILON) {
      const available = Math.max(0, source.capacity - was);
      errors.push(source.kind === "amount"
        ? `${source.label}: only $${round(available).toFixed(2)} is available to allocate (total allocated would be $${source.allocated.toFixed(2)} of $${source.capacity.toFixed(2)}).`
        : `${source.label}: only ${roundShares(available)} shares are available to allocate (would be ${source.allocated} of ${source.capacity}).`);
    }
  }
  return Array.from(new Set(errors));
}

// Months and date to cover `remaining` at `monthly` per month, with no growth.
export function completionEstimate(now: Date, remaining: number, monthly: number | null): { months: number; date: string } | null {
  if (remaining <= EPSILON) return { months: 0, date: now.toISOString().slice(0, 10) };
  if (!monthly || monthly <= 0) return null;
  const months = Math.ceil(remaining / monthly - 1e-9);
  return { months, date: addMonths(now, months) };
}

const STALE_PRICE_DAYS = 7;

// Verified quotes are fresh by construction; institution prices can lag.
function isStalePrice(source: FundingSource, now: Date): boolean {
  if (source.priceSource !== "Institution-reported price" || !source.priceAsOf) return false;
  const asOf = Date.parse(source.priceAsOf.length === 10 ? `${source.priceAsOf}T00:00:00Z` : source.priceAsOf);
  return Number.isFinite(asOf) && now.getTime() - asOf > STALE_PRICE_DAYS * 86_400_000;
}

export function valuePools(input: {
  now: Date;
  pools: Pool[];
  allocations: Allocation[];
  baseSources: FundingSource[];
  institutions: InstitutionSummary[];
}): { pools: PoolView[]; sources: FundingSource[] } {
  const { sources, byKey } = applyAllocations(input.baseSources, input.allocations);
  const institutionById = new Map(input.institutions.map((i) => [i.itemId, i]));
  const ratio = (source: FundingSource | undefined) =>
    source && source.allocated > source.capacity + EPSILON ? (source.allocated > 0 ? source.capacity / source.allocated : 0) : 1;

  const views: PoolView[] = input.pools.map((pool) => {
    const warnings = new Set<string>();
    const allocations: AllocationView[] = input.allocations
      .filter((a) => a.poolId === pool.id)
      .map((a): AllocationView => {
        const accountSource = byKey.get(amountKey(a.accountKey));
        const source = a.kind === "amount" ? accountSource : byKey.get(sharesKey(a.accountKey, a.securityKey));
        if (!source) {
          const institution = institutionById.get(a.itemId);
          const state = !institution ? "disconnected" : institution.status === "connected" ? "missing" : "unavailable";
          warnings.add(
            state === "disconnected"
              ? `${a.accountLabel} is no longer connected. Its allocation is kept but not counted.`
              : state === "unavailable"
                ? `${a.accountLabel} couldn't be refreshed, so its allocation isn't verified right now.`
                : `${a.kind === "shares" ? `${a.symbol ?? a.securityName} in ` : ""}${a.accountLabel} wasn't found in the latest data. Its allocation isn't counted.`
          );
          return {
            ...a, state, verifiedValue: 0,
            nominalValue: a.kind === "amount" ? a.amount : null,
            price: null, priceSource: null, priceAsOf: null,
          };
        }
        const effective = Math.min(ratio(source), a.kind === "shares" ? ratio(accountSource) : 1);
        const nominal = a.kind === "amount" ? a.amount : source.price !== null ? a.shares * source.price : null;
        if (effective < 1) {
          warnings.add(`${source.label} has less than is allocated to it across your pools, so this pool's share is reduced proportionally.`);
        }
        if (nominal === null) warnings.add(`${source.label} has no price right now, so its shares aren't valued.`);
        if (a.kind === "shares" && isStalePrice(source, input.now)) {
          warnings.add(`${source.label} is valued at a price from ${source.priceAsOf}, which may be out of date.`);
        }
        return {
          ...a,
          state: effective < 1 ? "over-allocated" : "verified",
          verifiedValue: nominal === null ? 0 : round(nominal * effective),
          nominalValue: nominal === null ? null : round(nominal),
          price: source.price,
          priceSource: source.priceSource,
          priceAsOf: source.priceAsOf,
        };
      });

    const verifiedTotal = round(allocations.reduce((sum, a) => sum + a.verifiedValue, 0));
    const unverifiedAmount = round(allocations
      .filter((a) => a.state === "disconnected" || a.state === "unavailable" || a.state === "missing")
      .reduce((sum, a) => sum + (a.nominalValue ?? 0), 0));
    const remaining = round(Math.max(0, pool.targetAmount - verifiedTotal));
    const estimate = completionEstimate(input.now, remaining, pool.monthlyContributionGoal);
    let requiredMonthly: number | null = null;
    if (pool.targetDate && remaining > EPSILON) {
      const months = monthsUntil(input.now, pool.targetDate);
      if (months === 0) {
        warnings.add("The target date has arrived or passed and the pool isn't fully funded.");
      } else {
        requiredMonthly = round(remaining / months);
        if (pool.monthlyContributionGoal !== null && pool.monthlyContributionGoal + EPSILON < requiredMonthly) {
          warnings.add(`At your monthly goal this pool won't reach its target by ${pool.targetDate}; that would take about $${requiredMonthly.toFixed(2)} a month.`);
        }
      }
    }
    return {
      ...pool,
      allocations,
      verifiedTotal,
      unverifiedAmount,
      progressPercent: pool.targetAmount > 0 ? Math.min(100, round((verifiedTotal / pool.targetAmount) * 100)) : 0,
      remaining,
      estimatedCompletion: remaining > EPSILON ? estimate?.date ?? null : null,
      monthsToComplete: remaining > EPSILON ? estimate?.months ?? null : 0,
      requiredMonthly,
      warnings: Array.from(warnings),
    };
  });

  return { pools: views, sources };
}

// How much of each asset class is earmarked. Totals are what can be earmarked
// (account-level capacity), so they can differ slightly from net-worth balances.
export function unallocatedByClass(sources: FundingSource[]): UnallocatedByClass[] {
  const byClass = new Map<AssetClass, UnallocatedByClass>();
  for (const s of sources) {
    if (s.kind !== "amount") continue;
    const row = byClass.get(s.assetClass) ?? { assetClass: s.assetClass, total: 0, allocated: 0, unallocated: 0 };
    row.total += s.capacity;
    row.allocated += Math.min(s.allocated, s.capacity);
    byClass.set(s.assetClass, row);
  }
  const order: AssetClass[] = ["cash", "savings", "term-deposit", "taxable-investment", "retirement", "restricted", "other"];
  return order
    .map((c) => byClass.get(c))
    .filter((r): r is UnallocatedByClass => Boolean(r))
    .map((r) => ({ ...r, total: round(r.total), allocated: round(r.allocated), unallocated: round(Math.max(0, r.total - r.allocated)) }));
}

