import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { LinkedAccount, LinkedHolding, ManualHoldingLine } from "@shared/finance";
import { buildInvestmentPortfolio } from "./investmentPortfolio";

const account = (key: string, overrides: Partial<LinkedAccount> = {}): LinkedAccount => ({
  key,
  itemId: `item-${key}`,
  institutionName: "Test Institution",
  name: `${key} brokerage`,
  mask: "1234",
  type: "investment",
  subtype: "brokerage",
  assetClass: "taxable-investment",
  currentBalance: 1000,
  availableBalance: null,
  currency: "USD",
  retrievedAt: "2026-10-25T12:00:00.000Z",
  ...overrides,
});

const holding = (key: string, accountKey: string, overrides: Partial<LinkedHolding> = {}): LinkedHolding => ({
  key,
  accountKey,
  securityKey: "sec_vti",
  symbol: "VTI",
  name: "Total Market ETF",
  securityType: "etf",
  isCashEquivalent: false,
  quantity: 2,
  price: 100,
  priceAsOf: "2026-10-25",
  value: 200,
  costBasis: 180,
  currency: "USD",
  ...overrides,
});

const manual = (overrides: Partial<ManualHoldingLine> = {}): ManualHoldingLine => ({
  symbol: "VTI",
  name: "VTI manual entry",
  shares: 1,
  price: 100,
  priceAsOf: "2026-10-25",
  value: 100,
  status: "counted",
  overlapsLinked: false,
  ...overrides,
});

describe("buildInvestmentPortfolio", () => {
  test("consolidates a stable security across accounts and preserves account associations", () => {
    const result = buildInvestmentPortfolio({
      accounts: [account("taxable"), account("retirement", { assetClass: "retirement", subtype: "401k" })],
      holdings: [
        holding("h1", "taxable"),
        holding("h2", "retirement", { quantity: 3, value: 300, costBasis: 270 }),
      ],
      manualHoldings: [],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].shares, 5);
    assert.equal(result[0].marketValue, 500);
    assert.equal(result[0].costBasis, 450);
    assert.equal(result[0].valueComplete, true);
    assert.deepEqual(result[0].linkedPositions.map((p) => p.accountClass), ["taxable-investment", "retirement"]);
  });

  test("normalizes known investment types and keeps missing types unknown", () => {
    const result = buildInvestmentPortfolio({
      accounts: [account("one")],
      holdings: [
        holding("stock", "one", { securityKey: "stock", symbol: "ABC", securityType: "equity" }),
        holding("etf", "one", { securityKey: "etf", symbol: "XYZ", securityType: "ETF" }),
        holding("fund", "one", { securityKey: "fund", symbol: "FND", securityType: "mutual fund" }),
        holding("bond", "one", { securityKey: "bond", symbol: "BND", securityType: "fixed income" }),
        holding("unknown", "one", { securityKey: "unknown", symbol: null, securityType: null }),
        holding("cash", "one", { securityKey: "cash", symbol: null, securityType: "cash", isCashEquivalent: true }),
      ],
      manualHoldings: [],
    });

    assert.deepEqual(
      Object.fromEntries(result.map((position) => [position.id.split(":")[0], position.securityCategory])),
      {
        stock: "stock",
        etf: "etf",
        fund: "mutual-fund",
        bond: "bond",
        unknown: "unknown",
        cash: "cash-equivalent",
      }
    );
  });

  test("keeps duplicate and unresolved manual entries visible without counting them", () => {
    const result = buildInvestmentPortfolio({
      accounts: [account("taxable")],
      holdings: [holding("h1", "taxable")],
      manualHoldings: [
        manual({ status: "duplicate", overlapsLinked: true }),
        manual({ name: "Needs review", shares: 4, value: 400, status: "needs-review", overlapsLinked: true }),
      ],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].shares, 2);
    assert.equal(result[0].marketValue, 200);
    assert.equal(result[0].source, "mixed");
    assert.equal(result[0].manualEntries.length, 2);
  });

  test("adds a manually confirmed separate holding while retaining its manual source", () => {
    const result = buildInvestmentPortfolio({
      accounts: [account("taxable")],
      holdings: [holding("h1", "taxable")],
      manualHoldings: [manual({ status: "counted", overlapsLinked: true })],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].shares, 3);
    assert.equal(result[0].marketValue, 300);
    assert.equal(result[0].source, "mixed");
  });

  test("does not invent missing market value or cost basis", () => {
    const result = buildInvestmentPortfolio({
      accounts: [account("taxable")],
      holdings: [holding("h1", "taxable", { value: null, price: null, costBasis: null })],
      manualHoldings: [],
    });

    assert.equal(result[0].marketValue, null);
    assert.equal(result[0].valueComplete, false);
    assert.equal(result[0].costBasis, null);
    assert.equal(result[0].costBasisComplete, false);
  });

  test("keeps a manual ticker separate when it matches multiple Plaid security identities", () => {
    const result = buildInvestmentPortfolio({
      accounts: [account("one"), account("two")],
      holdings: [
        holding("h1", "one", { securityKey: "cusip_a" }),
        holding("h2", "two", { securityKey: "cusip_b" }),
      ],
      manualHoldings: [manual({ status: "needs-review", overlapsLinked: true })],
    });

    assert.equal(result.length, 3);
    assert.equal(result.filter((position) => position.symbol === "VTI").length, 3);
    assert.equal(result.find((position) => position.id === "manual:VTI")?.marketValue, null);
  });
});
