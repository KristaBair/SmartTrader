// The signed-in user's saved data: portfolio, onboarding answers, and the last AI
// recommendations. It lives in DynamoDB (through /api/me/*). We load it once at
// sign-in and keep a copy in memory so pages can read it synchronously; every save
// updates that copy right away and writes through to the server in the background.

import { apiRequest } from "./queryClient";
import { toast } from "@/hooks/use-toast";
import type {
  Recommendation,
  SavedOnboarding,
  SavedPortfolio,
  UserData,
} from "@shared/schema";

export type { SavedOnboarding, SavedPortfolio };

// Shape the dashboard summary widgets need. Derived from a SavedPortfolio so the
// presentational components don't have to know about the storage layout.
export interface PortfolioView {
  cash: string;
  investments: { symbol: string; name: string; currentValue: number }[];
  initialInvestment?: string | null;
  monthlyContribution?: string | null;
  totalContributions?: string | null;
}

export function toPortfolioView(p: SavedPortfolio | null): PortfolioView | undefined {
  if (!p) return undefined;
  return {
    cash: String(p.cash ?? 0),
    investments: p.investments.map((i) => ({
      symbol: i.symbol,
      name: i.name,
      currentValue: i.shares * i.averagePrice,
    })),
  };
}

const empty = (): UserData => ({ portfolio: null, onboarding: null, recommendations: [] });

let cache: UserData = empty();

// Writes run one after another so a slow request can never overwrite a newer one.
let writeQueue: Promise<unknown> = Promise.resolve();

function writeThrough(method: string, url: string, body?: unknown): Promise<void> {
  const next = writeQueue.then(() => apiRequest(method, url, body)).then(
    () => undefined,
    (error) => {
      console.error(`Failed to save ${url}:`, error);
      toast({
        title: "Couldn't save your changes",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    }
  );
  writeQueue = next;
  return next;
}

// ── Session lifecycle ──────────────────────────────────────────────────────

export async function loadUserData(): Promise<void> {
  const res = await apiRequest("GET", "/api/me/data");
  cache = (await res.json()) as UserData;
}

export function clearUserDataCache() {
  cache = empty();
}

// ── Onboarding ─────────────────────────────────────────────────────────────

export function getOnboarding(): SavedOnboarding | null {
  return cache.onboarding;
}

export function saveOnboarding(data: SavedOnboarding): Promise<void> {
  cache = { ...cache, onboarding: data };
  return writeThrough("PUT", "/api/me/onboarding", data);
}

// ── Portfolio ──────────────────────────────────────────────────────────────

export function getPortfolio(): SavedPortfolio | null {
  return cache.portfolio;
}

export function savePortfolio(data: SavedPortfolio): Promise<void> {
  // Stamp lastUpdated automatically so we never forget
  const portfolio = { ...data, lastUpdated: new Date().toISOString() };
  cache = { ...cache, portfolio };
  return writeThrough("PUT", "/api/me/portfolio", portfolio);
}

// ── Recommendations ────────────────────────────────────────────────────────

export function getRecommendations(): Recommendation[] {
  return cache.recommendations;
}

export function saveRecommendations(data: Recommendation[]): Promise<void> {
  cache = { ...cache, recommendations: data };
  return writeThrough("PUT", "/api/me/recommendations", data);
}

// ── Reset ──────────────────────────────────────────────────────────────────
// Wipes portfolio, onboarding, and recommendations for the signed-in user.

export function clearAll(): Promise<void> {
  cache = empty();
  return writeThrough("DELETE", "/api/me/data");
}
