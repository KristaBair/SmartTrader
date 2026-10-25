// Rent Affordability Planner: prefilled from linked data, every input editable,
// several budgeting methods compared, scenarios with their tradeoffs.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Home, Info } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { errorMessage, percent, usd } from "@/lib/format";
import type { PlannerDefaults, RentInput, RentResult } from "@shared/planners";

type Field = Exclude<keyof RentInput, "bufferPercent">;
const FIELDS: { key: Field; label: string; group: "income" | "needs" | "other" | "savings" }[] = [
  { key: "monthlyTakeHome", label: "Monthly take-home pay", group: "income" },
  { key: "grossMonthlyIncome", label: "Monthly gross (pre-tax) income, optional", group: "income" },
  { key: "debtPayments", label: "Debt payments", group: "needs" },
  { key: "utilities", label: "Utilities, internet, phone", group: "needs" },
  { key: "transportation", label: "Transportation", group: "needs" },
  { key: "insurance", label: "Insurance", group: "needs" },
  { key: "groceries", label: "Groceries", group: "needs" },
  { key: "otherEssentials", label: "Other essentials", group: "needs" },
  { key: "discretionary", label: "Discretionary spending", group: "other" },
  { key: "emergencyFundContribution", label: "Emergency fund saving", group: "savings" },
  { key: "otherSavings", label: "Other savings goals", group: "savings" },
];
const LEVEL_LABEL = { conservative: "Conservative", moderate: "Moderate", "higher-cost": "Higher-cost" } as const;

export default function RentPlanner() {
  const { data: defaults, isLoading } = useQuery<PlannerDefaults>({ queryKey: ["/api/planning/defaults"], staleTime: 60_000 });
  const [form, setForm] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RentResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!defaults) return;
    const r = defaults.rent;
    setForm(Object.fromEntries([
      ...FIELDS.map((f) => [f.key, r[f.key] === null ? "" : String(r[f.key])]),
      ["bufferPercent", String(r.bufferPercent)],
    ]));
  }, [defaults]);

  const calculate = async () => {
    const body: Record<string, number | null> = {};
    for (const f of [...FIELDS.map((x) => x.key), "bufferPercent"]) {
      const raw = (form[f] ?? "").trim();
      if (raw === "") { body[f] = f === "grossMonthlyIncome" ? null : 0; continue; }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return setError("Use numbers of 0 or more.");
      body[f] = n;
    }
    setBusy(true);
    setError("");
    try {
      setResult(await (await apiRequest("POST", "/api/planning/rent", body)).json());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !defaults) return <Skeleton className="h-96" />;
  const group = (g: (typeof FIELDS)[number]["group"], title: string) => (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-slate-800">{title}</legend>
      {FIELDS.filter((f) => f.group === g).map((f) => (
        <div key={f.key}>
          <Label htmlFor={`rent-${f.key}`} className="text-xs">{f.label} ($/month)</Label>
          <Input id={`rent-${f.key}`} inputMode="decimal" value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} className="h-8" />
          {defaults.rent.sources[f.key] && <p className="text-[11px] text-slate-400">Prefilled: {defaults.rent.sources[f.key]}</p>}
        </div>
      ))}
    </fieldset>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Home className="h-4 w-4 text-indigo-600" /> Your numbers</CardTitle>
          <p className="text-xs text-slate-500">Prefilled from your linked accounts and pools. Check and correct anything before calculating; leave out your current rent.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {defaults.notices.map((n) => <p key={n} className="flex gap-2 text-xs text-slate-600"><Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />{n}</p>)}
          {group("income", "Income")}
          {group("needs", "Other needs")}
          {group("other", "Wants")}
          {group("savings", "Savings you want to keep")}
          <div>
            <Label htmlFor="rent-buffer" className="text-xs">Buffer for irregular costs (% of take-home)</Label>
            <Input id="rent-buffer" inputMode="decimal" value={form.bufferPercent ?? ""} onChange={(e) => setForm({ ...form, bufferPercent: e.target.value })} className="h-8" />
          </div>
          {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
          <Button onClick={calculate} disabled={busy} className="w-full">Calculate</Button>
        </CardContent>
      </Card>

      <div className="lg:col-span-3 space-y-4">
        {!result ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Check your numbers, then calculate to compare rent levels.</div>
        ) : (
          <>
            {result.warnings.map((w) => <div key={w} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 mt-0.5" />{w}</div>)}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {result.scenarios.map((s) => (
                <div key={s.level} className="rounded-xl border border-slate-200 bg-white p-4" data-testid={`rent-${s.level}`}>
                  <div className="text-sm font-medium text-slate-700">{LEVEL_LABEL[s.level]}</div>
                  <div className="text-2xl font-semibold font-mono text-slate-900">{usd(s.rent, { cents: false })}<span className="text-xs font-normal text-slate-500">/mo</span></div>
                  <div className="text-xs text-slate-500">{percent(s.percentOfTakeHome, 0)} of take-home{s.percentOfGross !== null ? ` · ${percent(s.percentOfGross, 0)} of gross` : ""}</div>
                  <dl className="mt-3 space-y-1 text-xs">
                    <div className="flex justify-between"><dt className="text-slate-600">Left each month</dt><dd className="font-mono">{usd(s.monthlyFlexibility)}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-600">Savings kept</dt><dd className="font-mono">{usd(s.savingsKept)}</dd></div>
                    {s.savingsReduction > 0 && <div className="flex justify-between text-amber-700"><dt>Savings given up</dt><dd className="font-mono">−{usd(s.savingsReduction)}</dd></div>}
                  </dl>
                  <ul className="mt-3 space-y-1 text-[11px] text-slate-600 list-disc pl-4">{s.tradeoffs.map((t) => <li key={t}>{t}</li>)}</ul>
                </div>
              ))}
            </div>
            <Card>
              <CardHeader><CardTitle className="text-base">How each method works</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {result.methods.map((m) => (
                  <div key={m.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-slate-900">{m.name} {m.referenceOnly && <Badge variant="secondary" className="ml-1 text-[11px] font-normal">Reference only</Badge>}</span>
                      <span className="font-mono">{m.maxRent === null ? "—" : usd(m.maxRent)}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{m.explanation}</p>
                    <p className="text-[11px] text-slate-500 font-mono mt-1">{m.calculation}</p>
                  </div>
                ))}
                <p className="text-[11px] text-slate-500">{result.disclaimer}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
