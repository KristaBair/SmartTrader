// Multi-user localStorage store.
// Each user has a first name, last name, and 4-digit passcode.
// All data (portfolio, onboarding, recommendations) is namespaced by user ID.

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  passcode: string; // 4-digit string, stored directly (no server = no crypto needed)
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

export interface LocalOnboarding {
  completed: boolean;
  savingsAmount: number;
  contributionFrequency: string;
  contributionAmount: number;
  suggestions: any;
  completedAt: string;
}

// -------------------------------------------------------------------------
// Storage keys
// -------------------------------------------------------------------------

const KEYS = {
  USERS: "smarttrader_users",
  CURRENT_USER: "smarttrader_current_user",
  onboarding: (uid: string) => `smarttrader_onboarding_${uid}`,
  portfolio: (uid: string) => `smarttrader_portfolio_${uid}`,
  recommendations: (uid: string) => `smarttrader_recommendations_${uid}`,
};

// -------------------------------------------------------------------------
// User profile helpers
// -------------------------------------------------------------------------

export function getAllUsers(): UserProfile[] {
  try {
    const raw = localStorage.getItem(KEYS.USERS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAllUsers(users: UserProfile[]) {
  localStorage.setItem(KEYS.USERS, JSON.stringify(users));
}

export function createUser(firstName: string, lastName: string, passcode: string): UserProfile {
  const user: UserProfile = {
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

export function findUser(firstName: string, lastName: string, passcode: string): UserProfile | null {
  const users = getAllUsers();
  return users.find(
    u =>
      u.firstName.toLowerCase() === firstName.trim().toLowerCase() &&
      u.lastName.toLowerCase() === lastName.trim().toLowerCase() &&
      u.passcode === passcode
  ) ?? null;
}

export function updateUserLastLogin(userId: string) {
  const users = getAllUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx !== -1) {
    users[idx].lastLogin = new Date().toISOString();
    saveAllUsers(users);
  }
}

// -------------------------------------------------------------------------
// Current session
// -------------------------------------------------------------------------

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

// -------------------------------------------------------------------------
// Per-user onboarding
// -------------------------------------------------------------------------

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

// -------------------------------------------------------------------------
// Per-user portfolio
// -------------------------------------------------------------------------

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

// -------------------------------------------------------------------------
// Per-user recommendations
// -------------------------------------------------------------------------

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

// -------------------------------------------------------------------------
// Clear everything for a user (account deletion / sign-out wipe)
// -------------------------------------------------------------------------

export function clearAll(userId?: string) {
  const uid = userId ?? getCurrentUserId();
  if (!uid) return;
  localStorage.removeItem(KEYS.onboarding(uid));
  localStorage.removeItem(KEYS.portfolio(uid));
  localStorage.removeItem(KEYS.recommendations(uid));
}
