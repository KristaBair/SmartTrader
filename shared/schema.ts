// Types shared by the client and server.
// User data lives in DynamoDB (one partition per Cognito user). The zod schemas
// below validate request bodies before anything is written.

import { z } from "zod";

// ── Market data (dashboard overview: SPY, QQQ, VIX) ─────────────────────────

export interface MarketData {
  symbol: string;
  price: string;
  change: string;
  changePercent: string;
  updatedAt?: string;
}

// ── AI recommendations ──────────────────────────────────────────────────────
// The model returns numbers, but older cached results stored strings, so price
// fields accept either.

const numeric = z.union([z.number(), z.string()]).nullish();

export const recommendationSchema = z.object({
  id: z.string().optional(),
  symbol: z.string(),
  name: z.string(),
  action: z.enum(["BUY", "SELL"]),
  confidence: z.number(),
  reasoning: z.string(),
  targetPrice: numeric,
  currentPrice: numeric,
  expectedReturn: numeric,
  recommendedAmount: numeric,
  // Provenance of currentPrice. Set by the server from a verified quote, never by the model.
  priceSource: z.string().nullish(),
  priceAsOf: z.string().nullish(),
  priceFreshness: z.string().nullish(),
});

export type Recommendation = z.infer<typeof recommendationSchema>;

// ── Saved portfolio ─────────────────────────────────────────────────────────

export const savedPortfolioSchema = z.object({
  cash: z.number(),
  investments: z.array(
    z.object({
      symbol: z.string().min(1).max(12),
      name: z.string(),
      shares: z.number(),
      averagePrice: z.number(),
    })
  ).max(500),
  riskTolerance: z.string(),
  timeline: z.string(),
  lastUpdated: z.string(),
});

export type SavedPortfolio = z.infer<typeof savedPortfolioSchema>;

// ── Saved onboarding answers ────────────────────────────────────────────────

export const savedOnboardingSchema = z.object({
  completed: z.boolean(),
  savingsAmount: z.number(),
  contributionFrequency: z.string(),
  contributionAmount: z.number(),
  // Whatever the AI suggested during onboarding, kept as-is for reference.
  suggestions: z.unknown(),
  completedAt: z.string(),
});

export type SavedOnboarding = z.infer<typeof savedOnboardingSchema>;

// Everything the client loads for the signed-in user in one request.
export interface UserData {
  portfolio: SavedPortfolio | null;
  onboarding: SavedOnboarding | null;
  recommendations: Recommendation[];
}

// Additional types for frontend
export type RiskTolerance = "Conservative" | "Moderate" | "Aggressive";
export type Timeline = "Short-term (< 1 year)" | "Medium-term (1-5 years)" | "Long-term (5+ years)";
export type Action = "BUY" | "SELL";
export type ContributionFrequency = "weekly" | "biweekly" | "monthly" | "irregular";
