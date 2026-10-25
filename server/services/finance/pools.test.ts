import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyAllocations,
  buildFundingSources,
  completionEstimate,
  monthsUntil,
  unallocatedByClass,
  validateAllocations,
  valuePools,
} from "./pools";
import type { LinkedAccount, LinkedHolding } from "@shared/finance";
import type { Allocation, Pool } from "@shared/pools";

const checking: LinkedAccount = {
  key: "chk", itemId: "item1", institutionName: "Bank", name: "Checking", mask: "0000", type: "depository",
  subtype: "checking", assetClass: "cash", currentBalance: 3000, availableBalance: 2500, currency: "USD", retrievedAt: "t",
};
const savings: LinkedAccount = { ...checking, key: "sav", name: "Savings", mask: "1111", subtype: "savings", assetClass: "savings", currentBalance: 10000, availableBalance: 10000 };
const brokerage: LinkedAccount = { ...checking, key: "brk", name: "Brokerage", mask: "2222", type: "investment", subtype: "brokerage", assetClass: "taxable-investment", currentBalance: 1500, availableBalance: null };
const card: LinkedAccount = { ...checking, key: "cc", type: "credit", subtype: "credit card", assetClass: "credit", currentBalance: 400 };
const vti: LinkedHolding = {
  key: "brk:tkr_VTI", accountKey: "brk", securityKey: "tkr_VTI", symbol: "VTI", name: "Vanguard Total", securityType: "etf",
  isCashEquivalent: false, quantity: 10, price: 100, priceAsOf: "2026-10-24", value: 1000, costBasis: null, currency: "USD",
};
const cashHolding: LinkedHolding = { ...vti, key: "brk:cash", securityKey: "cash", symbol: null, name: "USD", isCashEquivalent: true, quantity: 500, price: 1, value: 500 };

const sources = () => buildFundingSources([checking, savings, brokerage, card], [vti, cashHolding], {});

let n = 0;
const amount = (poolId: string, accountKey: string, value: number, id = `a${++n}`): Allocation => ({
  kind: "amount", poolId, accountKey, amount: value, id, itemId: "item1", accountLabel: accountKey, assetClass: "cash",
  symbol: null, securityName: null, createdAt: "t", updatedAt: "t",
});
const shares = (poolId: string, qty: number, id = `s${++n}`): Allocation => ({
  kind: "shares", poolId, accountKey: "brk", securityKey: "tkr_VTI", shares: qty, id, itemId: "item1",
  accountLabel: "Brokerage", assetClass: "taxable-investment", symbol: "VTI", securityName: "Vanguard Total", createdAt: "t", updatedAt: "t",
});
const pool = (id: string, overrides: Partial<Pool> = {}): Pool => ({
  id, name: id, category: "custom", icon: "star", description: "", targetAmount: 5000, targetDate: null,
  monthlyContributionGoal: null, archived: false, createdAt: "t", updatedAt: "t", ...overrides,
});
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

describe("funding sources", () => {
  test("bank capacity is the lower of current and available; liabilities and brokerage cash aren't share sources", () => {
    const s = sources();
    assert.equal(s.find((x) => x.accountKey === "chk")!.capacity, 2500);
    assert.equal(s.find((x) => x.accountKey === "sav")!.capacity, 10000);
    assert.equal(s.find((x) => x.accountKey === "brk" && x.kind === "amount")!.capacity, 1500);
    assert.equal(s.filter((x) => x.kind === "shares").length, 1);
    assert.ok(!s.some((x) => x.accountKey === "cc"));
  });
  test("uses a verified quote for share prices when available", () => {
    const s = buildFundingSources([brokerage], [vti], { VTI: { price: 110, asOf: "now", source: "Finnhub /quote" } });
    const src = s.find((x) => x.kind === "shares")!;
    assert.equal(src.price, 110);
    assert.equal(src.priceSource, "Finnhub /quote");
  });
  test("a fresher quote doesn't make a fully earmarked holding look over-allocated", () => {
    const base = buildFundingSources([brokerage], [vti], { VTI: { price: 160, asOf: "now", source: "Finnhub /quote" } });
    const all = shares(P1, 10);
    assert.deepEqual(validateAllocations(base, [], [all]), []);
    const result = valuePools({ now: new Date(), pools: [pool(P1)], allocations: [all], baseSources: base, institutions: [{ itemId: "item1", institutionName: "Bank", status: "connected", retrievedAt: "t", accountCount: 1 }] });
    assert.equal(result.pools[0].allocations[0].state, "verified");
    assert.equal(result.pools[0].verifiedTotal, 1600);
  });
});

describe("validateAllocations", () => {
  test("one account can fund several pools, but never more than it has", () => {
    const a = amount(P1, "chk", 1500);
    assert.deepEqual(validateAllocations(sources(), [], [a]), []);
    const ok = amount(P2, "chk", 1000);
    assert.deepEqual(validateAllocations(sources(), [a], [a, ok]), []);
    const tooMuch = amount(P2, "chk", 1000.01);
    const errors = validateAllocations(sources(), [a], [a, tooMuch]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /only \$1000\.00 is available/);
  });
  test("shares can't exceed the holding", () => {
    assert.deepEqual(validateAllocations(sources(), [], [shares(P1, 10)]), []);
    assert.equal(validateAllocations(sources(), [], [shares(P1, 6), shares(P2, 5)]).length, 1);
  });
  test("dollars and shares from one investment account share its value", () => {
    // 10 VTI at $100 = $1,000 of a $1,500 account leaves $500 in dollars.
    const s = shares(P1, 10);
    assert.deepEqual(validateAllocations(sources(), [s], [s, amount(P2, "brk", 500)]), []);
    assert.equal(validateAllocations(sources(), [s], [s, amount(P2, "brk", 501)]).length, 1);
  });
  test("reducing an allocation is allowed even when the source is already short", () => {
    const big = amount(P1, "chk", 2500);
    const shrunk = [{ ...checking, availableBalance: 1000 }];
    const base = buildFundingSources(shrunk, [], {});
    assert.deepEqual(validateAllocations(base, [big], [{ ...big, amount: 2000 }]), []);
    assert.equal(validateAllocations(base, [big], [{ ...big, amount: 2600 }]).length, 1);
    assert.deepEqual(validateAllocations(base, [big], []), []);
  });
  test("rejects new allocations to a source that isn't available", () => {
    assert.equal(validateAllocations(sources(), [], [amount(P1, "nope", 10)]).length, 1);
    assert.equal(validateAllocations(sources(), [], [amount(P1, "cc", 10)]).length, 1);
  });
});

describe("valuePools", () => {
  const institutions = [{ itemId: "item1", institutionName: "Bank", status: "connected" as const, retrievedAt: "t", accountCount: 4 }];
  const now = new Date("2026-10-25T12:00:00Z");

  test("values dollar and share allocations and computes progress", () => {
    const result = valuePools({
      now, pools: [pool(P1, { monthlyContributionGoal: 500 })],
      allocations: [amount(P1, "sav", 2000), shares(P1, 5)], baseSources: sources(), institutions,
    });
    const p = result.pools[0];
    assert.equal(p.verifiedTotal, 2500);
    assert.equal(p.progressPercent, 50);
    assert.equal(p.remaining, 2500);
    assert.equal(p.monthsToComplete, 5);
    assert.equal(p.estimatedCompletion, "2027-03-25");
  });

  test("pro-rates allocations when a balance drops, so pools never exceed the real money", () => {
    const allocations = [amount(P1, "chk", 1500), amount(P2, "chk", 1000)];
    const base = buildFundingSources([{ ...checking, availableBalance: 1250 }], [], {});
    const result = valuePools({ now, pools: [pool(P1), pool(P2)], allocations, baseSources: base, institutions });
    const total = result.pools.reduce((s, p) => s + p.verifiedTotal, 0);
    assert.equal(total, 1250);
    assert.equal(result.pools[0].verifiedTotal, 750);
    assert.equal(result.pools[0].allocations[0].state, "over-allocated");
    assert.ok(result.pools[0].warnings.length > 0);
  });

  test("keeps allocations for disconnected or unavailable accounts without counting them", () => {
    const gone = { ...amount(P1, "old", 800), itemId: "removed-item" };
    const down = { ...amount(P1, "down", 300), itemId: "item2" };
    const result = valuePools({
      now, pools: [pool(P1)], allocations: [gone, down], baseSources: sources(),
      institutions: [...institutions, { itemId: "item2", institutionName: "Other", status: "reauth-required", retrievedAt: null, accountCount: 0 }],
    });
    const p = result.pools[0];
    assert.equal(p.verifiedTotal, 0);
    assert.equal(p.unverifiedAmount, 1100);
    assert.deepEqual(p.allocations.map((a) => a.state), ["disconnected", "unavailable"]);
    assert.equal(p.warnings.length, 2);
  });

  test("warns when an institution price is more than a week old", () => {
    const result = valuePools({ now, pools: [pool(P1)], allocations: [shares(P1, 1)], baseSources: sources(), institutions });
    assert.ok(result.pools[0].warnings.some((w) => w.includes("2026-10-24")) === false);
    const old = buildFundingSources([brokerage], [{ ...vti, priceAsOf: "2026-09-01" }], {});
    const stale = valuePools({ now, pools: [pool(P1)], allocations: [shares(P1, 1)], baseSources: old, institutions });
    assert.ok(stale.pools[0].warnings.some((w) => w.includes("2026-09-01") && w.includes("out of date")));
  });

  test("flags a monthly goal too small for the target date", () => {
    const result = valuePools({
      now, pools: [pool(P1, { targetAmount: 1200, targetDate: "2027-04-25", monthlyContributionGoal: 100 })],
      allocations: [], baseSources: sources(), institutions,
    });
    assert.equal(result.pools[0].requiredMonthly, 200);
    assert.ok(result.pools[0].warnings.some((w) => w.includes("won't reach its target")));
  });
});

describe("dates and estimates", () => {
  test("monthsUntil counts whole months", () => {
    const now = new Date("2026-10-25T00:00:00Z");
    assert.equal(monthsUntil(now, "2027-10-25"), 12);
    assert.equal(monthsUntil(now, "2027-10-24"), 11);
    assert.equal(monthsUntil(now, "2026-01-01"), 0);
  });
  test("completion estimate handles funded, no-goal, and month-end cases", () => {
    const now = new Date("2026-01-31T00:00:00Z");
    assert.deepEqual(completionEstimate(now, 0, null), { months: 0, date: "2026-01-31" });
    assert.equal(completionEstimate(now, 100, null), null);
    assert.deepEqual(completionEstimate(now, 100, 100), { months: 1, date: "2026-02-28" });
    assert.equal(completionEstimate(now, 1000, 300)!.months, 4);
  });
});

describe("unallocatedByClass", () => {
  test("reports earmarked and free money per class", () => {
    const { sources: applied } = applyAllocations(sources(), [amount(P1, "chk", 1000), shares(P1, 4)]);
    const rows = unallocatedByClass(applied);
    const cash = rows.find((r) => r.assetClass === "cash")!;
    assert.deepEqual([cash.total, cash.allocated, cash.unallocated], [2500, 1000, 1500]);
    const taxable = rows.find((r) => r.assetClass === "taxable-investment")!;
    assert.deepEqual([taxable.total, taxable.allocated, taxable.unallocated], [1500, 400, 1100]);
  });
});
