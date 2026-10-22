import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { applyVerifiedPrices, formatQuotesForPrompt } from "./verifiedPrices";
import type { StockQuote } from "./finnhub";

const quote: StockQuote = {
  symbol: "AAPL", name: "AAPL", price: 187.5, change: 1.2, changePercent: 0.64,
  volume: 0, high: 188, low: 185, open: 186, previousClose: 186.3,
  provenance: {
    source: "Finnhub /quote",
    asOf: "2026-10-21T15:00:00.000Z",
    retrievedAt: "2026-10-21T15:00:05.000Z",
    freshness: "real-time",
  },
};

const rec = (symbol: string, currentPrice?: number) => ({
  symbol, name: symbol, action: "BUY" as const, confidence: 70, reasoning: "test", currentPrice,
});

describe("applyVerifiedPrices", () => {
  test("replaces a model-supplied price with the verified quote and its provenance", () => {
    const [out] = applyVerifiedPrices([rec("AAPL", 999)], { AAPL: quote });
    assert.equal(out.currentPrice, 187.5);
    assert.equal(out.priceSource, "Finnhub /quote");
    assert.equal(out.priceAsOf, "2026-10-21T15:00:00.000Z");
    assert.equal(out.priceFreshness, "real-time");
  });

  test("removes the price when no verified quote exists", () => {
    const [out] = applyVerifiedPrices([rec("ZZZZ", 42)], { ZZZZ: null });
    assert.equal(out.currentPrice, undefined);
    assert.equal(out.priceSource, undefined);
  });

  test("matches symbols case-insensitively", () => {
    const [out] = applyVerifiedPrices([rec("aapl", 1)], { AAPL: quote });
    assert.equal(out.currentPrice, 187.5);
  });
});

describe("formatQuotesForPrompt", () => {
  test("lists verified quotes with source, timestamp, and freshness", () => {
    const text = formatQuotesForPrompt({ AAPL: quote, ZZZZ: null });
    assert.match(text, /AAPL: \$187\.50/);
    assert.match(text, /Finnhub \/quote, as of 2026-10-21T15:00:00\.000Z, real-time/);
    assert.doesNotMatch(text, /ZZZZ/);
  });

  test("says so explicitly when nothing could be verified", () => {
    assert.match(formatQuotesForPrompt({}), /no verified quotes available/);
  });
});
