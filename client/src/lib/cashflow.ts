// Client helpers for spending preferences shared by My Finances and the planners.

import { apiRequest, queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/format";
import type { ExpenseClass, SpendingPrefs } from "@shared/cashflow";

export const EXPENSE_CLASS_LABELS: Record<ExpenseClass, string> = {
  essential: "Essential",
  discretionary: "Discretionary",
  "debt-payment": "Debt payment",
  fee: "Fee",
  "savings-contribution": "Savings",
  transfer: "Not spending (transfer)",
  income: "Income",
  uncategorized: "Unclassified",
};

export const EXPENSE_CLASS_COLORS: Record<ExpenseClass, string> = {
  essential: "bg-sky-100 text-sky-800",
  discretionary: "bg-violet-100 text-violet-800",
  "debt-payment": "bg-rose-100 text-rose-800",
  fee: "bg-amber-100 text-amber-800",
  "savings-contribution": "bg-emerald-100 text-emerald-800",
  transfer: "bg-slate-200 text-slate-700",
  income: "bg-emerald-100 text-emerald-800",
  uncategorized: "bg-slate-200 text-slate-700",
};

export const PREFS_QUERY_KEY = ["/api/planning/spending-prefs"] as const;

// Saves preferences and refreshes everything computed from them.
export async function saveSpendingPrefs(prefs: SpendingPrefs): Promise<boolean> {
  try {
    await apiRequest("PUT", "/api/planning/spending-prefs", prefs);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: PREFS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["/api/finances/overview"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/planning/cashflow"] }),
    ]);
    return true;
  } catch (error) {
    toast({ title: "Couldn't save", description: errorMessage(error), variant: "destructive" });
    return false;
  }
}
