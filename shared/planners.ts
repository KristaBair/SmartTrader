// Rent affordability and retirement planners. Inputs are prefilled from the
// user's data and always editable; results are deterministic calculations.

import { z } from "zod";

const money = z.number().finite().min(0).max(10_000_000);

// ── Rent ────────────────────────────────────────────────────────────────────

export const rentInputSchema = z.object({
  monthlyTakeHome: money,
  // Before taxes; optional because many people only know take-home pay.
  grossMonthlyIncome: money.nullable().default(null),
  debtPayments: money.default(0),
  utilities: money.default(0),
  transportation: money.default(0),
  insurance: money.default(0),
  groceries: money.default(0),
  otherEssentials: money.default(0),
  discretionary: money.default(0),
  emergencyFundContribution: money.default(0),
  otherSavings: money.default(0),
  // Share of take-home kept free for irregular costs (repairs, medical, gifts).
  bufferPercent: z.number().finite().min(0).max(30).default(5),
});
export type RentInput = z.infer<typeof rentInputSchema>;

export interface RentMethod {
  id: "gross-30" | "fifty-thirty-twenty" | "dti-36" | "residual";
  name: string;
  maxRent: number | null;
  explanation: string;
  calculation: string;
  // Reference rules ignore your other costs; they're shown but not used alone.
  referenceOnly: boolean;
}

export interface RentScenario {
  level: "conservative" | "moderate" | "higher-cost";
  rent: number;
  percentOfTakeHome: number;
  percentOfGross: number | null;
  // Left each month after rent, every expense, and savings in this scenario.
  monthlyFlexibility: number;
  // Monthly savings in this scenario vs. your stated commitments.
  savingsKept: number;
  savingsReduction: number;
  tradeoffs: string[];
}

export interface RentResult {
  inputs: RentInput;
  nonRentNeeds: number;
  savingsCommitments: number;
  methods: RentMethod[];
  scenarios: RentScenario[];
  warnings: string[];
  disclaimer: string;
}

// ── Retirement ──────────────────────────────────────────────────────────────

export const retirementInputSchema = z.object({
  currentAge: z.number().int().min(16).max(90),
  retirementAge: z.number().int().min(30).max(90),
  lifeExpectancy: z.number().int().min(60).max(110).default(90),
  currentSavings: money,
  monthlyContribution: money.default(0),
  employerMonthlyContribution: money.default(0),
  // In today's dollars.
  retirementSpendingMonthly: money,
  otherIncomeMonthly: money.default(0),
  withdrawalRatePercent: z.number().finite().min(2).max(8).default(4),
  // Optional custom scenario; the three standard scenarios always run.
  customReturnPercent: z.number().finite().min(-5).max(15).nullable().default(null),
  customInflationPercent: z.number().finite().min(0).max(10).nullable().default(null),
}).refine((v) => v.retirementAge > v.currentAge, { message: "Retirement age must be after your current age", path: ["retirementAge"] })
  .refine((v) => v.lifeExpectancy > v.retirementAge, { message: "Planning age must be after retirement age", path: ["lifeExpectancy"] });
export type RetirementInput = z.infer<typeof retirementInputSchema>;

export interface RetirementScenario {
  id: "cautious" | "middle" | "optimistic" | "custom";
  name: string;
  annualReturnPercent: number;
  inflationPercent: number;
  // Balance when you retire.
  projectedNominal: number;
  projectedToday: number;
  // Savings needed at retirement to fund the spending gap at the withdrawal rate.
  neededToday: number;
  neededNominal: number;
  // Monthly income the projected savings could support (today's dollars).
  sustainableMonthlyToday: number;
  gapToday: number;
  // Extra monthly saving, starting now, that would close the gap.
  additionalMonthlyNeeded: number;
  // Age the money runs out if spending stays as planned; null if it lasts past the planning age.
  depletionAge: number | null;
}

export interface RetirementResult {
  inputs: RetirementInput;
  yearsToRetirement: number;
  spendingGapMonthlyToday: number;
  scenarios: RetirementScenario[];
  explanations: string[];
  disclaimer: string;
}

// ── Prefill ─────────────────────────────────────────────────────────────────

export interface PlannerDefaults {
  rent: RentInput & { currentRent: number | null; sources: Record<string, string> };
  retirement: {
    retirementAccountsTotal: number;
    retirementPoolsTotal: number;
    retirementPoolIds: string[];
    detectedMonthlySavingsTransfers: number;
    retirementGoals: { id: string; name: string }[];
  };
  notices: string[];
}
