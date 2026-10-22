import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  calcLogReturns,
  mean,
  stdDev,
  percentile,
  runQuantAnalysis,
  InsufficientDataError,
} from "./quantAnalytics";
import type { PriceHistory } from "./finnhub";

const close = (a: number, b: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tolerance, `expected ${a} to be within ${tolerance} of ${b}`);

// Builds a PriceHistory from a list of closes, as Yahoo would return it.
function history(closes: number[]): PriceHistory {
  if (closes.length === 0) return { points: [], provenance: null };
  const points = closes.map((c, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().split("T")[0],
    open: c, high: c, low: c, close: c, volume: 1000,
  }));
  return {
    points,
    provenance: {
      source: "test fixture",
      asOf: points[points.length - 1].date,
      retrievedAt: "2026-10-22T00:00:00.000Z",
      freshness: "historical",
    },
  };
}

function fakeFetcher(series: Record<string, number[]>) {
  return async (symbol: string) => history(series[symbol] ?? []);
}

describe("statistical helpers", () => {
  test("calcLogReturns computes ln(p_t / p_t-1) and skips non-positive prices", () => {
    const r = calcLogReturns([100, 110, 121]);
    assert.equal(r.length, 2);
    close(r[0], Math.log(1.1));
    close(r[1], Math.log(1.1));
    assert.deepEqual(calcLogReturns([100, 0, 50]), []);
  });

  test("mean and sample standard deviation", () => {
    close(mean([2, 4, 4, 4, 5, 5, 7, 9]), 5);
    close(stdDev([2, 4, 4, 4, 5, 5, 7, 9]), Math.sqrt(32 / 7));
    assert.equal(stdDev([5]), 0);
    assert.equal(mean([]), 0);
  });

  test("percentile uses nearest rank on a sorted array", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    assert.equal(percentile(sorted, 5), 5);
    assert.equal(percentile(sorted, 50), 50);
    assert.equal(percentile([], 50), 0);
  });
});

describe("runQuantAnalysis", () => {
  const growth = Array.from({ length: 120 }, (_, i) => 100 * 1.001 ** i);
  // Alternates +2% / -1.96%: log returns of exactly ±ln(1.02).
  const choppy = Array.from({ length: 121 }, (_, i) => (i % 2 === 0 ? 100 : 102));

  test("annualizes return and volatility from real price history", async () => {
    const report = await runQuantAnalysis(
      [{ symbol: "GROW", shares: 10 }, { symbol: "CHOP", shares: 5 }],
      1000, "moderate", 1, fakeFetcher({ GROW: growth, CHOP: choppy }), 0
    );

    const grow = report.holdings.find(h => h.symbol === "GROW")!;
    close(grow.annualizedReturn, 252 * Math.log(1.001));
    close(grow.annualizedVolatility, 0, 1e-12);
    close(grow.currentPrice, growth[growth.length - 1]);

    const chop = report.holdings.find(h => h.symbol === "CHOP")!;
    const r = calcLogReturns(choppy);
    close(chop.annualizedVolatility, stdDev(r) * Math.sqrt(252));
    close(chop.annualizedReturn, mean(r) * 252);

    close(report.portfolioValue, 10 * grow.currentPrice + 5 * chop.currentPrice + 1000, 1e-6);
    close(report.holdings.reduce((s, h) => s + h.weight, 0) + report.cashWeight, 1);
  });

  test("leaves out holdings without enough data instead of inventing values", async () => {
    const report = await runQuantAnalysis(
      [{ symbol: "GROW", shares: 10 }, { symbol: "THIN", shares: 100 }, { symbol: "NONE", shares: 1 }],
      0, "moderate", 1, fakeFetcher({ GROW: growth, THIN: [10, 11, 12, 13, 14] }), 0
    );

    assert.deepEqual(report.holdings.map(h => h.symbol), ["GROW"]);
    assert.deepEqual(report.excludedHoldings.map(e => e.symbol), ["THIN", "NONE"]);
    assert.match(report.excludedHoldings[0].reason, /Only 5 daily closes/);
    assert.match(report.excludedHoldings[1].reason, /No price history/);
    // The excluded holdings contribute nothing to portfolio value
    close(report.portfolioValue, 10 * growth[growth.length - 1], 1e-6);
  });

  test("records the source and date of every price series used", async () => {
    const report = await runQuantAnalysis(
      [{ symbol: "GROW", shares: 1 }], 0, "moderate", 1, fakeFetcher({ GROW: growth }), 0
    );
    assert.equal(report.dataSources.length, 1);
    assert.equal(report.dataSources[0].symbol, "GROW");
    assert.equal(report.dataSources[0].source, "test fixture");
    assert.equal(report.dataSources[0].observations, 120);
    assert.equal(report.dataSources[0].freshness, "historical");
  });

  test("refuses to analyze when no holding has real data", async () => {
    await assert.rejects(
      runQuantAnalysis([{ symbol: "NONE", shares: 1 }], 500, "moderate", 1, fakeFetcher({}), 0),
      InsufficientDataError
    );
  });

  test("states that the risk-free rate is a fixed assumption", async () => {
    const report = await runQuantAnalysis(
      [{ symbol: "GROW", shares: 1 }], 0, "moderate", 1, fakeFetcher({ GROW: growth }), 0
    );
    const rf = report.assumptions.find(a => a.label === "Risk-free rate")!;
    assert.match(rf.value, /not a live rate/);
  });
});
