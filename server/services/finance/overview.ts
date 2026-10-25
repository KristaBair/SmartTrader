// Builds the unified financial overview from live linked data, the user's manual
// entries, and their reconciliation choices. Pure: every input is passed in, so
// the counting rules can be tested without Plaid or DynamoDB.
//
// Counting rules (applied in this order, never by the AI):
// 1. Linked accounts are de-duplicated across connections before this runs.
// 2. Only USD balances are counted; others are listed and excluded.
// 3. A manual holding whose ticker also appears in a linked account is left out
//    until the user marks it "separate". Without that choice the linked
//    position is assumed to be the same holding, so net worth is never inflated.
// 4. Manual cash is left out once any bank account is linked, until the user
//    marks it "separate", for the same reason.
// 5. Manual holdings without a verified price are listed but not valued.
// 6. Liabilities are linked credit/loan balances plus manually entered debts.

import {
  LIABILITY_CLASSES,
  type CashFlowSummary,
  type DataNotice,
  type FinancialOverview,
  type FinancialTotals,
  type InstitutionSummary,
  type LinkedAccount,
  type LinkedHolding,
  type ManualCashLine,
  type ManualHoldingLine,
  type ManualLiability,
  type ReconciliationDecisions,
} from "@shared/finance";

export interface ManualPortfolioInput {
  cash: number;
  investments: { symbol: string; name: string; shares: number }[];
}

export interface VerifiedPrice {
  price: number;
  asOf: string;
}

export interface OverviewInput {
  generatedAt: string;
  institutions: InstitutionSummary[];
  accounts: LinkedAccount[];
  holdings: LinkedHolding[];
  duplicateAccountCount: number;
  manualPortfolio: ManualPortfolioInput | null;
  manualPrices: Record<string, VerifiedPrice>;
  manualLiabilities: ManualLiability[];
  decisions: ReconciliationDecisions;
  cashFlow: CashFlowSummary | null;
  plaidConfigured: boolean;
}

const round = (value: number) => Math.round(value * 100) / 100;
const isUsd = (currency: string | null) => currency === null || currency === "USD";

// An account's value for net worth: the institution's current balance, or the
// sum of its holdings when the institution reports no balance.
export function accountValue(account: LinkedAccount, holdings: LinkedHolding[]): number | null {
  if (account.currentBalance !== null && Number.isFinite(account.currentBalance)) return account.currentBalance;
  const values = holdings.filter((h) => h.accountKey === account.key).map((h) => h.value);
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return values.reduce<number>((sum, v) => sum + (v as number), 0);
}

// Rule 4: manual cash is left out once a bank account is linked, until the
// user says it's separate. Shared with the emergency-fund planner.
export function manualCashLine(amount: number, accounts: LinkedAccount[], decisions: ReconciliationDecisions): ManualCashLine | null {
  if (amount <= 0) return null;
  const hasLinkedCash = accounts.some((a) => a.assetClass === "cash" || a.assetClass === "savings");
  const status: ManualCashLine["status"] = decisions.cash === "duplicate"
    ? "duplicate"
    : hasLinkedCash && decisions.cash !== "separate" ? "needs-review" : "counted";
  return { amount, status, overlapsLinked: hasLinkedCash };
}

export function buildFinancialOverview(input: OverviewInput): FinancialOverview {
  const notices: DataNotice[] = [];
  const totals: FinancialTotals = {
    assets: 0, liabilities: 0, netWorth: 0, cash: 0, savings: 0, termDeposits: 0,
    taxableInvestments: 0, retirement: 0, restricted: 0, other: 0, manualEstimates: 0,
  };

  // ── Linked accounts ──
  const nonUsd: string[] = [];
  const noBalance: string[] = [];
  for (const account of input.accounts) {
    const label = `${account.name}${account.mask ? ` ••${account.mask}` : ""}`;
    if (!isUsd(account.currency)) {
      nonUsd.push(label);
      continue;
    }
    const value = accountValue(account, input.holdings);
    if (value === null) {
      noBalance.push(label);
      continue;
    }
    if (LIABILITY_CLASSES.includes(account.assetClass)) {
      totals.liabilities += value;
      continue;
    }
    totals.assets += value;
    switch (account.assetClass) {
      case "cash": totals.cash += value; break;
      case "savings": totals.savings += value; break;
      case "term-deposit": totals.termDeposits += value; break;
      case "taxable-investment": totals.taxableInvestments += value; break;
      case "retirement": totals.retirement += value; break;
      case "restricted": totals.restricted += value; break;
      default: totals.other += value;
    }
  }

  // ── Manual holdings ──
  const linkedSymbols = new Set(input.holdings.map((h) => h.symbol).filter((s): s is string => Boolean(s)));
  const manualHoldings: ManualHoldingLine[] = (input.manualPortfolio?.investments ?? []).map((inv) => {
    const symbol = inv.symbol.trim().toUpperCase();
    const overlapsLinked = linkedSymbols.has(symbol);
    const decision = input.decisions.holdings[symbol];
    const quote = input.manualPrices[symbol];
    const value = quote ? round(inv.shares * quote.price) : null;
    let status: ManualHoldingLine["status"];
    if (decision === "duplicate") status = "duplicate";
    else if (overlapsLinked && decision !== "separate") status = "needs-review";
    else if (value === null) status = "unpriced";
    else status = "counted";
    return {
      symbol, name: inv.name, shares: inv.shares,
      price: quote?.price ?? null, priceAsOf: quote?.asOf ?? null, value, status, overlapsLinked,
    };
  });
  for (const line of manualHoldings) {
    if (line.status !== "counted" || line.value === null) continue;
    totals.assets += line.value;
    totals.taxableInvestments += line.value;
    totals.manualEstimates += line.value;
  }

  // ── Manual cash ──
  const manualCash = manualCashLine(input.manualPortfolio?.cash ?? 0, input.accounts, input.decisions);
  if (manualCash) {
    const manualCashAmount = manualCash.amount;
    if (manualCash.status === "counted") {
      totals.assets += manualCashAmount;
      totals.cash += manualCashAmount;
      totals.manualEstimates += manualCashAmount;
    }
  }

  // ── Manual liabilities ──
  for (const debt of input.manualLiabilities) totals.liabilities += debt.balance;

  for (const key of Object.keys(totals) as (keyof FinancialTotals)[]) totals[key] = round(totals[key]);
  totals.netWorth = round(totals.assets - totals.liabilities);

  // ── Notices: say exactly what is missing, stale, estimated, or excluded ──
  if (!input.plaidConfigured) {
    notices.push({ level: "warning", code: "PLAID_UNAVAILABLE", message: "Account linking is not configured, so only manually entered information is shown." });
  } else if (input.institutions.length === 0) {
    notices.push({ level: "info", code: "NO_LINKED_ACCOUNTS", message: "No accounts are linked yet. Totals include only what you entered by hand." });
  }
  for (const inst of input.institutions) {
    if (inst.status === "reauth-required") {
      notices.push({ level: "warning", code: "REAUTH_REQUIRED", message: `${inst.institutionName} needs to be reconnected. Its accounts are not included in these totals.` });
    } else if (inst.status === "error") {
      notices.push({ level: "warning", code: "INSTITUTION_UNAVAILABLE", message: `${inst.institutionName} could not be refreshed. Its accounts are not included in these totals.` });
    }
  }
  if (input.duplicateAccountCount > 0) {
    notices.push({ level: "info", code: "DUPLICATE_ACCOUNTS_REMOVED", message: `${input.duplicateAccountCount} account${input.duplicateAccountCount === 1 ? " appears" : "s appear"} in more than one connection and ${input.duplicateAccountCount === 1 ? "is" : "are"} counted once.` });
  }
  if (nonUsd.length > 0) {
    notices.push({ level: "warning", code: "NON_USD_EXCLUDED", message: `Not counted because no currency conversion is applied: ${nonUsd.join(", ")}.` });
  }
  if (noBalance.length > 0) {
    notices.push({ level: "warning", code: "BALANCE_UNAVAILABLE", message: `The institution did not report a balance for: ${noBalance.join(", ")}.` });
  }
  const review = manualHoldings.filter((h) => h.status === "needs-review").map((h) => h.symbol);
  if (manualCash?.status === "needs-review") review.unshift("manual cash");
  if (review.length > 0) {
    notices.push({ level: "warning", code: "RECONCILIATION_NEEDED", message: `Left out until you confirm whether they are separate from your linked accounts: ${review.join(", ")}.` });
  }
  const unpriced = manualHoldings.filter((h) => h.status === "unpriced").map((h) => h.symbol);
  if (unpriced.length > 0) {
    notices.push({ level: "warning", code: "UNPRICED_HOLDINGS", message: `No verified price, so not valued: ${unpriced.join(", ")}.` });
  }
  if (totals.manualEstimates > 0) {
    notices.push({ level: "info", code: "MANUAL_ESTIMATES", message: `$${totals.manualEstimates.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of your assets comes from information you entered, not a linked account.` });
  }
  notices.push({
    level: "info",
    code: "LIABILITIES_PARTIAL",
    message: "Debts include linked credit card and loan balances plus debts you enter. Loans at institutions you haven't linked are missing unless you add them.",
  });
  if (input.accounts.length > 0) {
    notices.push({ level: "info", code: "BALANCES_AS_REPORTED", message: "Linked balances are as last reported by each institution through Plaid and can lag recent or pending activity." });
  }

  return {
    generatedAt: input.generatedAt,
    currency: "USD",
    totals,
    institutions: input.institutions,
    accounts: input.accounts,
    holdings: input.holdings,
    manualHoldings,
    manualCash,
    manualLiabilities: input.manualLiabilities,
    decisions: input.decisions,
    cashFlow: input.cashFlow,
    spending: null,
    notices,
  };
}
