import assert from "node:assert/strict";
import test from "node:test";
import { calculateSpendingAnalysis } from "./spendingAnalysis";

test("estimates monthly surplus and a buffered starting contribution", () => {
  const result = calculateSpendingAnalysis([
    { amount: 15_000, category: "RENT", primaryCategory: "RENT_AND_UTILITIES", pending: false },
    { amount: 1_200, category: "RESTAURANTS", primaryCategory: "FOOD_AND_DRINK", pending: false },
    { amount: -15_000, category: "PAYROLL", primaryCategory: "INCOME", pending: false },
  ], "2026-01-01", "2026-03-31");

  assert.equal(result.daysAnalyzed, 90);
  assert.equal(result.monthlyIncome, 5_000);
  assert.equal(result.monthlyExpenses, 5_400);
  assert.equal(result.monthlySurplus, -400);
  assert.equal(result.suggestedMonthlyContribution, 0);
  assert.equal(result.categories[0].category, "RENT");
});

test("excludes pending and transfer activity and calculates cutback options", () => {
  const result = calculateSpendingAnalysis([
    { amount: -12_000, category: "PAYROLL", primaryCategory: "INCOME", pending: false },
    { amount: 3_000, category: "HOUSING", primaryCategory: "RENT_AND_UTILITIES", pending: false },
    { amount: 900, category: "DINING", primaryCategory: "FOOD_AND_DRINK", pending: false },
    { amount: 500, category: "TRANSFER_OUT", primaryCategory: "TRANSFER_OUT", pending: false },
    { amount: 1_000, category: "DINING", primaryCategory: "FOOD_AND_DRINK", pending: true },
  ], "2026-01-01", "2026-03-31");

  assert.equal(result.transactionsAnalyzed, 3);
  assert.equal(result.monthlyIncome, 4_000);
  assert.equal(result.monthlyExpenses, 1_300);
  assert.equal(result.monthlySurplus, 2_700);
  assert.equal(result.suggestedMonthlyContribution, 1_350);

  const dining = result.categories.find((category) => category.category === "DINING");
  assert.ok(dining);
  assert.deepEqual(dining.cutbackOptions, [
    { cutPercent: 10, monthlySavings: 30, suggestedContributionAfterCut: 1_365 },
    { cutPercent: 20, monthlySavings: 60, suggestedContributionAfterCut: 1_380 },
    { cutPercent: 30, monthlySavings: 90, suggestedContributionAfterCut: 1_395 },
  ]);
});

test("measures from the earliest transaction when less history came back", () => {
  const result = calculateSpendingAnalysis([
    { date: "2026-03-02", amount: 300, category: "DINING", primaryCategory: "FOOD_AND_DRINK", pending: false },
    { date: "2026-03-31", amount: 300, category: "DINING", primaryCategory: "FOOD_AND_DRINK", pending: false },
  ], "2026-01-01", "2026-03-31");
  assert.equal(result.periodStart, "2026-03-02");
  assert.equal(result.daysAnalyzed, 30);
  assert.equal(result.monthlyExpenses, 600);
});
