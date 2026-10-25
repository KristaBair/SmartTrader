// Retirement Planner: deterministic projections under several return and
// inflation scenarios, in today's and future dollars, with their limits explained.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Info, Sunset } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { errorMessage, usd } from "@/lib/format";
import type { PlannerDefaults, RetirementResult } from "@shared/planners";

const FIELDS = [
  { key: "currentAge", label: "Current age", integer: true },
  { key: "retirementAge", label: "Retirement age", integer: true },
  { key: "lifeExpectancy", label: "Plan until age", integer: true },
  { key: "currentSavings", label: "Retirement savings now ($)" },
  { key: "monthlyContribution", label: "Your monthly contribution ($)" },
  { key: "employerMonthlyContribution", label: "Employer monthly contribution ($)" },
  { key: "retirementSpendingMonthly", label: "Monthly spending in retirement, today's dollars ($)" },
  { key: "otherIncomeMonthly", label: "Other monthly income in retirement, e.g. Social Security estimate ($)" },
  { key: "withdrawalRatePercent", label: "Withdrawal rate (%)" },
  { key: "customReturnPercent", label: "Your own return assumption (%), optional" },
  { key: "customInflationPercent", label: "Your own inflation assumption (%), optional" },
] as const;
const OPTIONAL = new Set(["customReturnPercent", "customInflationPercent"]);

function addYears(years: number) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export default function RetirementPlanner() {
  const { data: defaults, isLoading } = useQuery<PlannerDefaults>({ queryKey: ["/api/planning/defaults"], staleTime: 60_000 });
  const [form, setForm] = useState<Record<string, string>>({ currentAge: "", retirementAge: "65", lifeExpectancy: "90", withdrawalRatePercent: "4", monthlyContribution: "0", employerMonthlyContribution: "0", otherIncomeMonthly: "0", retirementSpendingMonthly: "", customReturnPercent: "", customInflationPercent: "" });
  const [result, setResult] = useState<RetirementResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!defaults) return;
    const total = defaults.retirement.retirementAccountsTotal + defaults.retirement.retirementPoolsTotal;
    setForm((f) => ({ ...f, currentSavings: f.currentSavings ?? String(defaults.retirement.retirementAccountsTotal || total) }));
  }, [defaults]);

  const body = () => {
    const out: Record<string, number | null> = {};
    for (const f of FIELDS) {
      const raw = (form[f.key] ?? "").trim();
      if (raw === "" && OPTIONAL.has(f.key)) { out[f.key] = null; continue; }
      const n = Number(raw);
      if (raw === "" || !Number.isFinite(n)) throw new Error(`Enter a number for "${f.label}".`);
      out[f.key] = "integer" in f && f.integer ? Math.round(n) : n;
    }
    return out;
  };

  const calculate = async () => {
    setBusy(true);
    setError("");
    try {
      setResult(await (await apiRequest("POST", "/api/planning/retirement", body())).json());
    } catch (e) {
      setError(e instanceof Error && !e.message.match(/^\d{3}:/) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Saves the middle scenario as a goal in today's dollars, using its after-inflation return.
  const saveAsGoal = async () => {
    if (!result || !defaults) return;
    const mid = result.scenarios.find((s) => s.id === "middle")!;
    const realReturn = Math.round(((1 + mid.annualReturnPercent / 100) / (1 + mid.inflationPercent / 100) - 1) * 10000) / 100;
    try {
      await apiRequest("POST", "/api/goals", {
        name: `Retire at ${result.inputs.retirementAge}`,
        type: "retirement",
        targetAmount: mid.neededToday,
        deadline: addYears(result.yearsToRetirement),
        poolIds: defaults.retirement.retirementPoolIds,
        monthlyContribution: result.inputs.monthlyContribution + result.inputs.employerMonthlyContribution,
        annualReturnPercent: realReturn,
        notes: `From the Retirement Planner (middle scenario). Target is in today's dollars and the ${realReturn}% return is after inflation (${mid.annualReturnPercent}% return, ${mid.inflationPercent}% inflation). Progress counts only linked retirement pools.`,
        status: "active",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      toast({ title: "Retirement goal created", description: "Find it under My goals." });
    } catch (e) {
      toast({ title: "Couldn't create goal", description: errorMessage(e), variant: "destructive" });
    }
  };

  if (isLoading || !defaults) return <Skeleton className="h-96" />;
  const d = defaults.retirement;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Sunset className="h-4 w-4 text-indigo-600" /> Your assumptions</CardTitle>
          <p className="text-xs text-slate-500">
            Linked retirement accounts: {usd(d.retirementAccountsTotal)}. Retirement pools: {usd(d.retirementPoolsTotal)} (earmarks on money you already have, so don't add them twice).
            {d.detectedMonthlySavingsTransfers > 0 && ` Transfers to savings or investments detected: ${usd(d.detectedMonthlySavingsTransfers)}/month.`}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`ret-${f.key}`} className="text-xs">{f.label}</Label>
              <Input id={`ret-${f.key}`} inputMode="decimal" className="h-8" value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            </div>
          ))}
          {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
          <Button onClick={calculate} disabled={busy} className="w-full">Project</Button>
        </CardContent>
      </Card>

      <div className="lg:col-span-3 space-y-4">
        {!result ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Enter your age and retirement spending, then project.</div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <div className="text-slate-600">To spend <b>{usd(result.inputs.retirementSpendingMonthly)}</b>/month with {usd(result.inputs.otherIncomeMonthly)} of other income, savings need to cover <b>{usd(result.spendingGapMonthlyToday)}</b>/month.</div>
              <div className="mt-1 text-slate-900">Savings needed at retirement: <b className="font-mono">{usd(result.scenarios[0].neededToday, { cents: false })}</b> in today's dollars ({result.inputs.withdrawalRatePercent}% withdrawal rate).</div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="font-medium p-3">In {result.yearsToRetirement} years</th>
                    {result.scenarios.map((s) => <th key={s.id} className="font-medium p-3 text-right">{s.name}<div className="font-normal">{s.annualReturnPercent}% return · {s.inflationPercent}% inflation</div></th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr><td className="p-3 text-slate-600">Projected savings (today's $)</td>{result.scenarios.map((s) => <td key={s.id} className="p-3 text-right font-mono">{usd(s.projectedToday, { cents: false })}</td>)}</tr>
                  <tr><td className="p-3 text-slate-600">Projected savings (future $)</td>{result.scenarios.map((s) => <td key={s.id} className="p-3 text-right font-mono text-slate-500">{usd(s.projectedNominal, { cents: false })}</td>)}</tr>
                  <tr><td className="p-3 text-slate-600">Needed (future $)</td>{result.scenarios.map((s) => <td key={s.id} className="p-3 text-right font-mono text-slate-500">{usd(s.neededNominal, { cents: false })}</td>)}</tr>
                  <tr><td className="p-3 text-slate-600">Monthly income it could support (today's $)</td>{result.scenarios.map((s) => <td key={s.id} className="p-3 text-right font-mono">{usd(s.sustainableMonthlyToday, { cents: false })}</td>)}</tr>
                  <tr><td className="p-3 text-slate-600">Shortfall (today's $)</td>{result.scenarios.map((s) => <td key={s.id} className={`p-3 text-right font-mono ${s.gapToday > 0 ? "text-rose-700" : "text-emerald-700"}`}>{s.gapToday > 0 ? usd(s.gapToday, { cents: false }) : "On track"}</td>)}</tr>
                  <tr><td className="p-3 text-slate-600">Extra monthly saving to close it</td>{result.scenarios.map((s) => <td key={s.id} className="p-3 text-right font-mono">{s.additionalMonthlyNeeded > 0 ? usd(s.additionalMonthlyNeeded) : "—"}</td>)}</tr>
                  <tr><td className="p-3 text-slate-600">Money could run out at age</td>{result.scenarios.map((s) => <td key={s.id} className="p-3 text-right">{s.depletionAge ?? `Lasts past ${result.inputs.lifeExpectancy}`}</td>)}</tr>
                </tbody>
              </table>
            </div>
            <Card>
              <CardHeader><CardTitle className="text-base">What this does and doesn't account for</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2">{result.explanations.map((e) => <li key={e} className="flex gap-2 text-xs text-slate-600"><Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />{e}</li>)}</ul>
                <p className="mt-3 text-[11px] text-slate-500">{result.disclaimer}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={saveAsGoal}>Save middle scenario as a retirement goal</Button>
                {d.retirementPoolIds.length === 0 && <p className="mt-1 text-[11px] text-slate-500">Tip: create a Retirement pool first so the goal can track money set aside for it.</p>}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
