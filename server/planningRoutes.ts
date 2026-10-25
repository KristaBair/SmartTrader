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
import { spendingPrefsSchema, type CashflowResponse, type SpendingInsights } from "@shared/cashflow";
import { rentInputSchema, retirementInputSchema, type PlannerDefaults } from "@shared/planners";
import { calculateRent, calculateRetirement } from "./services/finance/planners";
import { roundMoney } from "./services/finance/projections";

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

// Sum of monthly averages for categories matching a test, from spending insights.
function categoryMonthly(insights: SpendingInsights | null, match: (category: string, cls: string) => boolean) {
  return roundMoney((insights?.categories ?? []).filter((c) => match(c.category, c.class)).reduce((s, c) => s + c.monthlyAverage, 0));
}

export async function loadPlannerDefaults(userId: string): Promise<PlannerDefaults> {
  const linked = await loadLinkedFinancialData(userId);
  const [plaidItems, prefs, poolsResponse, goals] = await Promise.all([
    storage.getPlaidItems(userId),
    storage.getSpendingPrefs(userId),
    buildPoolsResponse(userId, linked),
    storage.getGoals(userId),
  ]);
  const { insights, notice } = await loadSpendingInsights(userId, linked.plaidConfigured, plaidItems, prefs);
  const m = insights?.monthly;
  const isRent = (c: string) => c === "RENT_AND_UTILITIES_RENT";
  const currentRent = insights ? categoryMonthly(insights, (c) => isRent(c)) : null;
  const utilities = categoryMonthly(insights, (c, cls) => c.startsWith("RENT_AND_UTILITIES_") && !isRent(c) && cls === "essential");
  const transportation = categoryMonthly(insights, (c, cls) => c.startsWith("TRANSPORTATION_") && cls === "essential");
  const insurance = categoryMonthly(insights, (c, cls) => c === "GENERAL_SERVICES_INSURANCE" && cls === "essential");
  const groceries = categoryMonthly(insights, (c, cls) => c === "FOOD_AND_DRINK_GROCERIES" && cls === "essential");
  const essentialTotal = m ? m.essential : 0;
  const otherEssentials = roundMoney(Math.max(0, essentialTotal - (currentRent ?? 0) - utilities - transportation - insurance - groceries) + (m?.manualEssential ?? 0) + (m?.uncategorized ?? 0));

  const activePools = poolsResponse.pools.filter((p) => !p.archived);
  const emergencyMonthly = roundMoney(activePools.filter((p) => p.category === "emergency").reduce((s, p) => s + (p.monthlyContributionGoal ?? 0), 0));
  const otherPoolMonthly = activePools.filter((p) => p.category !== "emergency").reduce((s, p) => s + (p.monthlyContributionGoal ?? 0), 0);
  // Goals that aren't funded through a pool, so their plan isn't already counted.
  const goalOnlyMonthly = goals
    .filter((g) => g.status === "active" && g.type !== "debt-payoff" && g.poolIds.length === 0)
    .reduce((s, g) => s + (g.monthlyContribution ?? 0), 0);

  const notices: string[] = [];
  if (notice) notices.push(notice.message);
  if (!insights) notices.push("Spending couldn't be read from a linked bank account, so enter your monthly costs yourself.");
  if (currentRent) notices.push(`Your current rent ($${currentRent.toFixed(2)}/month) is left out of other costs, since it's what you're replacing.`);

  return {
    rent: {
      monthlyTakeHome: insights?.income.usedMonthly ?? 0,
      grossMonthlyIncome: null,
      debtPayments: roundMoney((m?.debtPayments ?? 0) + (m?.manualDebt ?? 0)),
      utilities,
      transportation,
      insurance,
      groceries,
      otherEssentials,
      discretionary: roundMoney((m?.discretionary ?? 0) + (m?.manualDiscretionary ?? 0)),
      emergencyFundContribution: emergencyMonthly,
      otherSavings: roundMoney(otherPoolMonthly + goalOnlyMonthly),
      bufferPercent: 5,
      currentRent,
      sources: {
        monthlyTakeHome: insights?.income.confirmedMonthly !== null && insights ? "Take-home pay you confirmed" : "Deposits detected in linked accounts",
        debtPayments: "Loan payments in linked accounts plus debt payments you added (credit card payments excluded)",
        utilities: "Utilities, internet, and phone from linked accounts",
        transportation: "Essential transportation from linked accounts",
        insurance: "Insurance from linked accounts",
        groceries: "Groceries from linked accounts",
        otherEssentials: "Other essential and unclassified spending, plus essentials you added",
        discretionary: "Discretionary spending from linked accounts plus what you added",
        emergencyFundContribution: "Monthly goals on your emergency pools",
        otherSavings: "Monthly goals on your other pools, plus goals not funded by a pool",
      },
    },
    retirement: {
      retirementAccountsTotal: roundMoney(linked.accounts.filter((a) => a.assetClass === "retirement").reduce((s, a) => s + Math.max(0, a.currentBalance ?? 0), 0)),
      retirementPoolsTotal: roundMoney(activePools.filter((p) => p.category === "retirement").reduce((s, p) => s + p.verifiedTotal, 0)),
      retirementPoolIds: activePools.filter((p) => p.category === "retirement").map((p) => p.id),
      detectedMonthlySavingsTransfers: m?.savingsContributions ?? 0,
      retirementGoals: goals.filter((g) => g.type === "retirement" && g.status !== "archived").map((g) => ({ id: g.id, name: g.name })),
    },
    notices,
  };
}

export function registerPlanningRoutes(app: Express) {
  app.get("/api/planning/defaults", async (_req, res) => {
    try {
      res.json(await loadPlannerDefaults(getUserId(res)));
    } catch (error) {
      console.error("Planner defaults error:", error);
      res.status(500).json({ message: "Could not prefill the planner." });
    }
  });

  // Pure calculations; nothing is stored.
  app.post("/api/planning/rent", (req, res) => {
    const parsed = rentInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid rent inputs" });
    res.json(calculateRent(parsed.data));
  });

  app.post("/api/planning/retirement", (req, res) => {
    const parsed = retirementInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid retirement inputs" });
    res.json(calculateRetirement(parsed.data));
  });

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
