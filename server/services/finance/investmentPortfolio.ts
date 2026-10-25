import type {
  ConsolidatedInvestmentPosition,
  InvestmentAccountPosition,
  LinkedAccount,
  LinkedHolding,
  ManualHoldingLine,
  ManualInvestmentEntry,
  SecurityCategory,
} from "@shared/finance";

const round = (value: number) => Math.round(value * 100) / 100;
const roundShares = (value: number) => Math.round(value * 1e6) / 1e6;

function classifySecurity(securityType: string | null, isCashEquivalent: boolean): SecurityCategory {
  if (isCashEquivalent) return "cash-equivalent";
  const type = (securityType ?? "").trim().toLowerCase();
  if (!type) return "unknown";
  if (type.includes("etf")) return "etf";
  if (type.includes("mutual fund")) return "mutual-fund";
  if (type.includes("bond") || type.includes("fixed income")) return "bond";
  if (type.includes("equity") || type.includes("stock")) return "stock";
  return "other";
}

interface MutablePosition {
  id: string;
  symbol: string | null;
  name: string;
  securityType: string | null;
  securityCategory: SecurityCategory;
  isCashEquivalent: boolean;
  currency: string | null;
  linkedPositions: InvestmentAccountPosition[];
  manualEntries: ManualInvestmentEntry[];
}

function priceIsStale(priceAsOf: string | null, now: Date): boolean {
  if (!priceAsOf) return false;
  const timestamp = Date.parse(priceAsOf.length === 10 ? `${priceAsOf}T00:00:00Z` : priceAsOf);
  return Number.isFinite(timestamp) && now.getTime() - timestamp > 7 * 86_400_000;
}

function finalize(position: MutablePosition): ConsolidatedInvestmentPosition {
  const countedManual = position.manualEntries.filter((entry) => entry.status === "counted");
  const values = [
    ...position.linkedPositions.map((entry) => entry.marketValue),
    ...countedManual.map((entry) => entry.marketValue),
  ];
  const knownValues = values.filter((value): value is number => value !== null);
  const costs = position.linkedPositions.map((entry) => entry.costBasis);
  const knownCosts = costs.filter((value): value is number => value !== null);

  return {
    id: position.id,
    symbol: position.symbol,
    name: position.name,
    securityType: position.securityType,
    securityCategory: position.securityCategory,
    isCashEquivalent: position.isCashEquivalent,
    currency: position.currency,
    shares: roundShares(
      position.linkedPositions.reduce((sum, entry) => sum + entry.shares, 0)
      + countedManual.reduce((sum, entry) => sum + entry.shares, 0)
    ),
    marketValue: knownValues.length > 0 ? round(knownValues.reduce((sum, value) => sum + value, 0)) : null,
    valueComplete: values.length > 0 && knownValues.length === values.length,
    costBasis: knownCosts.length > 0 ? round(knownCosts.reduce((sum, value) => sum + value, 0)) : null,
    costBasisComplete:
      position.linkedPositions.length > 0
      && knownCosts.length === position.linkedPositions.length
      && countedManual.length === 0
      && !position.manualEntries.some((entry) => entry.status === "needs-review"),
    source:
      position.linkedPositions.length > 0 && position.manualEntries.length > 0
        ? "mixed"
        : position.linkedPositions.length > 0
          ? "linked"
          : "manual",
    linkedPositions: position.linkedPositions,
    manualEntries: position.manualEntries,
  };
}

/**
 * Groups linked positions by their stable security key while preserving the
 * account-level records. Manual positions are added only when the saved
 * reconciliation choice says they are separate; unresolved and duplicate
 * entries remain visible but never inflate the consolidated value.
 */
export function buildInvestmentPortfolio(input: {
  accounts: LinkedAccount[];
  holdings: LinkedHolding[];
  manualHoldings: ManualHoldingLine[];
  now?: Date;
}): ConsolidatedInvestmentPosition[] {
  const now = input.now ?? new Date();
  const accountByKey = new Map(input.accounts.map((account) => [account.key, account]));
  const groups = new Map<string, MutablePosition>();

  for (const holding of input.holdings) {
    const account = accountByKey.get(holding.accountKey);
    if (!account) continue;
    const currency = holding.currency ?? account.currency;
    const currencyKey = currency ?? "unknown";
    const id = `${holding.securityKey}:${currencyKey}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        symbol: holding.symbol,
        name: holding.name,
        securityType: holding.securityType,
        securityCategory: classifySecurity(holding.securityType, holding.isCashEquivalent),
        isCashEquivalent: holding.isCashEquivalent,
        currency,
        linkedPositions: [],
        manualEntries: [],
      };
      groups.set(id, group);
    }
    group.linkedPositions.push({
      accountKey: account.key,
      itemId: account.itemId,
      institutionName: account.institutionName,
      accountName: account.name,
      accountMask: account.mask,
      accountClass: account.assetClass,
      accountType: account.type,
      accountSubtype: account.subtype,
      shares: holding.quantity,
      marketValue: holding.value,
      costBasis: holding.costBasis,
      currency,
      reportedPrice: holding.price,
      priceAsOf: holding.priceAsOf,
      retrievedAt: account.retrievedAt,
      stalePrice: priceIsStale(holding.priceAsOf, now),
    });
  }

  for (const manual of input.manualHoldings) {
    const symbol = manual.symbol.trim().toUpperCase();
    const matches = Array.from(groups.values()).filter(
      (group) => group.symbol?.toUpperCase() === symbol && group.currency === "USD"
    );
    // Attach only when the match is unambiguous. Otherwise keep the manual
    // entry separate instead of merging it into the wrong security.
    const target = matches.length === 1 ? matches[0] : undefined;
    const id = `manual:${symbol}`;
    const group = target ?? groups.get(id) ?? {
      id,
      symbol,
      name: manual.name,
      securityType: null,
      securityCategory: "unknown",
      isCashEquivalent: false,
      currency: "USD",
      linkedPositions: [],
      manualEntries: [],
    };
    if (!target) groups.set(id, group);
    group.manualEntries.push({
      name: manual.name,
      shares: manual.shares,
      currentPrice: manual.price,
      marketValue: manual.value,
      priceAsOf: manual.priceAsOf,
      status: manual.status,
    });
  }

  return Array.from(groups.values())
    .map(finalize)
    .sort((a, b) => {
      const left = a.marketValue ?? -1;
      const right = b.marketValue ?? -1;
      return right - left || (a.symbol ?? a.name).localeCompare(b.symbol ?? b.name);
    });
}
