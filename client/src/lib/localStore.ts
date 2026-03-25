// All user data is stored in localStorage — no accounts, no profiles

export interface LocalPortfolio {
  cash: number;
  investments: { symbol: string; name: string; shares: number; averagePrice: number }[];
  riskTolerance: string;
  timeline: string;
  lastUpdated: string;
}

export interface LocalOnboarding {
  completed: boolean;
  savingsAmount: number;
  contributionFrequency: string;
  contributionAmount: number;
  suggestions: any;
  completedAt: string;
}

const KEYS = {
  ONBOARDING: "smarttrader_onboarding",
  PORTFOLIO: "smarttrader_portfolio",
};

export function getOnboarding(): LocalOnboarding | null {
  try {
    const raw = localStorage.getItem(KEYS.ONBOARDING);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveOnboarding(data: LocalOnboarding) {
  localStorage.setItem(KEYS.ONBOARDING, JSON.stringify(data));
}

export function clearOnboarding() {
  localStorage.removeItem(KEYS.ONBOARDING);
}

export function getPortfolio(): LocalPortfolio | null {
  try {
    const raw = localStorage.getItem(KEYS.PORTFOLIO);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function savePortfolio(data: LocalPortfolio) {
  localStorage.setItem(KEYS.PORTFOLIO, JSON.stringify({
    ...data,
    lastUpdated: new Date().toISOString(),
  }));
}

export function clearPortfolio() {
  localStorage.removeItem(KEYS.PORTFOLIO);
}

export function clearAll() {
  localStorage.removeItem(KEYS.ONBOARDING);
  localStorage.removeItem(KEYS.PORTFOLIO);
}
