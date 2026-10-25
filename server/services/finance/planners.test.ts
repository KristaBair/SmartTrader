import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { calculateRent, calculateRetirement, depletionAge } from "./planners";
import { futureValue } from "./projections";
import { rentInputSchema, retirementInputSchema } from "@shared/planners";

const close = (a: number, b: number, t = 0.01) => assert.ok(Math.abs(a - b) <= t, `expected ${b}, got ${a}`);

describe("calculateRent", () => {
  const input = rentInputSchema.parse({
    monthlyTakeHome: 4000, grossMonthlyIncome: 5500, debtPayments: 300, utilities: 150, transportation: 200, insurance: 100,
    groceries: 400, otherEssentials: 50, discretionary: 500, emergencyFundContribution: 300, otherSavings: 200, bufferPercent: 5,
  });
  const r = calculateRent(input);
  const method = (id: string) => r.methods.find((m) => m.id === id)!;

  test("each method matches the hand calculation", () => {
    assert.equal(r.nonRentNeeds, 1200);
    assert.equal(r.savingsCommitments, 500);
    assert.equal(method("gross-30").maxRent, 1650);
    assert.equal(method("gross-30").referenceOnly, true);
    assert.equal(method("fifty-thirty-twenty").maxRent, 800);
    assert.equal(method("dti-36").maxRent, 1680);
    assert.equal(method("residual").maxRent, 1600);
  });
  test("scenarios: conservative is the strictest limit; higher-cost cuts savings in half", () => {
    const [cons, mod, high] = r.scenarios;
    assert.deepEqual([cons.rent, mod.rent, high.rent], [800, 1600, 2050]);
    assert.equal(cons.monthlyFlexibility, 1000);
    assert.equal(mod.savingsReduction, 0);
    assert.equal(high.savingsKept, 250);
    assert.equal(high.savingsReduction, 250);
    assert.ok(high.tradeoffs.some((t) => t.includes("30% of gross")));
    assert.ok(high.tradeoffs.some((t) => t.includes("36% of gross")));
    assert.ok(high.tradeoffs.some((t) => t.includes("no buffer")));
    assert.equal(mod.percentOfTakeHome, 40);
  });
  test("never treats the 30% rule alone as the answer, and works without gross income", () => {
    const noGross = calculateRent({ ...input, grossMonthlyIncome: null });
    assert.equal(noGross.methods.find((m) => m.id === "dti-36")!.maxRent, null);
    assert.equal(noGross.scenarios[0].rent, 800);
    assert.ok(noGross.warnings.some((w) => w.includes("Gross income")));
  });
  test("warns when expenses already exceed take-home pay", () => {
    const tight = calculateRent({ ...input, discretionary: 3000 });
    assert.ok(tight.warnings.some((w) => w.includes("already use all")));
    assert.ok(tight.scenarios.every((s) => s.rent >= 0));
  });
});

describe("calculateRetirement", () => {
  const input = retirementInputSchema.parse({
    currentAge: 35, retirementAge: 65, currentSavings: 50_000, monthlyContribution: 500, employerMonthlyContribution: 250,
    retirementSpendingMonthly: 5000, otherIncomeMonthly: 2000, withdrawalRatePercent: 4,
  });
  const r = calculateRetirement(input);

  test("needed savings uses the spending gap and withdrawal rate", () => {
    assert.equal(r.spendingGapMonthlyToday, 3000);
    assert.ok(r.scenarios.every((s) => s.neededToday === 900_000));
  });
  test("projections convert between future and today's dollars", () => {
    const mid = r.scenarios.find((s) => s.id === "middle")!;
    close(mid.projectedNominal, futureValue(50_000, 750, 6, 360));
    close(mid.projectedToday, mid.projectedNominal / Math.pow(1.025, 30));
    close(mid.neededNominal, 900_000 * Math.pow(1.025, 30), 0.02);
  });
  test("the extra monthly amount closes the gap, and a cent less would not", () => {
    for (const s of r.scenarios.filter((x) => x.gapToday > 0)) {
      const withExtra = futureValue(50_000, 750 + s.additionalMonthlyNeeded, s.annualReturnPercent, 360);
      const centLess = futureValue(50_000, 750 + s.additionalMonthlyNeeded - 0.01, s.annualReturnPercent, 360);
      assert.ok(withExtra >= s.neededNominal - 0.01, `${withExtra} < ${s.neededNominal}`);
      assert.ok(centLess < s.neededNominal, `${centLess} already reaches ${s.neededNominal}`);
    }
  });
  test("more optimistic scenarios project more", () => {
    const [c, m, o] = r.scenarios;
    assert.ok(c.projectedToday < m.projectedToday && m.projectedToday < o.projectedToday);
  });
  test("adds a custom scenario only when both assumptions are given", () => {
    assert.equal(r.scenarios.length, 3);
    const custom = calculateRetirement({ ...input, customReturnPercent: 5, customInflationPercent: 3 });
    assert.equal(custom.scenarios.length, 4);
    assert.equal(custom.scenarios[3].id, "custom");
  });
  test("input validation rejects impossible ages", () => {
    assert.equal(retirementInputSchema.safeParse({ ...input, retirementAge: 30 }).success, false);
    assert.equal(retirementInputSchema.safeParse({ ...input, lifeExpectancy: 60 }).success, false);
  });
});

describe("depletionAge", () => {
  test("with no real return, savings last balance ÷ withdrawal months", () => {
    // $300,000 at $3,000/month and 0% real return runs out after 100 months.
    assert.equal(depletionAge(300_000, 3000, 2.5, 2.5, 65, 90), 65 + Math.floor(100 / 12));
  });
  test("returns null when savings outlast the planning age or there's no gap", () => {
    assert.equal(depletionAge(900_000, 3000, 6, 2.5, 65, 90), null);
    assert.equal(depletionAge(0, 0, 6, 2.5, 65, 90), null);
  });
});
