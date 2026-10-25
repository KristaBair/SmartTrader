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
  TermsAcceptance,
  UserData,
} from "@shared/schema";
import { TERMS_VERSION } from "@shared/terms";

export type { SavedOnboarding, SavedPortfolio };

// Shape the dashboard summary widgets need. Derived from a SavedPortfolio so the
// presentational components don't have to know about the storage layout.
// Values here are what the user entered; market prices are looked up separately.
export interface PortfolioView {
  cash: number;
  investments: { symbol: string; name: string; shares: number; averagePrice: number }[];
}

export function toPortfolioView(p: SavedPortfolio | null): PortfolioView | undefined {
  if (!p) return undefined;
  return {
    cash: p.cash ?? 0,
    investments: p.investments.map((i) => ({
      symbol: i.symbol.toUpperCase(),
      name: i.name,
      shares: i.shares,
      averagePrice: i.averagePrice,
    })),
  };
}

const empty = (): UserData => ({
  portfolio: null,
  onboarding: null,
  recommendations: [],
  termsAcceptance: null,
});

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

// ── Terms and Conditions ───────────────────────────────────────────────────

export function hasAcceptedCurrentTerms(): boolean {
  return cache.termsAcceptance?.version === TERMS_VERSION;
}

// Not write-through: the server must record acceptance before the app unlocks.
export async function acceptTerms(): Promise<void> {
  const res = await apiRequest("PUT", "/api/me/terms", { version: TERMS_VERSION });
  cache = { ...cache, termsAcceptance: (await res.json()) as TermsAcceptance };
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
  // The server keeps the Terms acceptance through a reset, so the cache does too.
  cache = { ...empty(), termsAcceptance: cache.termsAcceptance };
  return writeThrough("DELETE", "/api/me/data");
}
