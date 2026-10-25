import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  amortizedPayment, debtPayoffMonths, futureValue, monthlyRate, monthsToReach, requiredMonthly,
} from "./projections";
import { buildGoalViews } from "./goals";
import type { Goal } from "@shared/goals";
import type { PoolView } from "@shared/pools";
import type { LinkedAccount } from "@shared/finance";

const close = (actual: number, expected: number, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);

describe("projections", () => {
  test("monthly rate is the equivalent compound rate", () => {
    close(Math.pow(1 + monthlyRate(6), 12), 1.06, 1e-12);
  });
  test("future value with no growth is simple addition", () => {
    assert.equal(futureValue(1000, 100, 0, 12), 2200);
  });
  test("future value matches the annuity formula", () => {
    // $0 + $500/month for 10 years at 6%/yr effective.
    const i = Math.pow(1.06, 1 / 12) - 1;
    close(futureValue(0, 500, 6, 120), 500 * ((Math.pow(1 + i, 120) - 1) / i));
    // 500 × (1.06^10 − 1) / (1.06^(1/12) − 1), computed by hand.
    close(futureValue(0, 500, 6, 120), 81_236.72, 0.01);
  });
  test("months to reach a target", () => {
    assert.equal(monthsToReach(0, 300, 0, 3000), 10);
    assert.equal(monthsToReach(0, 300, 0, 3001), 11);
    assert.equal(monthsToReach(5000, 0, 0, 5000), 0);
    assert.equal(monthsToReach(0, 0, 0, 1), null);
    // Growth shortens the time.
    assert.ok(monthsToReach(0, 500, 6, 81_000)! <= 120);
  });
  test("required monthly round-trips with future value", () => {
    const pmt = requiredMonthly(2000, 20_000, 5, 36);
    close(futureValue(2000, pmt, 5, 36), 20_000);
    assert.equal(requiredMonthly(25_000, 20_000, 0, 12), 0);
  });
  test("debt payoff matches the standard amortization formula", () => {
    // $10,000 at 6% APR with $200/month: 58 payments (57.68 rounded up).
    assert.equal(debtPayoffMonths(10_000, 200, 6), 58);
    assert.equal(debtPayoffMonths(1000, 100, 0), 10);
    assert.equal(debtPayoffMonths(10_000, 50, 6), null); // doesn't cover $50 interest
    close(amortizedPayment(10_000, 6, 60), 193.33);
  });
});

const now = new Date("2026-10-25T12:00:00Z");
const pool = (id: string, verifiedTotal: number, monthly: number | null = null): PoolView => ({
  id, name: id, category: "house", icon: "home", description: "", targetAmount: 50_000, targetDate: null,
  monthlyContributionGoal: monthly, archived: false, createdAt: "t", updatedAt: "t", allocations: [], verifiedTotal,
  unverifiedAmount: 0, progressPercent: 0, remaining: 0, estimatedCompletion: null, monthsToComplete: null, requiredMonthly: null, warnings: [],
});
const goal = (overrides: Partial<Goal>): Goal => ({
  id: "g", name: "Buy a home", type: "home", targetAmount: 30_000, deadline: null, poolIds: [], debtAccountKeys: [],
  manualDebtIds: [], monthlyContribution: null, annualReturnPercent: 0, notes: "", status: "active",
  startingDebt: null, createdAt: "t", updatedAt: "t", completedAt: null, ...overrides,
});

describe("buildGoalViews", () => {
  test("savings goal progress comes from linked pools", () => {
    const [view] = buildGoalViews({
      now, goals: [goal({ poolIds: ["p1", "p2"], monthlyContribution: 300 })],
      pools: [pool("p1", 5000), pool("p2", 1000)], debtAccounts: [], manualDebts: [],
    });
    assert.equal(view.projection.currentAmount, 6000);
    assert.equal(view.projection.remaining, 24_000);
    assert.equal(view.projection.progressPercent, 20);
    assert.equal(view.projection.monthsToTarget, 80);
    assert.equal(view.projection.estimatedCompletion, "2033-06-25");
  });
  test("answers 'if I save $300 a month, when could I buy a house'", () => {
    const [view] = buildGoalViews({ now, goals: [goal({ poolIds: ["p1"], monthlyContribution: 300, deadline: "2030-10-25" })], pools: [pool("p1", 6000)], debtAccounts: [], manualDebts: [] });
    assert.equal(view.projection.requiredMonthly, 500);
    assert.equal(view.projection.onTrack, false);
    assert.ok(view.warnings.some((w) => w.includes("Not on track") && w.includes("$500.00")));
  });
  test("falls back to the pools' monthly goals and says so", () => {
    const [view] = buildGoalViews({ now, goals: [goal({ poolIds: ["p1"] })], pools: [pool("p1", 0, 600)], debtAccounts: [], manualDebts: [] });
    assert.equal(view.projection.monthsToTarget, 50);
    assert.ok(view.assumptions.some((a) => a.includes("combined monthly goals")));
  });
  test("warns when a pool counts toward two goals", () => {
    const views = buildGoalViews({
      now, goals: [goal({ id: "a", name: "A", poolIds: ["p1"] }), goal({ id: "b", name: "B", poolIds: ["p1"] })],
      pools: [pool("p1", 100)], debtAccounts: [], manualDebts: [],
    });
    assert.ok(views[0].warnings.some((w) => w.includes("also counts toward B")));
  });
  test("debt payoff measures paydown since the baseline and includes known rates", () => {
    const [view] = buildGoalViews({
      now, goals: [goal({ type: "debt-payoff", manualDebtIds: ["11111111-1111-4111-8111-111111111111"], startingDebt: 12_000, monthlyContribution: 200 })],
      pools: [], debtAccounts: [],
      manualDebts: [{ id: "11111111-1111-4111-8111-111111111111", name: "Car", kind: "auto-loan", balance: 10_000, monthlyPayment: 200, interestRate: 6, updatedAt: "t" }],
    });
    assert.equal(view.projection.currentAmount, 2000);
    assert.equal(view.projection.currentDebt, 10_000);
    assert.equal(view.projection.monthsToTarget, 58);
    assert.equal(view.projection.interestIncluded, true);
  });
  test("debt payoff with a linked card says interest isn't included", () => {
    const card: LinkedAccount = { key: "cc", itemId: "i", institutionName: "B", name: "Card", mask: "1", type: "credit", subtype: "credit card", assetClass: "credit", currentBalance: 1000, availableBalance: null, currency: "USD", retrievedAt: "t" };
    const [view] = buildGoalViews({ now, goals: [goal({ type: "debt-payoff", debtAccountKeys: ["cc", "gone"], startingDebt: 1000, monthlyContribution: 100 })], pools: [], debtAccounts: [card], manualDebts: [] });
    assert.equal(view.projection.monthsToTarget, 10);
    assert.equal(view.projection.interestIncluded, false);
    assert.ok(view.assumptions.some((a) => a.includes("Interest is not included")));
    assert.ok(view.warnings.some((w) => w.includes("isn't available")));
  });
});
