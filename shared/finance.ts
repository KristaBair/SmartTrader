// Types for the unified financial overview, shared by the client and server.
// Linked-account values are always fetched live from Plaid and never stored;
// only user-created records (manual debts, reconciliation choices) are saved.

import { z } from "zod";
import type { SpendingInsights } from "./cashflow";

// How an account's money can be used. Drives net worth, emergency-fund
// eligibility, and which assets a savings pool may draw on.
export type AssetClass =
  | "cash"                // checking, cash management: spendable now
  | "savings"             // savings, money market: accessible, not volatile
  | "term-deposit"        // CDs: may carry early-withdrawal penalties
  | "taxable-investment"  // brokerage, crypto: accessible but volatile
  | "retirement"          // 401(k), IRA, pension: penalties before retirement age
  | "restricted"          // HSA, 529, UTMA, stock plans: use is limited by rules
  | "credit"              // credit cards, lines of credit (liability)
  | "loan"                // mortgages, student, auto loans (liability)
  | "other";

export const LIABILITY_CLASSES: readonly AssetClass[] = ["credit", "loan"];

// Accessible without selling volatile assets or paying penalties.
export const EMERGENCY_ACCESSIBLE_CLASSES: readonly AssetClass[] = ["cash", "savings"];

export interface LinkedAccount {
  // Stable across re-linking where possible (see accountKey on the server).
  key: string;
  itemId: string;
  institutionName: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  assetClass: AssetClass;
  currentBalance: number | null;
  availableBalance: number | null;
  currency: string | null;
  retrievedAt: string;
}

export interface LinkedHolding {
  // accountKey + securityKey; unique per position.
  key: string;
  accountKey: string;
  securityKey: string;
  symbol: string | null;
  name: string;
  securityType: string | null;
  isCashEquivalent: boolean;
  quantity: number;
  price: number | null;
  priceAsOf: string | null;
  value: number | null;
  costBasis: number | null;
  currency: string | null;
}

export type InstitutionStatus = "connected" | "error" | "reauth-required";

export interface InstitutionSummary {
  itemId: string;
  institutionName: string;
  status: InstitutionStatus;
  retrievedAt: string | null;
  accountCount: number;
  message?: string;
}

// ── Manual entries and reconciliation ───────────────────────────────────────

export type ReconciliationChoice = "separate" | "duplicate";

export const reconciliationSchema = z.object({
  cash: z.enum(["separate", "duplicate"]).optional(),
  // Keyed by upper-case ticker of the manual holding.
  holdings: z.record(z.string().max(12), z.enum(["separate", "duplicate"])).default({}),
});
export type ReconciliationDecisions = z.infer<typeof reconciliationSchema>;

// Why a manual entry is or isn't counted.
export type ManualStatus =
  | "counted"              // no overlap, or the user confirmed it's a separate account
  | "duplicate"            // the user confirmed it's the same as linked data
  | "needs-review"         // overlaps linked data; left out until the user decides
  | "unpriced";            // no verified price, so it can't be valued

export interface ManualHoldingLine {
  symbol: string;
  name: string;
  shares: number;
  price: number | null;
  priceAsOf: string | null;
  value: number | null;
  status: ManualStatus;
  overlapsLinked: boolean;
}

export interface ManualCashLine {
  amount: number;
  status: ManualStatus;
  overlapsLinked: boolean;
}

export const manualLiabilitySchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["credit-card", "student-loan", "auto-loan", "mortgage", "personal-loan", "medical", "other"]),
  balance: z.number().finite().min(0).max(100_000_000),
  monthlyPayment: z.number().finite().min(0).max(10_000_000).nullable().default(null),
  interestRate: z.number().finite().min(0).max(100).nullable().default(null),
});
export type ManualLiabilityInput = z.infer<typeof manualLiabilitySchema>;

export interface ManualLiability extends ManualLiabilityInput {
  id: string;
  updatedAt: string;
}

// ── Overview ────────────────────────────────────────────────────────────────

export interface FinancialTotals {
  assets: number;
  liabilities: number;
  netWorth: number;
  cash: number;
  savings: number;
  termDeposits: number;
  taxableInvestments: number;
  retirement: number;
  restricted: number;
  other: number;
  // Of the assets above, how much came from user-entered estimates.
  manualEstimates: number;
}

export interface CashFlowSummary {
  periodStart: string;
  periodEnd: string;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlySurplus: number;
}

export type NoticeLevel = "info" | "warning";

export interface DataNotice {
  level: NoticeLevel;
  code: string;
  message: string;
}

export interface FinancialOverview {
  generatedAt: string;
  currency: "USD";
  totals: FinancialTotals;
  institutions: InstitutionSummary[];
  accounts: LinkedAccount[];
  holdings: LinkedHolding[];
  manualHoldings: ManualHoldingLine[];
  manualCash: ManualCashLine | null;
  manualLiabilities: ManualLiability[];
  // The user's saved choices, returned as-is so editing one never drops another.
  decisions: ReconciliationDecisions;
  cashFlow: CashFlowSummary | null;
  // Full spending breakdown behind cashFlow (categories, recurring charges, scenarios).
  spending: SpendingInsights | null;
  notices: DataNotice[];
}
