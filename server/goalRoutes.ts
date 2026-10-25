// API for financial goals. Registered after requireAuth and the Terms check.

import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { storage } from "./storage";
import { getUserId } from "./auth";
import { loadLinkedFinancialData } from "./services/finance/plaidData";
import { buildGoalViews, currentDebtFor } from "./services/finance/goals";
import { buildPoolsResponse } from "./poolRoutes";
import { LIABILITY_CLASSES, type LinkedAccount, type ManualLiability } from "@shared/finance";
import { goalInputSchema, type Goal, type GoalInput, type GoalsResponse } from "@shared/goals";

const MAX_GOALS = 200;

export async function loadGoals(userId: string): Promise<GoalsResponse> {
  const linked = await loadLinkedFinancialData(userId);
  const [poolsResponse, goals, manualDebts] = await Promise.all([
    buildPoolsResponse(userId, linked),
    storage.getGoals(userId),
    storage.getManualLiabilities(userId),
  ]);
  const debtAccounts = linked.accounts.filter((a) => LIABILITY_CLASSES.includes(a.assetClass));
  return {
    generatedAt: new Date().toISOString(),
    goals: buildGoalViews({ now: new Date(), goals, pools: poolsResponse.pools, debtAccounts, manualDebts }),
    pools: poolsResponse.pools.map((p) => ({ id: p.id, name: p.name, archived: p.archived })),
    debts: debtOptions(debtAccounts, manualDebts),
  };
}

function debtOptions(debtAccounts: LinkedAccount[], manualDebts: ManualLiability[]): GoalsResponse["debts"] {
  return [
    ...debtAccounts.map((a) => ({
      key: a.key, label: `${a.name}${a.mask ? ` ••${a.mask}` : ""}`, balance: Math.max(0, a.currentBalance ?? 0),
      source: "linked" as const, interestRate: null,
    })),
    ...manualDebts.map((d) => ({ key: d.id, label: d.name, balance: d.balance, source: "manual" as const, interestRate: d.interestRate })),
  ];
}

// Checks that every referenced pool and debt belongs to this user and exists now.
async function validateReferences(userId: string, input: GoalInput) {
  const [pools, manualDebts] = await Promise.all([storage.getPools(userId), storage.getManualLiabilities(userId)]);
  if (input.poolIds.some((id) => !pools.some((p) => p.id === id))) return { error: "One of the selected pools doesn't exist." };
  if (input.manualDebtIds.some((id) => !manualDebts.some((d) => d.id === id))) return { error: "One of the selected debts doesn't exist." };
  if (input.type !== "debt-payoff") return { error: null, manualDebts, debtAccounts: [] as LinkedAccount[] };
  if (input.debtAccountKeys.length + input.manualDebtIds.length === 0) return { error: "Choose at least one debt to pay off." };
  const linked = input.debtAccountKeys.length > 0 ? await loadLinkedFinancialData(userId) : null;
  const debtAccounts = (linked?.accounts ?? []).filter((a) => LIABILITY_CLASSES.includes(a.assetClass));
  if (input.debtAccountKeys.some((k) => !debtAccounts.some((a) => a.key === k))) return { error: "One of the selected linked debts isn't available right now." };
  return { error: null, manualDebts, debtAccounts };
}

const normalize = (input: GoalInput): GoalInput => ({
  ...input,
  poolIds: Array.from(new Set(input.poolIds)),
  // Only debt goals use debts, and only savings goals use pools.
  debtAccountKeys: input.type === "debt-payoff" ? Array.from(new Set(input.debtAccountKeys)) : [],
  manualDebtIds: input.type === "debt-payoff" ? Array.from(new Set(input.manualDebtIds)) : [],
  targetAmount: input.type === "debt-payoff" ? 0 : input.targetAmount,
});

export function registerGoalRoutes(app: Express) {
  app.get("/api/goals", async (_req, res) => {
    try {
      res.json(await loadGoals(getUserId(res)));
    } catch (error) {
      console.error("Load goals error:", error);
      res.status(500).json({ message: "Could not load your goals." });
    }
  });

  app.post("/api/goals", async (req, res) => {
    const parsed = goalInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid goal" });
    const input = normalize(parsed.data);
    if (input.type !== "debt-payoff" && input.targetAmount <= 0) return res.status(400).json({ message: "Enter a target greater than $0." });
    try {
      const userId = getUserId(res);
      if ((await storage.getGoals(userId)).length >= MAX_GOALS) return res.status(409).json({ message: `You can have up to ${MAX_GOALS} goals.` });
      const refs = await validateReferences(userId, input);
      if (refs.error) return res.status(422).json({ message: refs.error });
      const now = new Date().toISOString();
      const goal: Goal = {
        ...input,
        id: randomUUID(),
        startingDebt: input.type === "debt-payoff" ? currentDebtFor(input, refs.debtAccounts!, refs.manualDebts!).total : null,
        createdAt: now,
        updatedAt: now,
        completedAt: input.status === "completed" ? now : null,
      };
      await storage.saveGoal(userId, goal);
      res.status(201).json(goal);
    } catch (error) {
      console.error("Create goal error:", error);
      res.status(500).json({ message: "Could not create the goal." });
    }
  });

  app.put("/api/goals/:id", async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = goalInputSchema.safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ message: parsed.success ? "Invalid goal" : parsed.error.issues[0]?.message ?? "Invalid goal" });
    const input = normalize(parsed.data);
    if (input.type !== "debt-payoff" && input.targetAmount <= 0) return res.status(400).json({ message: "Enter a target greater than $0." });
    try {
      const userId = getUserId(res);
      const existing = (await storage.getGoals(userId)).find((g) => g.id === id.data);
      if (!existing) return res.status(404).json({ message: "Goal not found" });
      const refs = await validateReferences(userId, input);
      if (refs.error) return res.status(422).json({ message: refs.error });
      // Changing which debts a payoff goal tracks resets its baseline to today's balance.
      const debtsChanged = input.type === "debt-payoff" && (
        existing.type !== "debt-payoff"
        || [...existing.debtAccountKeys].sort().join() !== [...input.debtAccountKeys].sort().join()
        || [...existing.manualDebtIds].sort().join() !== [...input.manualDebtIds].sort().join()
      );
      const now = new Date().toISOString();
      const goal: Goal = {
        ...existing,
        ...input,
        startingDebt: input.type !== "debt-payoff"
          ? null
          : debtsChanged ? currentDebtFor(input, refs.debtAccounts!, refs.manualDebts!).total : existing.startingDebt,
        updatedAt: now,
        completedAt: input.status === "completed" ? existing.completedAt ?? now : null,
      };
      await storage.saveGoal(userId, goal);
      res.json(goal);
    } catch (error) {
      console.error("Update goal error:", error);
      res.status(500).json({ message: "Could not update the goal." });
    }
  });

  // Only archived goals can be deleted, so history isn't lost by accident.
  app.delete("/api/goals/:id", async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Invalid goal" });
    try {
      const userId = getUserId(res);
      const existing = (await storage.getGoals(userId)).find((g) => g.id === id.data);
      if (!existing) return res.status(404).json({ message: "Goal not found" });
      if (existing.status !== "archived") return res.status(409).json({ message: "Archive the goal before deleting it." });
      await storage.deleteGoal(userId, id.data);
      res.status(204).end();
    } catch (error) {
      console.error("Delete goal error:", error);
      res.status(500).json({ message: "Could not delete the goal." });
    }
  });
}
