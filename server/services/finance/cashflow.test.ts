import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildEmergencyPlan, buildSpendingInsights, defaultClass, detectRecurring, normalizeMerchant, type CashflowTransaction } from "./cashflow";
import type { SpendingPrefs } from "@shared/cashflow";
import type { LinkedAccount } from "@shared/finance";
import type { PoolView } from "@shared/pools";

const prefs = (over: Partial<SpendingPrefs> = {}): SpendingPrefs => ({ categoryOverrides: {}, merchantOverrides: {}, manualExpenses: [], confirmedMonthlyIncome: null, ...over });
const PRIMARIES = ["FOOD_AND_DRINK", "RENT_AND_UTILITIES", "LOAN_PAYMENTS", "BANK_FEES", "TRANSFER_OUT", "TRANSFER_IN", "GENERAL_MERCHANDISE", "GENERAL_SERVICES", "ENTERTAINMENT", "MEDICAL", "INCOME"];
const tx = (date: string, amount: number, category: string, merchant = "Shop", pending = false): CashflowTransaction => ({
  date, amount, pending, category, merchant,
  primaryCategory: PRIMARIES.find((p) => category.startsWith(p)) ?? category,
});

describe("defaultClass", () => {
  test("separates essentials, discretionary spending, debt, fees, savings, and transfers", () => {
    assert.equal(defaultClass("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT", 1500), "essential");
    assert.equal(defaultClass("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", 80), "essential");
    assert.equal(defaultClass("FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT", 40), "discretionary");
    assert.equal(defaultClass("LOAN_PAYMENTS", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT", 300), "debt-payment");
    assert.equal(defaultClass("LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", 500), "transfer");
    assert.equal(defaultClass("BANK_FEES", "BANK_FEES_ATM_FEES", 3), "fee");
    assert.equal(defaultClass("TRANSFER_OUT", "TRANSFER_OUT_SAVINGS", 200), "savings-contribution");
    assert.equal(defaultClass("TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER", 200), "transfer");
    assert.equal(defaultClass("INCOME", "INCOME_WAGES", -3000), "income");
    assert.equal(defaultClass("GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_SUPERSTORES", 120), "uncategorized");
    assert.equal(defaultClass("OTHER", "OTHER", 50), "uncategorized");
    assert.equal(defaultClass("Food and Drink", "Food and Drink", 12), "discretionary");
  });
});

describe("normalizeMerchant", () => {
  test("drops store numbers so one merchant groups together", () => {
    assert.equal(normalizeMerchant("STARBUCKS #1234"), normalizeMerchant("Starbucks  #998"));
    assert.equal(normalizeMerchant("Netflix.com"), "netflix com");
  });
});

describe("buildSpendingInsights", () => {
  const end = "2026-10-25";
  test("averages over the history actually returned, not the whole window", () => {
    // Only the last ~30 days came back from a 90-day request.
    const txs = [tx("2026-09-26", 300, "FOOD_AND_DRINK_RESTAURANT"), tx("2026-10-20", 300, "FOOD_AND_DRINK_RESTAURANT")];
    const s = buildSpendingInsights({ transactions: txs, periodStart: "2026-07-28", periodEnd: end, prefs: prefs() })!;
    assert.equal(s.daysCovered, 30);
    assert.ok(Math.abs(s.monthly.discretionary - 600 / (30 / (365.25 / 12))) < 0.01);
    assert.ok(s.notices.some((n) => n.includes("30 days")));
  });
  test("income, spending by class, refunds, and surplus", () => {
    const txs = [
      tx("2026-07-28", -6000, "INCOME_WAGES", "Employer"),
      tx("2026-08-01", 1500, "RENT_AND_UTILITIES_RENT", "Landlord"),
      tx("2026-08-10", 200, "FOOD_AND_DRINK_RESTAURANT"),
      tx("2026-08-11", -50, "FOOD_AND_DRINK_RESTAURANT"), // refund
      tx("2026-08-12", 400, "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
      tx("2026-08-13", 900, "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"), // internal, excluded
      tx("2026-08-14", 300, "TRANSFER_OUT_SAVINGS"),
      tx("2026-08-15", 35, "BANK_FEES_OVERDRAFT_FEES"),
      tx("2026-08-16", 99, "FOOD_AND_DRINK_RESTAURANT", "x", true), // pending
      tx(end, 0.01, "GENERAL_MERCHANDISE_SUPERSTORES"),
    ];
    const s = buildSpendingInsights({ transactions: txs, periodStart: "2026-07-28", periodEnd: end, prefs: prefs() })!;
    const months = 90 / (365.25 / 12);
    const per = (v: number) => Math.round((v / months) * 100) / 100;
    assert.equal(s.daysCovered, 90);
    assert.equal(s.pendingExcluded, 1);
    assert.equal(s.income.detectedMonthly, per(6000));
    assert.equal(s.monthly.essential, per(1500));
    assert.equal(s.monthly.discretionary, per(150));
    assert.equal(s.monthly.debtPayments, per(400));
    assert.equal(s.monthly.fees, per(35));
    assert.equal(s.monthly.savingsContributions, per(300));
    assert.ok(Math.abs(s.monthly.surplus - (s.income.usedMonthly - s.monthly.totalSpending)) < 0.01);
  });
  test("user overrides by category and by merchant", () => {
    const txs = [tx("2026-08-01", 100, "GENERAL_MERCHANDISE_SUPERSTORES", "Target"), tx("2026-08-02", 60, "ENTERTAINMENT_TV_AND_MOVIES", "Gym Co")];
    const s = buildSpendingInsights({
      transactions: txs, periodStart: "2026-07-28", periodEnd: end,
      prefs: prefs({ categoryOverrides: { GENERAL_MERCHANDISE_SUPERSTORES: "essential" }, merchantOverrides: { "gym co": "essential" } }),
    })!;
    assert.equal(s.monthly.uncategorized, 0);
    assert.equal(s.monthly.discretionary, 0);
    assert.ok(s.categories.every((c) => c.class === "essential" && c.overridden));
  });
  test("confirmed take-home pay replaces detected income", () => {
    const s = buildSpendingInsights({ transactions: [tx("2026-08-01", 100, "FOOD_AND_DRINK_GROCERIES")], periodStart: "2026-07-28", periodEnd: end, prefs: prefs({ confirmedMonthlyIncome: 4000 }) })!;
    assert.equal(s.income.usedMonthly, 4000);
  });
  test("scenarios show exact math and only use discretionary money", () => {
    const txs = [tx("2026-07-28", 900, "FOOD_AND_DRINK_RESTAURANT"), tx("2026-08-01", 3000, "RENT_AND_UTILITIES_RENT"), tx(end, 1, "MEDICAL_PRIMARY_CARE")];
    const s = buildSpendingInsights({ transactions: txs, periodStart: "2026-07-28", periodEnd: end, prefs: prefs() })!;
    const cut = s.scenarios.find((x) => x.id.startsWith("cut-"))!;
    assert.ok(cut.id.includes("RESTAURANT"));
    assert.ok(!s.scenarios.some((x) => x.id.includes("RENT")));
    const monthly = Math.round((900 / (90 / (365.25 / 12))) * 100) / 100;
    assert.equal(cut.monthlySavings, Math.round(monthly * 0.2 * 100) / 100);
    assert.equal(cut.annualSavings, Math.round(cut.monthlySavings * 12 * 100) / 100);
    assert.ok(cut.calculation.includes("× 20%"));
  });
});

describe("detectRecurring", () => {
  test("finds monthly subscriptions and weekly charges, ignores irregular ones", () => {
    const rows = [
      ...["2026-08-03", "2026-09-02", "2026-10-02"].map((d) => ({ date: d, amount: 15.49, merchant: "Netflix", cls: "discretionary" as const })),
      ...["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22"].map((d) => ({ date: d, amount: 20, merchant: "Farmers Market", cls: "essential" as const })),
      { date: "2026-08-01", amount: 40, merchant: "Random Cafe", cls: "discretionary" as const },
      { date: "2026-08-20", amount: 400, merchant: "Random Cafe", cls: "discretionary" as const },
      ...["2026-08-01", "2026-09-01"].map((d) => ({ date: d, amount: 500, merchant: "Transfer", cls: "transfer" as const })),
    ];
    const found = detectRecurring(rows);
    assert.equal(found.length, 2);
    const netflix = found.find((f) => f.merchant === "Netflix")!;
    assert.equal(netflix.cadence, "monthly");
    assert.equal(netflix.likelySubscription, true);
    assert.equal(netflix.nextExpected, "2026-11-01");
    const weekly = found.find((f) => f.cadence === "weekly")!;
    assert.equal(weekly.monthlyEquivalent, Math.round(20 * 52 / 12 * 100) / 100);
  });
});

describe("buildEmergencyPlan", () => {
  const acct = (key: string, assetClass: LinkedAccount["assetClass"], current: number, available: number | null = null): LinkedAccount => ({
    key, itemId: "i", institutionName: "B", name: key, mask: null, type: assetClass === "taxable-investment" || assetClass === "retirement" ? "investment" : "depository",
    subtype: null, assetClass, currentBalance: current, availableBalance: available, currency: "USD", retrievedAt: "t",
  });
  const insights = buildSpendingInsights({
    transactions: [tx("2026-07-28", 3000, "RENT_AND_UTILITIES_RENT"), tx("2026-10-25", 300, "LOAN_PAYMENTS_CAR_PAYMENT"), tx("2026-10-25", 500, "ENTERTAINMENT_CASINOS_AND_GAMBLING")],
    periodStart: "2026-07-28", periodEnd: "2026-10-25", prefs: prefs(),
  });
  const pool = (allocs: { assetClass: LinkedAccount["assetClass"]; value: number }[]): PoolView => ({
    id: "p", name: "Emergency", category: "emergency", icon: "shield", description: "", targetAmount: 10000, targetDate: null, monthlyContributionGoal: null,
    archived: false, createdAt: "t", updatedAt: "t", verifiedTotal: 0, unverifiedAmount: 0, progressPercent: 0, remaining: 0, estimatedCompletion: null,
    monthsToComplete: null, requiredMonthly: null, warnings: [],
    allocations: allocs.map((a, i) => ({ kind: "amount", poolId: "p", accountKey: `k${i}`, amount: a.value, id: `a${i}`, itemId: "i", accountLabel: "x", assetClass: a.assetClass, symbol: null, securityName: null, createdAt: "t", updatedAt: "t", state: "verified", verifiedValue: a.value, nominalValue: a.value, price: null, priceSource: null, priceAsOf: null })),
  });

  test("essentials include debt payments and manual costs, not discretionary spending", () => {
    const plan = buildEmergencyPlan({
      now: new Date("2026-10-25T00:00:00Z"), insights, accounts: [], manualCashCounted: 0, pools: [],
      prefs: prefs({ manualExpenses: [{ id: "11111111-1111-4111-8111-111111111111", name: "Insurance", monthlyAmount: 100, class: "essential" }] }),
    });
    const months = 90 / (365.25 / 12);
    const expected = Math.round(3000 / months * 100) / 100 + Math.round(300 / months * 100) / 100 + 100;
    assert.ok(Math.abs(plan.essentialMonthly - expected) < 0.02, `${plan.essentialMonthly} vs ${expected}`);
    assert.equal(plan.targets[1].target, Math.round(plan.essentialMonthly * 6 * 100) / 100);
  });
  test("counts only cash and savings as accessible, using the lower of current and available", () => {
    const plan = buildEmergencyPlan({
      now: new Date(), insights, prefs: prefs(), manualCashCounted: 200, pools: [],
      accounts: [acct("c", "cash", 1000, 900), acct("s", "savings", 5000), acct("cd", "term-deposit", 2000), acct("b", "taxable-investment", 9000), acct("r", "retirement", 50000)],
    });
    assert.deepEqual([plan.accessible.cash, plan.accessible.savings, plan.accessible.total], [1100, 5000, 6100]);
    assert.equal(plan.basis, "all-accessible");
    assert.equal(plan.basisAmount, 6100);
  });
  test("with an emergency pool, measures against earmarked cash/savings and excludes investments", () => {
    const plan = buildEmergencyPlan({
      now: new Date(), insights, prefs: prefs(), manualCashCounted: 0, accounts: [acct("s", "savings", 5000)],
      pools: [pool([{ assetClass: "savings", value: 3000 }, { assetClass: "taxable-investment", value: 4000 }, { assetClass: "retirement", value: 1000 }])],
    });
    assert.equal(plan.basis, "earmarked");
    assert.equal(plan.basisAmount, 3000);
    assert.equal(plan.accessible.excludedFromEmergencyPools, 5000);
    const six = plan.targets.find((t) => t.months === 6)!;
    assert.equal(six.gap, Math.max(0, Math.round((six.target - 3000) * 100) / 100));
    assert.equal(six.monthlyFor.find((x) => x.months === 12)!.amount, Math.round(six.gap / 12 * 100) / 100);
    assert.ok(plan.notices.some((n) => n.includes("isn't counted as emergency cash")));
  });
});
