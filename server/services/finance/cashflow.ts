// Spending insights and emergency-fund planning from bank transactions.
// Pure: transactions, account balances, pools, and the user's preferences go
// in; nothing is stored or sent anywhere from here.
//
// Plaid sign convention: positive amounts are money leaving the account.

import type { LinkedAccount } from "@shared/finance";
import type { PoolView } from "@shared/pools";
import type {
  CategorySpend,
  EmergencyFundPlan,
  ExpenseClass,
  RecurringCharge,
  SavingsScenario,
  SpendingInsights,
  SpendingPrefs,
} from "@shared/cashflow";
import { addMonths, roundMoney } from "./projections";

export interface CashflowTransaction {
  date: string;
  amount: number;
  pending: boolean;
  primaryCategory: string;
  category: string;
  merchant: string;
}

const DAYS_PER_MONTH = 365.25 / 12;
const MS_PER_DAY = 86_400_000;

// ── Classification ──────────────────────────────────────────────────────────

const ESSENTIAL_DETAILED = new Set([
  "FOOD_AND_DRINK_GROCERIES",
  "TRANSPORTATION_GAS", "TRANSPORTATION_PUBLIC_TRANSIT", "TRANSPORTATION_TOLLS", "TRANSPORTATION_PARKING", "TRANSPORTATION_OTHER_TRANSPORTATION",
  "GENERAL_SERVICES_INSURANCE", "GENERAL_SERVICES_CHILDCARE", "GENERAL_SERVICES_EDUCATION", "GENERAL_SERVICES_AUTOMOTIVE",
  "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT", "GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES",
  "HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE", "HOME_IMPROVEMENT_SECURITY",
  "PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING",
]);
// Purchases that commonly mix necessities and extras; never assumed discretionary.
const MIXED_DETAILED = new Set([
  "GENERAL_MERCHANDISE_SUPERSTORES", "GENERAL_MERCHANDISE_DISCOUNT_STORES", "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
  "GENERAL_SERVICES_OTHER_GENERAL_SERVICES", "GENERAL_MERCHANDISE_CONVENIENCE_STORES",
]);
const SAVINGS_DETAILED = new Set(["TRANSFER_OUT_SAVINGS", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"]);
const ESSENTIAL_PRIMARY = new Set(["RENT_AND_UTILITIES", "MEDICAL"]);
const DISCRETIONARY_PRIMARY = new Set([
  "FOOD_AND_DRINK", "ENTERTAINMENT", "GENERAL_MERCHANDISE", "PERSONAL_CARE", "TRAVEL", "HOME_IMPROVEMENT",
  "TRANSPORTATION", "GENERAL_SERVICES", "GOVERNMENT_AND_NON_PROFIT",
]);

// Plaid's older category arrays use words like "Food and Drink" or "Transfer".
const LEGACY_PRIMARY: Record<string, string> = {
  "FOOD AND DRINK": "FOOD_AND_DRINK", TRAVEL: "TRAVEL", TRANSFER: "TRANSFER_OUT", PAYMENT: "LOAN_PAYMENTS",
  SHOPS: "GENERAL_MERCHANDISE", RECREATION: "ENTERTAINMENT", SERVICE: "GENERAL_SERVICES", HEALTHCARE: "MEDICAL",
  "BANK FEES": "BANK_FEES", COMMUNITY: "GOVERNMENT_AND_NON_PROFIT", TAX: "GOVERNMENT_AND_NON_PROFIT",
};

export function normalizePrimary(primary: string): string {
  const upper = primary.trim().toUpperCase();
  return LEGACY_PRIMARY[upper] ?? upper.replace(/\s+/g, "_");
}

export function defaultClass(primaryRaw: string, detailedRaw: string, amount: number): ExpenseClass {
  const primary = normalizePrimary(primaryRaw);
  const detailed = detailedRaw.trim().toUpperCase();
  if (primary === "INCOME") return "income";
  if (primary === "TRANSFER_IN") return "transfer";
  if (primary === "TRANSFER_OUT") return SAVINGS_DETAILED.has(detailed) ? "savings-contribution" : "transfer";
  if (primary === "LOAN_PAYMENTS") {
    // Paying a card moves money between the user's own accounts; the purchases
    // themselves are already counted when the card is linked.
    return detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" ? "transfer" : "debt-payment";
  }
  if (primary === "BANK_FEES") return "fee";
  if (ESSENTIAL_DETAILED.has(detailed) || ESSENTIAL_PRIMARY.has(primary)) return "essential";
  if (MIXED_DETAILED.has(detailed)) return "uncategorized";
  if (primary === "GENERAL_MERCHANDISE" && detailed === "GENERAL_MERCHANDISE_PHARMACIES") return "essential";
  if (DISCRETIONARY_PRIMARY.has(primary)) return "discretionary";
  // Unknown or "OTHER": money coming in is left out, money going out needs review.
  return amount < 0 ? "transfer" : "uncategorized";
}

const humanize = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function categoryLabel(primaryRaw: string, detailedRaw: string): string {
  const primary = normalizePrimary(primaryRaw);
  const detailed = detailedRaw.trim().toUpperCase();
  const rest = detailed.startsWith(`${primary}_`) ? detailed.slice(primary.length + 1) : detailed === primary ? "" : detailed;
  return rest ? `${humanize(primary)} · ${humanize(rest).toLowerCase()}` : humanize(primary);
}

export function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/#\s*\d+/g, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/[^a-z0-9&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function classify(t: CashflowTransaction, prefs: SpendingPrefs): { cls: ExpenseClass; overridden: boolean } {
  const merchantKey = normalizeMerchant(t.merchant);
  const byMerchant = merchantKey ? prefs.merchantOverrides[merchantKey] : undefined;
  if (byMerchant) return { cls: byMerchant, overridden: true };
  const byCategory = prefs.categoryOverrides[t.category.trim().toUpperCase()];
  if (byCategory) return { cls: byCategory, overridden: true };
  return { cls: defaultClass(t.primaryCategory, t.category, t.amount), overridden: false };
}

// ── Recurring charges ───────────────────────────────────────────────────────

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export function detectRecurring(transactions: { date: string; amount: number; merchant: string; cls: ExpenseClass }[]): RecurringCharge[] {
  const groups = new Map<string, { date: string; amount: number; cls: ExpenseClass; display: string }[]>();
  for (const t of transactions) {
    if (t.amount <= 0) continue;
    if (t.cls === "transfer" || t.cls === "income" || t.cls === "savings-contribution") continue;
    const key = normalizeMerchant(t.merchant);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), { date: t.date, amount: t.amount, cls: t.cls, display: t.merchant.trim() }]);
  }
  const results: RecurringCharge[] = [];
  for (const items of Array.from(groups.values())) {
    if (items.length < 2) continue;
    items.sort((a, b) => a.date.localeCompare(b.date));
    const intervals = items.slice(1).map((it, i) => daysBetween(items[i].date, it.date)).filter((d) => d > 0);
    if (intervals.length === 0) continue;
    const typical = median(intervals);
    const amounts = items.map((i) => i.amount);
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    // Amounts must be steady: within 25% of each other, or within $3 for small charges.
    const steady = Math.max(...amounts) - Math.min(...amounts) <= Math.max(3, avg * 0.25);
    if (!steady) continue;
    let cadence: RecurringCharge["cadence"] | null = null;
    if (typical >= 26 && typical <= 35 && intervals.every((d) => d >= 20 && d <= 40)) cadence = "monthly";
    else if (typical >= 6 && typical <= 8 && items.length >= 3 && intervals.every((d) => d >= 5 && d <= 9)) cadence = "weekly";
    if (!cadence) continue;
    const last = items[items.length - 1];
    const cls = last.cls;
    const monthlyEquivalent = cadence === "monthly" ? avg : avg * 52 / 12;
    results.push({
      merchant: last.display,
      cadence,
      averageAmount: roundMoney(avg),
      monthlyEquivalent: roundMoney(monthlyEquivalent),
      occurrences: items.length,
      lastDate: last.date,
      nextExpected: new Date(Date.parse(`${last.date}T00:00:00Z`) + Math.round(typical) * MS_PER_DAY).toISOString().slice(0, 10),
      class: cls,
      likelySubscription: cls === "discretionary" && cadence === "monthly" && avg <= 100,
    });
  }
  return results.sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
}

// ── Spending insights ───────────────────────────────────────────────────────

const SPENDING_CLASSES: ExpenseClass[] = ["essential", "discretionary", "uncategorized", "debt-payment", "fee"];
const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildSpendingInsights(input: {
  transactions: CashflowTransaction[];
  periodStart: string;
  periodEnd: string;
  prefs: SpendingPrefs;
}): SpendingInsights | null {
  const completed = input.transactions.filter((t) => !t.pending && Number.isFinite(t.amount));
  const pendingExcluded = input.transactions.length - completed.length;
  if (completed.length === 0) return null;

  // Measure only the period the bank actually returned, so a new connection
  // with partial history doesn't understate monthly averages.
  const earliest = completed.reduce((min, t) => (t.date < min ? t.date : min), completed[0].date);
  const start = earliest > input.periodStart ? earliest : input.periodStart;
  const daysCovered = daysBetween(start, input.periodEnd) + 1;
  const monthsCovered = daysCovered / DAYS_PER_MONTH;
  const recentStart = new Date(Date.parse(`${input.periodEnd}T00:00:00Z`) - 29 * MS_PER_DAY).toISOString().slice(0, 10);
  const canCompare = daysCovered >= 60;

  const totals: Record<ExpenseClass, number> = {
    essential: 0, discretionary: 0, uncategorized: 0, "debt-payment": 0, fee: 0, "savings-contribution": 0, transfer: 0, income: 0,
  };
  const byCategory = new Map<string, { category: string; label: string; cls: ExpenseClass; overridden: boolean; total: number; recent: number; count: number }>();
  const classified = completed.map((t) => ({ ...t, ...classify(t, input.prefs) }));

  for (const t of classified) {
    if (t.cls === "transfer") continue;
    if (t.cls === "income") {
      totals.income += -t.amount;
      continue;
    }
    totals[t.cls] += t.amount;
    if (!SPENDING_CLASSES.includes(t.cls)) continue;
    const category = t.category.trim().toUpperCase() || "OTHER";
    const key = `${category}|${t.cls}`;
    const row = byCategory.get(key) ?? { category, label: categoryLabel(t.primaryCategory, t.category), cls: t.cls, overridden: t.overridden, total: 0, recent: 0, count: 0 };
    row.total += t.amount;
    row.count += 1;
    if (t.date >= recentStart) row.recent += t.amount;
    row.overridden = row.overridden || t.overridden;
    byCategory.set(key, row);
  }

  const perMonth = (v: number) => roundMoney(v / monthsCovered);
  const categories: CategorySpend[] = Array.from(byCategory.values())
    .filter((r) => r.total > 0.005)
    .map((r) => {
      const recentMonthly = canCompare ? roundMoney(r.recent / (30 / DAYS_PER_MONTH)) : null;
      const earlierMonthly = canCompare ? (r.total - r.recent) / ((daysCovered - 30) / DAYS_PER_MONTH) : null;
      return {
        category: r.category,
        label: r.label,
        class: r.cls,
        overridden: r.overridden,
        total: roundMoney(r.total),
        monthlyAverage: perMonth(r.total),
        transactionCount: r.count,
        recentMonthly,
        changePercent: canCompare && earlierMonthly! > 0.5 ? roundMoney(((recentMonthly! - earlierMonthly!) / earlierMonthly!) * 100) : null,
      };
    })
    .sort((a, b) => b.monthlyAverage - a.monthlyAverage);

  const manual = (cls: "essential" | "discretionary" | "debt-payment") =>
    roundMoney(input.prefs.manualExpenses.filter((e) => e.class === cls).reduce((s, e) => s + e.monthlyAmount, 0));
  const monthly = {
    essential: perMonth(Math.max(0, totals.essential)),
    discretionary: perMonth(Math.max(0, totals.discretionary)),
    uncategorized: perMonth(Math.max(0, totals.uncategorized)),
    debtPayments: perMonth(Math.max(0, totals["debt-payment"])),
    fees: perMonth(Math.max(0, totals.fee)),
    savingsContributions: perMonth(Math.max(0, totals["savings-contribution"])),
    manualEssential: manual("essential"),
    manualDiscretionary: manual("discretionary"),
    manualDebt: manual("debt-payment"),
    totalSpending: 0,
    surplus: 0,
  };
  monthly.totalSpending = roundMoney(
    monthly.essential + monthly.discretionary + monthly.uncategorized + monthly.debtPayments + monthly.fees
    + monthly.manualEssential + monthly.manualDiscretionary + monthly.manualDebt
  );
  const detectedMonthly = perMonth(Math.max(0, totals.income));
  const usedMonthly = input.prefs.confirmedMonthlyIncome ?? detectedMonthly;
  monthly.surplus = roundMoney(usedMonthly - monthly.totalSpending);

  const recurring = detectRecurring(classified.map((t) => ({ date: t.date, amount: t.amount, merchant: t.merchant, cls: t.cls })));

  // ── Scenarios: exact, conservative arithmetic on discretionary money only ──
  const scenarios: SavingsScenario[] = [];
  for (const c of categories.filter((c) => c.class === "discretionary" && c.monthlyAverage >= 20).slice(0, 3)) {
    const m = roundMoney(c.monthlyAverage * 0.2);
    scenarios.push({
      id: `cut-${c.category}`,
      title: `Spend 20% less on ${c.label.toLowerCase()}`,
      description: `You've averaged ${usd(c.monthlyAverage)} a month here over ${daysCovered} days (${c.transactionCount} transactions).`,
      monthlySavings: m,
      annualSavings: roundMoney(m * 12),
      baseMonthly: c.monthlyAverage,
      calculation: `${usd(c.monthlyAverage)} × 20% = ${usd(m)}/month; × 12 = ${usd(roundMoney(m * 12))}/year`,
    });
  }
  const subs = recurring.filter((r) => r.likelySubscription);
  if (subs.length > 0) {
    const total = roundMoney(subs.reduce((s, r) => s + r.monthlyEquivalent, 0));
    scenarios.push({
      id: "review-subscriptions",
      title: `Review ${subs.length} recurring subscription${subs.length === 1 ? "" : "s"}`,
      description: `Each one you cancel saves its full amount. This is the most you'd save if you cancelled all of them: ${subs.map((s) => `${s.merchant} ${usd(s.monthlyEquivalent)}`).join(", ")}.`,
      monthlySavings: total,
      annualSavings: roundMoney(total * 12),
      baseMonthly: null,
      calculation: `${subs.map((s) => usd(s.monthlyEquivalent)).join(" + ")} = ${usd(total)}/month; × 12 = ${usd(roundMoney(total * 12))}/year`,
    });
  }
  const feeCategories = categories.filter((c) => c.class === "fee");
  if (monthly.fees >= 1) {
    scenarios.push({
      id: "avoid-fees",
      title: "Avoid bank fees",
      description: `Fees charged: ${feeCategories.map((c) => `${c.label.toLowerCase()} (${usd(c.total)})`).join(", ")}. Some, like ATM or overdraft fees, can often be avoided.`,
      monthlySavings: monthly.fees,
      annualSavings: roundMoney(monthly.fees * 12),
      baseMonthly: null,
      calculation: `${usd(roundMoney(totals.fee))} over ${daysCovered} days ÷ ${monthsCovered.toFixed(2)} months = ${usd(monthly.fees)}/month; × 12 = ${usd(roundMoney(monthly.fees * 12))}/year`,
    });
  }
  const discretionaryAll = roundMoney(monthly.discretionary + monthly.manualDiscretionary);
  if (discretionaryAll >= 10) {
    const m = roundMoney(discretionaryAll * 0.1);
    scenarios.push({
      id: "redirect-10",
      title: "Redirect 10% of discretionary spending to savings",
      description: "A small, steady shift from wants to savings, without touching essentials or debt payments.",
      monthlySavings: m,
      annualSavings: roundMoney(m * 12),
      baseMonthly: null,
      calculation: `${usd(discretionaryAll)} discretionary × 10% = ${usd(m)}/month; × 12 = ${usd(roundMoney(m * 12))}/year`,
    });
  }

  const notices: string[] = [];
  if (daysCovered < 30) notices.push(`Only ${daysCovered} days of transactions are available so far, so monthly figures are rough. Banks often send older history over the first day or two after linking.`);
  else if (daysCovered < 85) notices.push(`Averages use the ${daysCovered} days of history your bank has sent so far.`);
  if (pendingExcluded > 0) notices.push(`${pendingExcluded} pending transaction${pendingExcluded === 1 ? " is" : "s are"} left out until they post.`);
  if (monthly.uncategorized > 0) notices.push(`${usd(monthly.uncategorized)} a month couldn't be classified as essential or discretionary (for example, superstore purchases). It counts as spending but isn't used for savings suggestions until you classify it.`);
  if (input.prefs.confirmedMonthlyIncome !== null) notices.push(`Uses the take-home pay you confirmed (${usd(input.prefs.confirmedMonthlyIncome)}/month) instead of detected deposits (${usd(detectedMonthly)}/month).`);
  else if (detectedMonthly === 0) notices.push("No income deposits were detected in your linked accounts. Enter your monthly take-home pay to see your surplus.");
  notices.push("Transfers between your own accounts and credit card payments are excluded so nothing is counted twice.");

  return {
    periodStart: start,
    periodEnd: input.periodEnd,
    daysCovered,
    monthsCovered: roundMoney(monthsCovered),
    transactionsAnalyzed: completed.length,
    pendingExcluded,
    income: { detectedMonthly, confirmedMonthly: input.prefs.confirmedMonthlyIncome, usedMonthly: roundMoney(usedMonthly) },
    monthly,
    categories,
    recurring,
    scenarios,
    notices,
  };
}

// ── Emergency fund ──────────────────────────────────────────────────────────

const liquidValue = (a: LinkedAccount) => {
  const values = [a.currentBalance, a.availableBalance].filter((v): v is number => v !== null && Number.isFinite(v));
  return values.length > 0 ? Math.max(0, Math.min(...values)) : 0;
};

export function buildEmergencyPlan(input: {
  now: Date;
  insights: SpendingInsights | null;
  prefs: SpendingPrefs;
  accounts: LinkedAccount[];
  manualCashCounted: number;
  pools: PoolView[];
}): EmergencyFundPlan {
  const notices: string[] = [];
  const m = input.insights?.monthly;
  const manualEssential = input.prefs.manualExpenses.filter((e) => e.class === "essential").reduce((s, e) => s + e.monthlyAmount, 0);
  const manualDebt = input.prefs.manualExpenses.filter((e) => e.class === "debt-payment").reduce((s, e) => s + e.monthlyAmount, 0);
  const breakdown = [
    { label: "Essential spending from linked accounts", monthly: m?.essential ?? 0 },
    { label: "Debt payments from linked accounts", monthly: m?.debtPayments ?? 0 },
    { label: "Essential expenses you added", monthly: roundMoney(manualEssential) },
    { label: "Debt payments you added", monthly: roundMoney(manualDebt) },
  ].filter((b) => b.monthly > 0);
  const essentialMonthly = roundMoney(breakdown.reduce((s, b) => s + b.monthly, 0));

  const usable = input.accounts.filter((a) => a.currency === null || a.currency === "USD");
  const cash = roundMoney(usable.filter((a) => a.assetClass === "cash").reduce((s, a) => s + liquidValue(a), 0) + input.manualCashCounted);
  const savings = roundMoney(usable.filter((a) => a.assetClass === "savings").reduce((s, a) => s + liquidValue(a), 0));
  const emergencyPools = input.pools.filter((p) => p.category === "emergency" && !p.archived);
  let earmarked = 0;
  let excluded = 0;
  for (const pool of emergencyPools) {
    for (const a of pool.allocations) {
      if (a.assetClass === "cash" || a.assetClass === "savings") earmarked += a.verifiedValue;
      else excluded += a.verifiedValue;
    }
  }
  earmarked = roundMoney(earmarked);
  excluded = roundMoney(excluded);
  const basis: EmergencyFundPlan["basis"] = emergencyPools.length > 0 ? "earmarked" : "all-accessible";
  const basisAmount = basis === "earmarked" ? earmarked : roundMoney(cash + savings);
  const surplus = input.insights?.monthly.surplus ?? null;

  const targets = ([3, 6, 9] as const).map((months) => {
    const target = roundMoney(essentialMonthly * months);
    const gap = roundMoney(Math.max(0, target - basisAmount));
    return {
      months,
      target,
      gap,
      monthlyFor: [6, 12, 24].map((n) => ({ months: n, amount: roundMoney(gap / n) })),
      monthsAtSurplus: gap === 0 ? 0 : surplus !== null && surplus > 0 ? Math.ceil(gap / surplus - 1e-9) : null,
    };
  });

  if (essentialMonthly === 0) notices.push("Essential expenses couldn't be estimated yet. Link a bank account for spending, or add your regular essential costs.");
  if (m && m.uncategorized > 0) notices.push(`${usd(m.uncategorized)}/month of unclassified spending isn't included in essentials. Mark it essential if it is.`);
  if (basis === "all-accessible" && essentialMonthly > 0) notices.push("You don't have an emergency pool, so gaps are measured against all your cash and savings, including money for regular bills. Create an Emergency Fund pool to track money set aside just for emergencies.");
  if (excluded > 0) notices.push(`${usd(excluded)} in your emergency pools comes from investment or retirement accounts and isn't counted as emergency cash.`);
  if (surplus !== null && surplus <= 0 && essentialMonthly > 0) notices.push("Your recent spending is at or above your income, so the gap can't be closed from surplus alone.");
  const firstTarget = targets.find((t) => t.gap > 0 && t.monthsAtSurplus);
  if (firstTarget && surplus) notices.push(`At your current surplus of ${usd(surplus)}/month, the ${firstTarget.months}-month target would be reached around ${addMonths(input.now, firstTarget.monthsAtSurplus!)} if all of it went to savings.`);

  return {
    essentialMonthly,
    breakdown,
    accessible: { cash, savings, total: roundMoney(cash + savings), earmarkedInEmergencyPools: earmarked, excludedFromEmergencyPools: excluded },
    basis,
    basisAmount,
    targets,
    excludedNote: "CDs, investments, retirement accounts, HSAs, and 529s aren't counted: they can lose value, take time to access, or carry taxes and penalties.",
    notices,
  };
}
