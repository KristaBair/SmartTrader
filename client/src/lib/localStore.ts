// Everything in this app lives in localStorage. No backend accounts are needed.
// Each user gets their own little namespace so profiles never bleed into each other.

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  passcode: string; // plain 4-digit string. No server means no need for hashing.
  createdAt: string;
  lastLogin: string;
}

export interface LocalPortfolio {
  cash: number;
  investments: { symbol: string; name: string; shares: number; averagePrice: number }[];
  riskTolerance: string;
  timeline: string;
  lastUpdated: string;
}

// Shape the dashboard summary widgets need. Derived from a LocalPortfolio so the
// presentational components don't have to know about the localStorage layout.
export interface PortfolioView {
  cash: string;
  investments: { symbol: string; name: string; currentValue: number }[];
  initialInvestment?: string | null;
  monthlyContribution?: string | null;
  totalContributions?: string | null;
}

export function toPortfolioView(p: LocalPortfolio | null): PortfolioView | undefined {
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

export interface LocalOnboarding {
  completed: boolean;
  savingsAmount: number;
  contributionFrequency: string;
  contributionAmount: number;
  suggestions: any;
  completedAt: string;
}

// All keys in one place so typos don't silently break things
const KEYS = {
  USERS: "smarttrader_users",            // list of all profiles on this device
  CURRENT_USER: "smarttrader_current_user", // who's logged in right now
  onboarding: (uid: string) => `smarttrader_onboarding_${uid}`,
  portfolio: (uid: string) => `smarttrader_portfolio_${uid}`,
  recommendations: (uid: string) => `smarttrader_recommendations_${uid}`,
};

// ── User profile helpers ───────────────────────────────────────────────────

export function getAllUsers(): UserProfile[] {
  try {
    const raw = localStorage.getItem(KEYS.USERS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    // localStorage can throw in private browsing modes
    return [];
  }
}

function saveAllUsers(users: UserProfile[]) {
  localStorage.setItem(KEYS.USERS, JSON.stringify(users));
}

export function createUser(firstName: string, lastName: string, passcode: string): UserProfile {
  const user: UserProfile = {
    // timestamp + random suffix keeps IDs unique even if two profiles are created very fast
    id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    passcode,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
  };
  const users = getAllUsers();
  users.push(user);
  saveAllUsers(users);
  return user;
}

// Looks up a user by name and passcode. Used at sign-in.
export function findUser(firstName: string, lastName: string, passcode: string): UserProfile | null {
  const users = getAllUsers();
  return users.find(
    u =>
      u.firstName.toLowerCase() === firstName.trim().toLowerCase() &&
      u.lastName.toLowerCase() === lastName.trim().toLowerCase() &&
      u.passcode === passcode
  ) ?? null;
}

// Stamp the login time so the sign-in screen can show "last login: today"
export function updateUserLastLogin(userId: string) {
  const users = getAllUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx !== -1) {
    users[idx].lastLogin = new Date().toISOString();
    saveAllUsers(users);
  }
}

// ── Current session ────────────────────────────────────────────────────────
// We just store the user ID so we can restore the session on page reload.

export function getCurrentUserId(): string | null {
  return localStorage.getItem(KEYS.CURRENT_USER);
}

export function setCurrentUserId(userId: string) {
  localStorage.setItem(KEYS.CURRENT_USER, userId);
}

export function clearCurrentSession() {
  localStorage.removeItem(KEYS.CURRENT_USER);
}

export function getCurrentUser(): UserProfile | null {
  const id = getCurrentUserId();
  if (!id) return null;
  return getAllUsers().find(u => u.id === id) ?? null;
}

// ── Per-user onboarding ────────────────────────────────────────────────────
// Onboarding answers are saved so we don't re-ask them every visit.

export function getOnboarding(userId?: string): LocalOnboarding | null {
  const uid = userId ?? getCurrentUserId();
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(KEYS.onboarding(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveOnboarding(data: LocalOnboarding, userId?: string) {
  const uid = userId ?? getCurrentUserId();
  if (!uid) return;
  localStorage.setItem(KEYS.onboarding(uid), JSON.stringify(data));
}

export function clearOnboarding(userId?: string) {
  const uid = userId ?? getCurrentUserId();
  if (!uid) return;
  localStorage.removeItem(KEYS.onboarding(uid));
}

// ── Per-user portfolio ─────────────────────────────────────────────────────
// Saved so the dashboard pre-fills with the user's last known holdings.

export function getPortfolio(userId?: string): LocalPortfolio | null {
  const uid = userId ?? getCurrentUserId();
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(KEYS.portfolio(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function savePortfolio(data: LocalPortfolio, userId?: string) {
  const uid = userId ?? getCurrentUserId();
  if (!uid) return;
  // Stamp lastUpdated automatically so we never forget
  localStorage.setItem(
    KEYS.portfolio(uid),
    JSON.stringify({ ...data, lastUpdated: new Date().toISOString() })
  );
}

export function clearPortfolio(userId?: string) {
  const uid = userId ?? getCurrentUserId();
  if (!uid) return;
  localStorage.removeItem(KEYS.portfolio(uid));
}

// ── Per-user recommendations ───────────────────────────────────────────────
// Cached so the dashboard shows last AI results instantly while a new analysis runs.

export function getRecommendations(userId?: string): any[] {
  const uid = userId ?? getCurrentUserId();
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(KEYS.recommendations(uid));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRecommendations(data: any[], userId?: string) {
  const uid = userId ?? getCurrentUserId();
  if (!uid) return;
  localStorage.setItem(KEYS.recommendations(uid), JSON.stringify(data));
}

// ── Wipe everything for a user ─────────────────────────────────────────────
// Called on sign-out or if a user wants to reset their data.

export function clearAll(userId?: string) {
  const uid = userId ?? getCurrentUserId();
  if (!uid) return;
  localStorage.removeItem(KEYS.onboarding(uid));
  localStorage.removeItem(KEYS.portfolio(uid));
  localStorage.removeItem(KEYS.recommendations(uid));
}
