// Lets the user say whether each manual entry is the same money as a linked
// account. Until they choose, overlapping entries are left out of totals.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GitMerge } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, usd } from "@/lib/format";
import type { FinancialOverview, ManualStatus, ReconciliationChoice } from "@shared/finance";

const STATUS: Record<ManualStatus, { label: string; className: string }> = {
  counted: { label: "Counted", className: "bg-emerald-100 text-emerald-800" },
  duplicate: { label: "Same as linked · not counted", className: "bg-slate-200 text-slate-700" },
  "needs-review": { label: "Needs review · not counted", className: "bg-amber-100 text-amber-800" },
  unpriced: { label: "No verified price", className: "bg-slate-200 text-slate-700" },
};

export default function FinanceReconciliation({ overview }: { overview: FinancialOverview }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const holdings = overview.manualHoldings;
  const cash = overview.manualCash;
  if (holdings.length === 0 && !cash) return null;

  const save = async (change: { cash?: ReconciliationChoice; symbol?: string; choice?: ReconciliationChoice }) => {
    const next = { ...overview.decisions, holdings: { ...overview.decisions.holdings } };
    if (change.cash) next.cash = change.cash;
    if (change.symbol && change.choice) next.holdings[change.symbol] = change.choice;
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/finances/reconciliation", next);
      await queryClient.invalidateQueries({ queryKey: ["/api/finances/overview"] });
    } catch (error) {
      toast({ title: "Couldn't save", description: errorMessage(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const choiceButtons = (overlaps: boolean, onChoose: (choice: ReconciliationChoice) => void) =>
    overlaps ? (
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant="outline" disabled={saving} onClick={() => onChoose("duplicate")}>Same as linked</Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={() => onChoose("separate")}>Separate account</Button>
      </div>
    ) : (
      <span className="text-xs text-slate-500">No linked match</span>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center text-base">
          <GitMerge className="h-4 w-4 mr-2 text-indigo-600" />
          Manual entries vs. linked accounts
        </CardTitle>
        <p className="text-sm text-slate-500">
          Anything you entered by hand that might also be in a linked account is left out until you confirm it,
          so nothing is counted twice.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {cash && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
            <div>
              <div className="font-medium text-slate-900">Cash you entered: {usd(cash.amount)}</div>
              <Badge className={`mt-1 ${STATUS[cash.status].className}`} variant="secondary">{STATUS[cash.status].label}</Badge>
            </div>
            {choiceButtons(cash.overlapsLinked, (choice) => save({ cash: choice }))}
          </div>
        )}
        {holdings.map((h) => (
          <div key={h.symbol} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
            <div>
              <div className="font-medium text-slate-900">
                {h.symbol} · {h.shares} shares {h.value !== null && <span className="text-slate-500 font-normal">({usd(h.value)})</span>}
              </div>
              <Badge className={`mt-1 ${STATUS[h.status].className}`} variant="secondary">{STATUS[h.status].label}</Badge>
            </div>
            {choiceButtons(h.overlapsLinked, (choice) => save({ symbol: h.symbol, choice }))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
