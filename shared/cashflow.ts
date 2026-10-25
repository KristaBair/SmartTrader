// Spending insights and the emergency-fund planner. Computed on the server from
// up to 90 days of bank transactions held in memory; only the user's own
// classification choices and manually entered expenses are stored.

import { z } from "zod";

// What a transaction is, for planning purposes.
export const EXPENSE_CLASSES = [
  "essential", "discretionary", "debt-payment", "fee", "savings-contribution", "transfer", "income", "uncategorized",
] as const;
export type ExpenseClass = (typeof EXPENSE_CLASSES)[number];

// Classes a user may assign; income and transfers come from the bank's categories.
export const USER_ASSIGNABLE_CLASSES = ["essential", "discretionary", "debt-payment", "fee", "savings-contribution", "transfer"] as const;

export const spendingPrefsSchema = z.object({
  // Keyed by Plaid detailed category (e.g. FOOD_AND_DRINK_RESTAURANT).
  categoryOverrides: z.record(z.string().max(80), z.enum(USER_ASSIGNABLE_CLASSES)).default({}),
  // Keyed by normalized merchant name; wins over category overrides.
  merchantOverrides: z.record(z.string().max(80), z.enum(USER_ASSIGNABLE_CLASSES)).default({}),
  // Regular costs that don't show up in linked transactions.
  manualExpenses: z.array(z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
    monthlyAmount: z.number().finite().min(0).max(1_000_000),
    class: z.enum(["essential", "discretionary", "debt-payment"]),
  })).max(50).default([]),
  // Optional confirmed take-home pay, used instead of detected income when set.
  confirmedMonthlyIncome: z.number().finite().min(0).max(10_000_000).nullable().default(null),
});
export type SpendingPrefs = z.infer<typeof spendingPrefsSchema>;

export interface CategorySpend {
  category: string;
  label: string;
  class: ExpenseClass;
  // True when the user changed the class from the default.
  overridden: boolean;
  total: number;
  monthlyAverage: number;
  transactionCount: number;
  // Last 30 days vs. the average of the earlier period, when there's enough history.
  recentMonthly: number | null;
  changePercent: number | null;
}

export interface RecurringCharge {
  merchant: string;
  cadence: "weekly" | "monthly";
  averageAmount: number;
  monthlyEquivalent: number;
  occurrences: number;
  lastDate: string;
  nextExpected: string;
  class: ExpenseClass;
  likelySubscription: boolean;
}

export interface SavingsScenario {
  id: string;
  title: string;
  description: string;
  monthlySavings: number;
  annualSavings: number;
  // For category cuts: the category's monthly average the percentage applies to.
  baseMonthly: number | null;
  // The exact arithmetic, shown to the user.
  calculation: string;
}

export interface SpendingInsights {
  periodStart: string;
  periodEnd: string;
  daysCovered: number;
  monthsCovered: number;
  transactionsAnalyzed: number;
  pendingExcluded: number;
  income: { detectedMonthly: number; confirmedMonthly: number | null; usedMonthly: number };
  monthly: {
    essential: number;
    discretionary: number;
    uncategorized: number;
    debtPayments: number;
    fees: number;
    savingsContributions: number;
    manualEssential: number;
    manualDiscretionary: number;
    manualDebt: number;
    // essential + discretionary + uncategorized + debt + fees + manual entries.
    totalSpending: number;
    // income used − total spending. Savings contributions are not spending.
    surplus: number;
  };
  categories: CategorySpend[];
  recurring: RecurringCharge[];
  scenarios: SavingsScenario[];
  notices: string[];
}

export interface EmergencyTarget {
  months: 3 | 6 | 9;
  target: number;
  gap: number;
  // Monthly amount to close the gap in 6, 12, and 24 months.
  monthlyFor: { months: number; amount: number }[];
  // At the current surplus, if positive.
  monthsAtSurplus: number | null;
}

export interface EmergencyFundPlan {
  essentialMonthly: number;
  breakdown: { label: string; monthly: number }[];
  accessible: {
    cash: number;
    savings: number;
    total: number;
    // Money in emergency-type pools that comes from cash or savings sources.
    earmarkedInEmergencyPools: number;
    // Emergency-pool money from investments or retirement accounts (not counted).
    excludedFromEmergencyPools: number;
  };
  // Which amount the gaps are measured against, and why.
  basis: "earmarked" | "all-accessible";
  basisAmount: number;
  targets: EmergencyTarget[];
  excludedNote: string;
  notices: string[];
}

export interface CashflowResponse {
  generatedAt: string;
  spending: SpendingInsights | null;
  emergency: EmergencyFundPlan;
  prefs: SpendingPrefs;
}
