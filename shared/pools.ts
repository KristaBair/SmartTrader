// Savings pools: named, virtual earmarks on money the user already has in
// linked accounts. A pool never moves money, sells anything, or adds to net
// worth; it only records "this part of that account is for this goal".

import { z } from "zod";
import type { AssetClass, DataNotice } from "./finance";

export const POOL_CATEGORIES = [
  "emergency", "house", "ring", "college", "retirement", "vacation", "car", "custom",
] as const;
export type PoolCategory = (typeof POOL_CATEGORIES)[number];

export const POOL_ICONS = [
  "shield", "home", "gem", "graduation-cap", "sunset", "plane", "car", "piggy-bank",
  "heart", "gift", "briefcase", "baby", "paw-print", "wrench", "star",
] as const;
export type PoolIcon = (typeof POOL_ICONS)[number];

const money = z.number().finite().min(0).max(1_000_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const poolInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  category: z.enum(POOL_CATEGORIES),
  icon: z.enum(POOL_ICONS),
  description: z.string().trim().max(500).default(""),
  targetAmount: money.refine((v) => v > 0, "Target must be more than $0"),
  targetDate: isoDate.nullable().default(null),
  monthlyContributionGoal: money.nullable().default(null),
  archived: z.boolean().default(false),
});
export type PoolInput = z.infer<typeof poolInputSchema>;

export interface Pool extends PoolInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

// ── Allocations ─────────────────────────────────────────────────────────────

// Dollars of an account's balance, or a number of shares of one holding.
export const allocationInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("amount"),
    poolId: z.string().uuid(),
    accountKey: z.string().min(1).max(100),
    amount: money.refine((v) => v > 0, "Amount must be more than $0"),
  }),
  z.object({
    kind: z.literal("shares"),
    poolId: z.string().uuid(),
    accountKey: z.string().min(1).max(100),
    securityKey: z.string().min(1).max(100),
    shares: z.number().finite().positive().max(1_000_000_000),
  }),
]);
export type AllocationInput = z.infer<typeof allocationInputSchema>;

// Descriptive fields are copied from the linked account when the allocation is
// made, so the record still makes sense if the account later disconnects.
export type Allocation = AllocationInput & {
  id: string;
  itemId: string;
  accountLabel: string;
  assetClass: AssetClass;
  symbol: string | null;
  securityName: string | null;
  createdAt: string;
  updatedAt: string;
};

export interface AllocationLedger {
  version: number;
  allocations: Allocation[];
}

export type AllocationAction = "pool-created" | "pool-updated" | "pool-archived" | "pool-restored" | "allocated" | "changed" | "released";

export interface AllocationHistoryEntry {
  id: string;
  poolId: string;
  at: string;
  action: AllocationAction;
  description: string;
}

// ── Computed views ──────────────────────────────────────────────────────────

// Why an allocation's value is or isn't fully verified right now.
export type AllocationState =
  | "verified"          // source found; value fully backed
  | "over-allocated"    // source shrank below total allocations; value pro-rated
  | "unavailable"       // institution couldn't be refreshed; value not verified
  | "disconnected"      // connection removed; kept for the record
  | "missing";          // connection works but the account/holding is gone

export type AllocationView = Allocation & {
  state: AllocationState;
  // Value counted toward the pool now (USD), after any pro-rating.
  verifiedValue: number;
  // For dollar allocations, the amount the user set; for shares, null when unpriced.
  nominalValue: number | null;
  price: number | null;
  priceSource: string | null;
  priceAsOf: string | null;
};

export interface PoolView extends Pool {
  allocations: AllocationView[];
  verifiedTotal: number;
  // Allocations that couldn't be verified right now, at their recorded amounts.
  unverifiedAmount: number;
  progressPercent: number;
  remaining: number;
  // At the monthly goal, no investment growth assumed. Null if no goal or already funded.
  estimatedCompletion: string | null;
  monthsToComplete: number | null;
  // Monthly amount that would reach the target by the target date.
  requiredMonthly: number | null;
  warnings: string[];
}

// One account or holding that can fund pools, with how much is already earmarked.
export interface FundingSource {
  kind: "amount" | "shares";
  accountKey: string;
  securityKey: string | null;
  itemId: string;
  label: string;
  institutionName: string;
  assetClass: AssetClass;
  symbol: string | null;
  // Dollars (amount sources) or shares (share sources).
  capacity: number;
  allocated: number;
  remaining: number;
  price: number | null;
  priceSource: string | null;
  priceAsOf: string | null;
  // Shares only: the institution's price, used to count earmarked shares against
  // their account's institution-reported value so both use the same basis.
  basisPrice: number | null;
  // Explains what capacity is based on (e.g. "lower of current and available").
  basis: string;
}

export interface UnallocatedByClass {
  assetClass: AssetClass;
  total: number;
  allocated: number;
  unallocated: number;
}

export interface PoolsResponse {
  generatedAt: string;
  pools: PoolView[];
  sources: FundingSource[];
  unallocated: UnallocatedByClass[];
  ledgerVersion: number;
  notices: DataNotice[];
}
