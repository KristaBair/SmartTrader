// Financial goals. A goal is funded by one or more savings pools (or, for debt
// payoff, measured against chosen debts). Every projection is a deterministic
// calculation from stated assumptions; nothing here comes from the AI.

import { z } from "zod";

export const GOAL_TYPES = [
  "retirement", "emergency", "home", "debt-payoff", "college", "major-purchase", "investing", "custom",
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const GOAL_STATUSES = ["active", "paused", "completed", "archived"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

const money = z.number().finite().min(0).max(1_000_000_000);

export const goalInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(GOAL_TYPES),
  // Savings goals: amount to reach. Debt payoff: ignored (the target is $0 owed).
  targetAmount: money,
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  poolIds: z.array(z.string().uuid()).max(50).default([]),
  // Debt payoff only: linked credit/loan account keys and manual debt IDs.
  debtAccountKeys: z.array(z.string().min(1).max(100)).max(50).default([]),
  manualDebtIds: z.array(z.string().uuid()).max(50).default([]),
  monthlyContribution: money.nullable().default(null),
  // Assumed average annual return on the money in this goal. 0 means no growth is assumed.
  annualReturnPercent: z.number().finite().min(-20).max(20).default(0),
  notes: z.string().trim().max(1000).default(""),
  status: z.enum(GOAL_STATUSES).default("active"),
});
export type GoalInput = z.infer<typeof goalInputSchema>;

export interface Goal extends GoalInput {
  id: string;
  // Debt payoff: total owed on the chosen debts when the goal was set (the baseline).
  startingDebt: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface GoalProjection {
  // Savings: verified value of linked pools. Debt: amount paid down since the baseline.
  currentAmount: number;
  // Savings: target. Debt: starting debt.
  targetAmount: number;
  remaining: number;
  progressPercent: number;
  // With the monthly contribution and assumed return; null when it can't be reached.
  monthsToTarget: number | null;
  estimatedCompletion: string | null;
  // Monthly amount needed to reach the target by the deadline.
  requiredMonthly: number | null;
  onTrack: boolean | null;
  // Debt only: what's still owed, and whether interest was included.
  currentDebt: number | null;
  interestIncluded: boolean | null;
}

export interface GoalView extends Goal {
  projection: GoalProjection;
  assumptions: string[];
  warnings: string[];
  // Names of linked pools/debts for display; missing ones are reported in warnings.
  linkedPools: { id: string; name: string; verifiedTotal: number }[];
  linkedDebts: { key: string; label: string; balance: number | null; source: "linked" | "manual" }[];
}

export interface GoalsResponse {
  generatedAt: string;
  goals: GoalView[];
  // For the editor: what can be linked.
  pools: { id: string; name: string; archived: boolean }[];
  debts: { key: string; label: string; balance: number; source: "linked" | "manual"; interestRate: number | null }[];
}
