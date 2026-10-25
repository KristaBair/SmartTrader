// API for the unified financial overview: live linked data reconciled with the
// user's manual entries. Registered after requireAuth and the Terms check, so
// every handler has a verified user ID and current consent.

import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { storage } from "./storage";
import { getUserId } from "./auth";
import { getMultipleQuotes } from "./services/finnhub";
import {
  manualLiabilitySchema,
  reconciliationSchema,
  type CashFlowSummary,
  type DataNotice,
  type FinancialOverview,
} from "@shared/finance";
import { buildFinancialOverview, type VerifiedPrice } from "./services/finance/overview";
import {
  loadLinkedFinancialData,
  loadSpendingAnalysis,
  logPlaidFailure,
  SpendingAnalysisError,
} from "./services/finance/plaidData";

// Everything the overview needs, loaded in parallel. Also used by savings pools,
// goals, and planners so they all work from the same reconciled numbers.
export async function loadFinancialOverview(userId: string): Promise<FinancialOverview> {
  const [linked, userData, decisions, manualLiabilities, plaidItems] = await Promise.all([
    loadLinkedFinancialData(userId),
    storage.getUserData(userId),
    storage.getReconciliation(userId),
    storage.getManualLiabilities(userId),
    storage.getPlaidItems(userId),
  ]);

  const portfolio = userData.portfolio;
  const symbols = Array.from(new Set((portfolio?.investments ?? []).map((i) => i.symbol.trim().toUpperCase())));
  const quotes = symbols.length > 0 ? await getMultipleQuotes(symbols) : {};
  const manualPrices: Record<string, VerifiedPrice> = {};
  for (const [symbol, quote] of Object.entries(quotes)) {
    manualPrices[symbol] = { price: quote.price, asOf: quote.provenance.asOf };
  }

  const extraNotices: DataNotice[] = [];
  let cashFlow: CashFlowSummary | null = null;
  if (linked.plaidConfigured && plaidItems.some((item) => (item.products || []).includes("transactions"))) {
    try {
      const { analysis } = await loadSpendingAnalysis(userId);
      cashFlow = {
        periodStart: analysis.periodStart,
        periodEnd: analysis.periodEnd,
        monthlyIncome: analysis.monthlyIncome,
        monthlyExpenses: analysis.monthlyExpenses,
        monthlySurplus: analysis.monthlySurplus,
      };
    } catch (error) {
      if (!(error instanceof SpendingAnalysisError)) logPlaidFailure("overview-cash-flow", error);
      extraNotices.push({
        level: "warning",
        code: "CASH_FLOW_UNAVAILABLE",
        message: error instanceof SpendingAnalysisError ? error.message : "Income and spending could not be loaded from your bank connection.",
      });
    }
  } else {
    extraNotices.push({
      level: "info",
      code: "CASH_FLOW_NOT_LINKED",
      message: "Link a bank account for spending to see income, spending, and monthly cash flow.",
    });
  }

  const overview = buildFinancialOverview({
    generatedAt: new Date().toISOString(),
    institutions: linked.institutions,
    accounts: linked.accounts,
    holdings: linked.holdings,
    duplicateAccountCount: linked.duplicateAccountCount,
    manualPortfolio: portfolio
      ? { cash: portfolio.cash, investments: portfolio.investments.map((i) => ({ symbol: i.symbol, name: i.name, shares: i.shares })) }
      : null,
    manualPrices,
    manualLiabilities,
    decisions,
    cashFlow,
    plaidConfigured: linked.plaidConfigured,
  });
  overview.notices.push(...extraNotices);
  return overview;
}

export function registerFinanceRoutes(app: Express) {
  app.get("/api/finances/overview", async (_req, res) => {
    try {
      res.json(await loadFinancialOverview(getUserId(res)));
    } catch (error) {
      console.error("Financial overview error:", error);
      res.status(500).json({ message: "Could not build your financial overview." });
    }
  });

  // Whether manual entries are the same money as linked accounts.
  app.put("/api/finances/reconciliation", async (req, res) => {
    const parsed = reconciliationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid reconciliation choices" });
    const holdings = Object.fromEntries(
      Object.entries(parsed.data.holdings).map(([symbol, choice]) => [symbol.trim().toUpperCase(), choice])
    );
    try {
      await storage.saveReconciliation(getUserId(res), { ...parsed.data, holdings });
      res.status(204).end();
    } catch (error) {
      console.error("Save reconciliation error:", error);
      res.status(500).json({ message: "Could not save your choices." });
    }
  });

  app.get("/api/finances/liabilities", async (_req, res) => {
    try {
      res.json(await storage.getManualLiabilities(getUserId(res)));
    } catch (error) {
      console.error("Load liabilities error:", error);
      res.status(500).json({ message: "Could not load your debts." });
    }
  });

  app.post("/api/finances/liabilities", async (req, res) => {
    const parsed = manualLiabilitySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid debt details" });
    try {
      const userId = getUserId(res);
      if ((await storage.getManualLiabilities(userId)).length >= 100) {
        return res.status(409).json({ message: "You can enter up to 100 debts." });
      }
      const liability = { ...parsed.data, id: randomUUID(), updatedAt: new Date().toISOString() };
      await storage.saveManualLiability(userId, liability);
      res.status(201).json(liability);
    } catch (error) {
      console.error("Save liability error:", error);
      res.status(500).json({ message: "Could not save this debt." });
    }
  });

  app.put("/api/finances/liabilities/:id", async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = manualLiabilitySchema.safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ message: "Invalid debt details" });
    try {
      const userId = getUserId(res);
      const exists = (await storage.getManualLiabilities(userId)).some((l) => l.id === id.data);
      if (!exists) return res.status(404).json({ message: "Debt not found" });
      const liability = { ...parsed.data, id: id.data, updatedAt: new Date().toISOString() };
      await storage.saveManualLiability(userId, liability);
      res.json(liability);
    } catch (error) {
      console.error("Update liability error:", error);
      res.status(500).json({ message: "Could not update this debt." });
    }
  });

  app.delete("/api/finances/liabilities/:id", async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Invalid debt" });
    try {
      const deleted = await storage.deleteManualLiability(getUserId(res), id.data);
      if (!deleted) return res.status(404).json({ message: "Debt not found" });
      res.status(204).end();
    } catch (error) {
      console.error("Delete liability error:", error);
      res.status(500).json({ message: "Could not delete this debt." });
    }
  });
}
