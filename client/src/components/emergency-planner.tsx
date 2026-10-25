// Emergency Fund Planner: 3/6/9-month targets from essential expenses,
// compared with money that's actually accessible in an emergency.

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Info, ShieldCheck } from "lucide-react";
import { errorMessage, usd } from "@/lib/format";
import type { CashflowResponse } from "@shared/cashflow";

export default function EmergencyPlanner() {
  const { data, isLoading, error } = useQuery<CashflowResponse>({ queryKey: ["/api/planning/cashflow"], staleTime: 60_000 });
  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !data) {
    return <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="h-4 w-4 mt-0.5" /> {errorMessage(error, "The planner could not be loaded.")}</div>;
  }
  const plan = data.emergency;
  const a = plan.accessible;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500 font-medium">Essential expenses per month</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold font-mono">{usd(plan.essentialMonthly)}</div>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              {plan.breakdown.map((b) => <li key={b.label} className="flex justify-between"><span>{b.label}</span><span className="font-mono">{usd(b.monthly)}</span></li>)}
            </ul>
            <p className="mt-2 text-[11px] text-slate-500">Discretionary spending, savings transfers, and credit card payments aren't included. Change categories on <Link href="/finances" className="underline">My Finances</Link>.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500 font-medium">Accessible in an emergency</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold font-mono">{usd(a.total)}</div>
            <ul className="mt-2 space-y-1 text-xs text-slate-600">
              <li className="flex justify-between"><span>Cash (checking, confirmed manual cash)</span><span className="font-mono">{usd(a.cash)}</span></li>
              <li className="flex justify-between"><span>Savings and money market</span><span className="font-mono">{usd(a.savings)}</span></li>
            </ul>
            <p className="mt-2 text-[11px] text-slate-500">{plan.excludedNote}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500 font-medium">Set aside in emergency pools</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold font-mono">{usd(a.earmarkedInEmergencyPools)}</div>
            <p className="mt-2 text-xs text-slate-600">Only money from cash and savings accounts counts.</p>
            {a.excludedFromEmergencyPools > 0 && <p className="mt-1 text-xs text-amber-700">{usd(a.excludedFromEmergencyPools)} from investments or retirement accounts isn't counted.</p>}
            <Link href="/pools" className="mt-2 inline-block text-xs text-indigo-700 underline">Manage savings pools</Link>
          </CardContent>
        </Card>
      </div>

      {plan.notices.length > 0 && (
        <ul className="space-y-2">
          {plan.notices.map((n) => <li key={n} className="flex items-start gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700"><Info className="h-4 w-4 mt-0.5 flex-shrink-0" />{n}</li>)}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-indigo-600" /> Emergency fund targets</CardTitle>
          <p className="text-sm text-slate-500">
            Measured against {plan.basis === "earmarked" ? "money set aside in your emergency pools" : "all your accessible cash and savings"}: <b>{usd(plan.basisAmount)}</b>.
            A common guideline is 3–6 months of essential expenses; 9 months gives more cushion if income is irregular.
          </p>
        </CardHeader>
        <CardContent>
          {plan.essentialMonthly === 0 ? (
            <p className="text-sm text-slate-500">Targets appear once essential expenses are known.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {plan.targets.map((t) => {
                const pct = t.target > 0 ? Math.min(100, (plan.basisAmount / t.target) * 100) : 0;
                return (
                  <div key={t.months} className="rounded-xl border border-slate-200 p-4" data-testid={`target-${t.months}`}>
                    <div className="text-sm font-medium text-slate-700">{t.months} months</div>
                    <div className="text-xl font-semibold font-mono text-slate-900">{usd(t.target)}</div>
                    <Progress value={pct} className="mt-2 h-2 bg-slate-200" aria-label={`${pct.toFixed(0)}% of ${t.months}-month target`} />
                    <div className="mt-1 text-xs text-slate-500">{t.gap === 0 ? "Fully covered" : `${usd(t.gap)} to go`}</div>
                    {t.gap > 0 && (
                      <table className="mt-3 w-full text-xs">
                        <tbody>
                          {t.monthlyFor.map((f) => (
                            <tr key={f.months}><td className="py-0.5 text-slate-600">Done in {f.months} months</td><td className="py-0.5 text-right font-mono">{usd(f.amount)}/mo</td></tr>
                          ))}
                          {t.monthsAtSurplus !== null && t.monthsAtSurplus > 0 && (
                            <tr><td className="py-0.5 text-slate-600">At your full surplus</td><td className="py-0.5 text-right">{t.monthsAtSurplus} months</td></tr>
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-4 text-[11px] text-slate-400">Each monthly amount is the gap divided by the number of months, with no interest assumed. Educational estimate, not personalized financial advice.</p>
        </CardContent>
      </Card>
    </div>
  );
}
