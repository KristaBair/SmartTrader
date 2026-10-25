// Normalizes Plaid accounts and holdings into the app's LinkedAccount /
// LinkedHolding shapes, classifies each account by how its money can be used,
// and removes accounts that appear in more than one Plaid connection.

import { createHash } from "node:crypto";
import type { AssetClass, LinkedAccount, LinkedHolding } from "@shared/finance";

const RETIREMENT_SUBTYPES = new Set([
  "401a", "401k", "403b", "457b", "ira", "roth", "roth 401k", "sep ira", "simple ira",
  "sarsep", "pension", "profit sharing plan", "retirement", "keogh", "thrift savings plan",
  "rrsp", "rrif", "lira", "lif", "lrif", "lrsp", "prif", "rlif", "sipp", "qshr",
  "fixed annuity", "variable annuity", "other annuity",
]);
const RESTRICTED_SUBTYPES = new Set([
  "529", "education savings account", "hsa", "health reimbursement arrangement", "resp",
  "rdsp", "ugma", "utma", "stock plan", "trust", "life insurance", "other insurance", "ebt",
]);
const SAVINGS_SUBTYPES = new Set(["savings", "money market"]);
const CASH_SUBTYPES = new Set(["checking", "cash management", "paypal", "prepaid"]);

export function classifyAccount(type: string, subtype: string | null): AssetClass {
  const t = type.toLowerCase();
  const s = (subtype ?? "").toLowerCase();
  if (t === "credit") return "credit";
  if (t === "loan") return "loan";
  if (t === "depository") {
    if (s === "cd") return "term-deposit";
    if (s === "hsa") return "restricted";
    if (SAVINGS_SUBTYPES.has(s)) return "savings";
    if (CASH_SUBTYPES.has(s)) return "cash";
    // Unknown depository subtypes are treated as spendable cash.
    return "cash";
  }
  if (t === "investment" || t === "brokerage") {
    if (RETIREMENT_SUBTYPES.has(s)) return "retirement";
    if (RESTRICTED_SUBTYPES.has(s)) return "restricted";
    return "taxable-investment";
  }
  return "other";
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);

// Plaid's account_id changes when an institution is linked again. Prefer the
// persistent ID when the institution provides one; otherwise fingerprint the
// account's stable descriptive fields within its institution.
export function accountKey(input: {
  institutionId: string | null;
  persistentAccountId: string | null;
  accountId: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  name: string;
}): string {
  if (input.persistentAccountId) return `pa_${hash(`${input.institutionId ?? ""}|${input.persistentAccountId}`)}`;
  if (input.institutionId && input.mask) {
    return `fp_${hash([input.institutionId, input.type, input.subtype ?? "", input.mask, input.name.trim().toLowerCase()].join("|"))}`;
  }
  // Without an institution and mask there is nothing stable to match on.
  return `id_${hash(input.accountId)}`;
}

// Plaid security_id is stable for a security; fall back to public identifiers.
export function securityKey(input: {
  securityId: string;
  isin: string | null;
  cusip: string | null;
  ticker: string | null;
}): string {
  if (input.isin) return `isin_${input.isin}`;
  if (input.cusip) return `cusip_${input.cusip}`;
  if (input.ticker) return `tkr_${input.ticker.toUpperCase()}`;
  return `sec_${input.securityId}`;
}

// ── Plaid response shapes (only the fields we use) ──────────────────────────

export interface PlaidAccountInput {
  account_id: string;
  persistent_account_id?: string | null;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string;
  subtype?: string | null;
  balances: {
    current: number | null;
    available: number | null;
    iso_currency_code?: string | null;
    unofficial_currency_code?: string | null;
  };
}

export interface PlaidSecurityInput {
  security_id: string;
  isin?: string | null;
  cusip?: string | null;
  ticker_symbol?: string | null;
  name?: string | null;
  type?: string | null;
  is_cash_equivalent?: boolean | null;
  iso_currency_code?: string | null;
}

export interface PlaidHoldingInput {
  account_id: string;
  security_id: string;
  quantity: number;
  institution_price?: number | null;
  institution_price_as_of?: string | null;
  institution_value?: number | null;
  cost_basis?: number | null;
  iso_currency_code?: string | null;
}

export interface NormalizedItem {
  accounts: LinkedAccount[];
  holdings: LinkedHolding[];
}

export function normalizeItem(input: {
  itemId: string;
  institutionId: string | null;
  institutionName: string;
  retrievedAt: string;
  accounts: PlaidAccountInput[];
  holdings: PlaidHoldingInput[];
  securities: PlaidSecurityInput[];
}): NormalizedItem {
  const keyByAccountId = new Map<string, string>();
  const accounts: LinkedAccount[] = input.accounts.map((account) => {
    const key = accountKey({
      institutionId: input.institutionId,
      persistentAccountId: account.persistent_account_id ?? null,
      accountId: account.account_id,
      type: account.type,
      subtype: account.subtype ?? null,
      mask: account.mask ?? null,
      name: account.name,
    });
    keyByAccountId.set(account.account_id, key);
    return {
      key,
      itemId: input.itemId,
      institutionName: input.institutionName,
      name: account.official_name || account.name,
      mask: account.mask ?? null,
      type: account.type,
      subtype: account.subtype ?? null,
      assetClass: classifyAccount(account.type, account.subtype ?? null),
      currentBalance: account.balances.current,
      availableBalance: account.balances.available,
      currency: account.balances.iso_currency_code || account.balances.unofficial_currency_code || null,
      retrievedAt: input.retrievedAt,
    };
  });

  const securities = new Map(input.securities.map((s) => [s.security_id, s]));
  // Positions in the same security within one account are combined.
  const holdingsByKey = new Map<string, LinkedHolding>();
  for (const holding of input.holdings) {
    const acctKey = keyByAccountId.get(holding.account_id);
    if (!acctKey) continue;
    const security = securities.get(holding.security_id);
    const secKey = securityKey({
      securityId: holding.security_id,
      isin: security?.isin ?? null,
      cusip: security?.cusip ?? null,
      ticker: security?.ticker_symbol ?? null,
    });
    const price = holding.institution_price ?? null;
    const value = holding.institution_value ?? (price === null ? null : holding.quantity * price);
    const key = `${acctKey}:${secKey}`;
    const existing = holdingsByKey.get(key);
    if (existing) {
      existing.quantity += holding.quantity;
      existing.value = existing.value === null || value === null ? null : existing.value + value;
      existing.costBasis = existing.costBasis === null || holding.cost_basis == null
        ? null
        : existing.costBasis + holding.cost_basis;
      continue;
    }
    holdingsByKey.set(key, {
      key,
      accountKey: acctKey,
      securityKey: secKey,
      symbol: security?.ticker_symbol?.trim().toUpperCase() || null,
      name: security?.name || "Unnamed security",
      securityType: security?.type ?? null,
      isCashEquivalent: Boolean(security?.is_cash_equivalent) || security?.type === "cash",
      quantity: holding.quantity,
      price,
      priceAsOf: holding.institution_price_as_of ?? null,
      value,
      costBasis: holding.cost_basis ?? null,
      currency: holding.iso_currency_code || security?.iso_currency_code || null,
    });
  }

  return { accounts, holdings: Array.from(holdingsByKey.values()) };
}

export interface DedupeResult extends NormalizedItem {
  // Accounts dropped because the same account came from another connection.
  duplicateAccountCount: number;
}

// The same account can arrive through two Plaid connections (for example, one
// linked for investments and one for spending). Keep one copy per account key:
// the connection that returned holdings for it, then the most recently
// retrieved, then the lowest item ID so the choice is deterministic.
export function dedupeLinkedAccounts(items: NormalizedItem[]): DedupeResult {
  const candidates = items.flatMap((item) =>
    item.accounts.map((account) => ({
      account,
      holdings: item.holdings.filter((h) => h.accountKey === account.key),
    }))
  );
  const chosen = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const current = chosen.get(candidate.account.key);
    if (!current || isPreferred(candidate, current)) chosen.set(candidate.account.key, candidate);
  }
  const kept = Array.from(chosen.values());
  return {
    accounts: kept.map((c) => c.account),
    holdings: kept.flatMap((c) => c.holdings),
    duplicateAccountCount: candidates.length - kept.length,
  };
}

function isPreferred(
  a: { account: LinkedAccount; holdings: LinkedHolding[] },
  b: { account: LinkedAccount; holdings: LinkedHolding[] }
): boolean {
  if ((a.holdings.length > 0) !== (b.holdings.length > 0)) return a.holdings.length > 0;
  if (a.account.retrievedAt !== b.account.retrievedAt) return a.account.retrievedAt > b.account.retrievedAt;
  return a.account.itemId < b.account.itemId;
}
