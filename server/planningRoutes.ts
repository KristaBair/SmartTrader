// Planning calculators: spending insights, emergency fund, and (later) rent and
// retirement. Registered after requireAuth and the Terms check.

import type { Express } from "express";
import { storage } from "./storage";
import { getUserId } from "./auth";
import { loadLinkedFinancialData } from "./services/finance/plaidData";
import { buildEmergencyPlan, normalizeMerchant } from "./services/finance/cashflow";
import { manualCashLine } from "./services/finance/overview";
import { buildPoolsResponse } from "./poolRoutes";
import { loadSpendingInsights } from "./financeRoutes";
import { spendingPrefsSchema, type CashflowResponse } from "@shared/cashflow";

const MAX_OVERRIDES = 500;

export async function loadCashflow(userId: string): Promise<CashflowResponse> {
  const linked = await loadLinkedFinancialData(userId);
  const [plaidItems, prefs, userData, decisions, poolsResponse] = await Promise.all([
    storage.getPlaidItems(userId),
    storage.getSpendingPrefs(userId),
    storage.getUserData(userId),
    storage.getReconciliation(userId),
    buildPoolsResponse(userId, linked),
  ]);
  const spending = await loadSpendingInsights(userId, linked.plaidConfigured, plaidItems, prefs);
  const manualCash = manualCashLine(userData.portfolio?.cash ?? 0, linked.accounts, decisions);
  const emergency = buildEmergencyPlan({
    now: new Date(),
    insights: spending.insights,
    prefs,
    accounts: linked.accounts,
    manualCashCounted: manualCash?.status === "counted" ? manualCash.amount : 0,
    pools: poolsResponse.pools,
  });
  if (spending.notice) emergency.notices.unshift(spending.notice.message);
  for (const inst of linked.institutions) {
    if (inst.status !== "connected") emergency.notices.push(`${inst.institutionName} couldn't be refreshed, so its balances aren't included.`);
  }
  return { generatedAt: new Date().toISOString(), spending: spending.insights, emergency, prefs };
}

export function registerPlanningRoutes(app: Express) {
  app.get("/api/planning/cashflow", async (_req, res) => {
    try {
      res.json(await loadCashflow(getUserId(res)));
    } catch (error) {
      console.error("Cash flow planning error:", error);
      res.status(500).json({ message: "Could not analyze your spending." });
    }
  });

  app.get("/api/planning/spending-prefs", async (_req, res) => {
    try {
      res.json(await storage.getSpendingPrefs(getUserId(res)));
    } catch (error) {
      console.error("Load spending prefs error:", error);
      res.status(500).json({ message: "Could not load your spending settings." });
    }
  });

  // Replaces the user's classification choices and added expenses.
  app.put("/api/planning/spending-prefs", async (req, res) => {
    const parsed = spendingPrefsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid preferences" });
    const prefs = parsed.data;
    if (Object.keys(prefs.categoryOverrides).length + Object.keys(prefs.merchantOverrides).length > MAX_OVERRIDES) {
      return res.status(400).json({ message: `Up to ${MAX_OVERRIDES} classification changes are supported.` });
    }
    const normalized = {
      ...prefs,
      categoryOverrides: Object.fromEntries(Object.entries(prefs.categoryOverrides).map(([k, v]) => [k.trim().toUpperCase(), v])),
      merchantOverrides: Object.fromEntries(
        Object.entries(prefs.merchantOverrides).map(([k, v]) => [normalizeMerchant(k), v]).filter(([k]) => k !== "")
      ),
    };
    try {
      await storage.saveSpendingPrefs(getUserId(res), normalized);
      res.json(normalized);
    } catch (error) {
      console.error("Save spending prefs error:", error);
      res.status(500).json({ message: "Could not save your changes." });
    }
  });
}
