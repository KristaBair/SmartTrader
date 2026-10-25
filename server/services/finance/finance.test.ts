import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { accountKey, classifyAccount, dedupeLinkedAccounts, normalizeItem } from "./linkedAccounts";
import { buildFinancialOverview, type OverviewInput } from "./overview";
import type { LinkedAccount, LinkedHolding } from "@shared/finance";

describe("classifyAccount", () => {
  test("separates spendable cash, savings, and term deposits", () => {
    assert.equal(classifyAccount("depository", "checking"), "cash");
    assert.equal(classifyAccount("depository", "savings"), "savings");
    assert.equal(classifyAccount("depository", "money market"), "savings");
    assert.equal(classifyAccount("depository", "cd"), "term-deposit");
  });
  test("keeps retirement and restricted accounts out of taxable investments", () => {
    assert.equal(classifyAccount("investment", "401k"), "retirement");
    assert.equal(classifyAccount("investment", "roth"), "retirement");
    assert.equal(classifyAccount("investment", "hsa"), "restricted");
    assert.equal(classifyAccount("depository", "hsa"), "restricted");
    assert.equal(classifyAccount("investment", "529"), "restricted");
    assert.equal(classifyAccount("investment", "brokerage"), "taxable-investment");
  });
  test("treats credit and loans as liabilities", () => {
    assert.equal(classifyAccount("credit", "credit card"), "credit");
    assert.equal(classifyAccount("loan", "mortgage"), "loan");
  });
});

describe("accountKey", () => {
  const base = { institutionId: "ins_1", persistentAccountId: null, type: "depository", subtype: "checking", mask: "0000", name: "Plaid Checking" };
  test("is the same for one account seen through two connections", () => {
    assert.equal(accountKey({ ...base, accountId: "a" }), accountKey({ ...base, accountId: "b" }));
  });
  test("differs for different accounts at the same institution", () => {
    assert.notEqual(accountKey({ ...base, accountId: "a" }), accountKey({ ...base, accountId: "a", mask: "1111" }));
  });
  test("prefers the persistent account ID when present", () => {
    const a = accountKey({ ...base, accountId: "a", persistentAccountId: "p1", name: "Renamed" });
    const b = accountKey({ ...base, accountId: "b", persistentAccountId: "p1" });
    assert.equal(a, b);
  });
});

const plaidAccount = (id: string, overrides: Record<string, unknown> = {}) => ({
  account_id: id, name: "Plaid Checking", mask: "0000", type: "depository", subtype: "checking",
  balances: { current: 110, available: 100, iso_currency_code: "USD" }, ...overrides,
});

describe("normalizeItem + dedupeLinkedAccounts", () => {
  test("counts an account linked through two connections once, keeping the copy with holdings", () => {
    const brokerage = plaidAccount("x", { name: "Brokerage", mask: "9999", type: "investment", subtype: "brokerage", balances: { current: 500, available: null, iso_currency_code: "USD" } });
    const itemA = normalizeItem({
      itemId: "item-a", institutionId: "ins_1", institutionName: "Bank", retrievedAt: "2026-10-25T00:00:00Z",
      accounts: [plaidAccount("a1"), { ...brokerage, account_id: "a2" }], holdings: [], securities: [],
    });
    const itemB = normalizeItem({
      itemId: "item-b", institutionId: "ins_1", institutionName: "Bank", retrievedAt: "2026-10-25T00:00:00Z",
      accounts: [plaidAccount("b1"), { ...brokerage, account_id: "b2" }],
      holdings: [{ account_id: "b2", security_id: "s1", quantity: 5, institution_price: 100, institution_value: 500 }],
      securities: [{ security_id: "s1", ticker_symbol: "vti", name: "Vanguard Total", type: "etf" }],
    });
    const result = dedupeLinkedAccounts([itemA, itemB]);
    assert.equal(result.accounts.length, 2);
    assert.equal(result.duplicateAccountCount, 2);
    assert.equal(result.holdings.length, 1);
    assert.equal(result.holdings[0].symbol, "VTI");
    assert.equal(result.accounts.find((a) => a.assetClass === "taxable-investment")?.itemId, "item-b");
  });

  test("combines split lots of one security in one account", () => {
    const item = normalizeItem({
      itemId: "i", institutionId: "ins_1", institutionName: "Bank", retrievedAt: "t",
      accounts: [plaidAccount("a", { type: "investment", subtype: "brokerage" })],
      holdings: [
        { account_id: "a", security_id: "s", quantity: 2, institution_price: 10, institution_value: 20, cost_basis: 15 },
        { account_id: "a", security_id: "s", quantity: 3, institution_price: 10, institution_value: 30, cost_basis: 25 },
      ],
      securities: [{ security_id: "s", ticker_symbol: "ABC", isin: "US0000000001" }],
    });
    assert.equal(item.holdings.length, 1);
    assert.equal(item.holdings[0].quantity, 5);
    assert.equal(item.holdings[0].value, 50);
    assert.equal(item.holdings[0].costBasis, 40);
  });
});

const account = (overrides: Partial<LinkedAccount>): LinkedAccount => ({
  key: "k", itemId: "i", institutionName: "Bank", name: "Acct", mask: "0000", type: "depository",
  subtype: "checking", assetClass: "cash", currentBalance: 0, availableBalance: null, currency: "USD",
  retrievedAt: "2026-10-25T00:00:00Z", ...overrides,
});
const holding = (overrides: Partial<LinkedHolding>): LinkedHolding => ({
  key: "h", accountKey: "inv", securityKey: "tkr_VTI", symbol: "VTI", name: "VTI", securityType: "etf",
  isCashEquivalent: false, quantity: 1, price: 100, priceAsOf: null, value: 100, costBasis: null, currency: "USD", ...overrides,
});
const input = (overrides: Partial<OverviewInput>): OverviewInput => ({
  generatedAt: "2026-10-25T00:00:00Z", institutions: [], accounts: [], holdings: [], duplicateAccountCount: 0,
  manualPortfolio: null, manualPrices: {}, manualLiabilities: [], decisions: { holdings: {} }, cashFlow: null,
  plaidConfigured: true, ...overrides,
});

describe("buildFinancialOverview", () => {
  test("computes net worth from assets minus linked and manual liabilities", () => {
    const o = buildFinancialOverview(input({
      accounts: [
        account({ key: "c", currentBalance: 1000 }),
        account({ key: "s", assetClass: "savings", subtype: "savings", currentBalance: 5000 }),
        account({ key: "r", assetClass: "retirement", type: "investment", subtype: "401k", currentBalance: 20000 }),
        account({ key: "cc", assetClass: "credit", type: "credit", subtype: "credit card", currentBalance: 700 }),
      ],
      manualLiabilities: [{ id: "1", name: "Car", kind: "auto-loan", balance: 3000, monthlyPayment: 250, interestRate: 6, updatedAt: "t" }],
    }));
    assert.equal(o.totals.assets, 26000);
    assert.equal(o.totals.liabilities, 3700);
    assert.equal(o.totals.netWorth, 22300);
    assert.equal(o.totals.cash, 1000);
    assert.equal(o.totals.savings, 5000);
    assert.equal(o.totals.retirement, 20000);
  });

  test("leaves out a manual holding that overlaps a linked one until the user decides", () => {
    const base = input({
      accounts: [account({ key: "inv", assetClass: "taxable-investment", type: "investment", subtype: "brokerage", currentBalance: 1000 })],
      holdings: [holding({ value: 1000, quantity: 10 })],
      manualPortfolio: { cash: 0, investments: [{ symbol: "vti", name: "VTI", shares: 10 }] },
      manualPrices: { VTI: { price: 100, asOf: "t" } },
    });
    const unreviewed = buildFinancialOverview(base);
    assert.equal(unreviewed.totals.assets, 1000);
    assert.equal(unreviewed.manualHoldings[0].status, "needs-review");
    assert.ok(unreviewed.notices.some((n) => n.code === "RECONCILIATION_NEEDED"));

    const separate = buildFinancialOverview({ ...base, decisions: { holdings: { VTI: "separate" } } });
    assert.equal(separate.totals.assets, 2000);
    assert.equal(separate.totals.manualEstimates, 1000);

    const duplicate = buildFinancialOverview({ ...base, decisions: { holdings: { VTI: "duplicate" } } });
    assert.equal(duplicate.totals.assets, 1000);
    assert.equal(duplicate.manualHoldings[0].status, "duplicate");
  });

  test("leaves out manual cash once a bank account is linked, until confirmed separate", () => {
    const base = input({
      accounts: [account({ currentBalance: 1000 })],
      manualPortfolio: { cash: 500, investments: [] },
    });
    assert.equal(buildFinancialOverview(base).totals.cash, 1000);
    assert.equal(buildFinancialOverview({ ...base, decisions: { cash: "separate", holdings: {} } }).totals.cash, 1500);
    // With no linked bank account, manual cash is counted as an estimate.
    assert.equal(buildFinancialOverview(input({ manualPortfolio: { cash: 500, investments: [] } })).totals.cash, 500);
  });

  test("does not value unpriced manual holdings or count non-USD accounts", () => {
    const o = buildFinancialOverview(input({
      accounts: [account({ currentBalance: 900, currency: "CAD" })],
      manualPortfolio: { cash: 0, investments: [{ symbol: "XYZ", name: "XYZ", shares: 3 }] },
    }));
    assert.equal(o.totals.assets, 0);
    assert.equal(o.manualHoldings[0].status, "unpriced");
    assert.ok(o.notices.some((n) => n.code === "NON_USD_EXCLUDED"));
    assert.ok(o.notices.some((n) => n.code === "UNPRICED_HOLDINGS"));
  });

  test("reports institutions that could not be refreshed", () => {
    const o = buildFinancialOverview(input({
      institutions: [{ itemId: "i", institutionName: "Big Bank", status: "reauth-required", retrievedAt: null, accountCount: 0 }],
    }));
    assert.ok(o.notices.some((n) => n.code === "REAUTH_REQUIRED" && n.message.includes("Big Bank")));
  });

  test("uses the sum of holdings when an investment account reports no balance", () => {
    const o = buildFinancialOverview(input({
      accounts: [account({ key: "inv", assetClass: "taxable-investment", currentBalance: null })],
      holdings: [holding({ value: 250 }), holding({ key: "h2", securityKey: "tkr_BND", symbol: "BND", value: 750 })],
    }));
    assert.equal(o.totals.taxableInvestments, 1000);
  });
});
