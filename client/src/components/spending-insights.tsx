// Spending breakdown, recurring charges, and savings scenarios from linked bank
// transactions, with controls for classification, take-home pay, and added costs.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Info, Plus, Repeat, Trash2, TrendingDown, TrendingUp, Lightbulb } from "lucide-react";
import { EXPENSE_CLASS_COLORS, EXPENSE_CLASS_LABELS, PREFS_QUERY_KEY, saveSpendingPrefs } from "@/lib/cashflow";
import { percent, shortDate, usd } from "@/lib/format";
import { USER_ASSIGNABLE_CLASSES, type ExpenseClass, type SpendingInsights, type SpendingPrefs } from "@shared/cashflow";

type Assignable = (typeof USER_ASSIGNABLE_CLASSES)[number];

function ClassSelect({ value, onChange, label }: { value: ExpenseClass; onChange: (v: Assignable) => void; label: string }) {
  return (
    <Select value={USER_ASSIGNABLE_CLASSES.includes(value as Assignable) ? value : undefined} onValueChange={(v) => onChange(v as Assignable)}>
      <SelectTrigger className="h-7 w-[9.5rem] text-xs" aria-label={label}>
        <SelectValue placeholder={EXPENSE_CLASS_LABELS[value]} />
      </SelectTrigger>
      <SelectContent>
        {USER_ASSIGNABLE_CLASSES.map((c) => <SelectItem key={c} value={c} className="text-xs">{EXPENSE_CLASS_LABELS[c]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Row({ label, value, strong, note }: { label: string; value: number; strong?: boolean; note?: string }) {
  if (value === 0 && !strong) return null;
  return (
    <div className="flex justify-between text-sm py-1">
      <span className={strong ? "font-medium text-slate-900" : "text-slate-600"}>{label}{note && <span className="text-xs text-slate-400"> · {note}</span>}</span>
      <span className={`font-mono ${strong ? "font-semibold text-slate-900" : "text-slate-800"}`}>{usd(value)}</span>
    </div>
  );
}

export default function SpendingInsightsPanel({ insights }: { insights: SpendingInsights | null }) {
  const { data: prefs } = useQuery<SpendingPrefs>({ queryKey: PREFS_QUERY_KEY, staleTime: 60_000 });
  const [cut, setCut] = useState<Record<string, number>>({});
  const [incomeDraft, setIncomeDraft] = useState("");
  const [expenseDraft, setExpenseDraft] = useState({ name: "", amount: "", class: "essential" as "essential" | "discretionary" | "debt-payment" });
  const [busy, setBusy] = useState(false);

  const update = async (change: (p: SpendingPrefs) => SpendingPrefs) => {
    if (!prefs) return;
    setBusy(true);
    await saveSpendingPrefs(change(prefs));
    setBusy(false);
  };

  if (!insights) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Spending and cash flow</CardTitle></CardHeader>
        <CardContent className="text-sm text-slate-500">Link a bank account for spending (under Connected accounts) to see categories, recurring charges, and savings ideas.</CardContent>
      </Card>
    );
  }
  const m = insights.monthly;
  const spendRows = insights.categories.filter((c) => c.class !== "savings-contribution");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Spending and cash flow</CardTitle>
        <p className="text-sm text-slate-500">
          Monthly averages over {insights.daysCovered} days ({shortDate(insights.periodStart)} – {shortDate(insights.periodEnd)}), {insights.transactionsAnalyzed} completed transactions.
          Calculated from your bank data each time; raw transactions aren't stored.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {insights.notices.length > 0 && (
          <ul className="space-y-1">
            {insights.notices.map((n) => <li key={n} className="flex gap-2 text-xs text-slate-600"><Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-slate-400" />{n}</li>)}
          </ul>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 mb-1">Monthly picture</h3>
            <Row label="Income" value={insights.income.usedMonthly} strong note={insights.income.confirmedMonthly !== null ? "you confirmed" : "detected deposits"} />
            <Row label="Essentials" value={m.essential + m.manualEssential} />
            <Row label="Discretionary" value={m.discretionary + m.manualDiscretionary} />
            <Row label="Unclassified" value={m.uncategorized} />
            <Row label="Debt payments" value={m.debtPayments + m.manualDebt} />
            <Row label="Fees" value={m.fees} />
            <Row label="Total spending" value={m.totalSpending} strong />
            <div className={`flex justify-between text-sm py-1 border-t border-slate-200 mt-1 ${m.surplus >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              <span className="font-medium">{m.surplus >= 0 ? "Monthly surplus" : "Monthly shortfall"}</span>
              <span className="font-mono font-semibold">{usd(m.surplus)}</span>
            </div>
            {m.savingsContributions > 0 && <p className="text-xs text-slate-500 mt-1">You're also moving {usd(m.savingsContributions)}/month into savings or investments (not counted as spending).</p>}
          </div>
          <div className="space-y-3">
            <div>
              <Label htmlFor="takehome" className="text-sm">Your monthly take-home pay</Label>
              <p className="text-xs text-slate-500">Detected deposits: {usd(insights.income.detectedMonthly)}/month. Confirm your actual take-home pay if it differs.</p>
              <div className="mt-1 flex gap-2">
                <Input id="takehome" inputMode="decimal" placeholder={insights.income.confirmedMonthly !== null ? String(insights.income.confirmedMonthly) : "e.g. 4200"} value={incomeDraft} onChange={(e) => setIncomeDraft(e.target.value)} />
                <Button size="sm" disabled={busy || !prefs || !(Number(incomeDraft) >= 0) || incomeDraft.trim() === ""} onClick={() => update((p) => ({ ...p, confirmedMonthlyIncome: Number(incomeDraft) })).then(() => setIncomeDraft(""))}>Save</Button>
                {insights.income.confirmedMonthly !== null && <Button size="sm" variant="ghost" disabled={busy} onClick={() => update((p) => ({ ...p, confirmedMonthlyIncome: null }))}>Use detected</Button>}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">Regular costs not in your bank data</div>
              <ul className="mt-1 divide-y divide-slate-100">
                {(prefs?.manualExpenses ?? []).map((e) => (
                  <li key={e.id} className="flex items-center justify-between py-1 text-sm">
                    <span>{e.name} <Badge variant="secondary" className={`ml-1 text-[11px] font-normal ${EXPENSE_CLASS_COLORS[e.class]}`}>{EXPENSE_CLASS_LABELS[e.class]}</Badge></span>
                    <span className="flex items-center gap-1 font-mono">{usd(e.monthlyAmount)}/mo
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy} aria-label={`Remove ${e.name}`} onClick={() => update((p) => ({ ...p, manualExpenses: p.manualExpenses.filter((x) => x.id !== e.id) }))}><Trash2 className="h-3.5 w-3.5 text-slate-500" /></Button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                <Input className="h-8 flex-1 min-w-[8rem]" placeholder="e.g. Car insurance" value={expenseDraft.name} maxLength={60} onChange={(e) => setExpenseDraft({ ...expenseDraft, name: e.target.value })} aria-label="Expense name" />
                <Input className="h-8 w-24" inputMode="decimal" placeholder="$/mo" value={expenseDraft.amount} onChange={(e) => setExpenseDraft({ ...expenseDraft, amount: e.target.value })} aria-label="Monthly amount" />
                <Select value={expenseDraft.class} onValueChange={(v) => setExpenseDraft({ ...expenseDraft, class: v as typeof expenseDraft.class })}>
                  <SelectTrigger className="h-8 w-[8.5rem] text-xs" aria-label="Expense type"><SelectValue /></SelectTrigger>
                  <SelectContent>{(["essential", "discretionary", "debt-payment"] as const).map((c) => <SelectItem key={c} value={c} className="text-xs">{EXPENSE_CLASS_LABELS[c]}</SelectItem>)}</SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={busy || !expenseDraft.name.trim() || !(Number(expenseDraft.amount) > 0)}
                  onClick={() => update((p) => ({ ...p, manualExpenses: [...p.manualExpenses, { id: crypto.randomUUID(), name: expenseDraft.name.trim(), monthlyAmount: Number(expenseDraft.amount), class: expenseDraft.class }] }))
                    .then(() => setExpenseDraft({ name: "", amount: "", class: "essential" }))}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Categories</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="font-medium py-1 pr-3">Category</th>
                  <th className="font-medium py-1 pr-3">Type</th>
                  <th className="font-medium py-1 pr-3 text-right">Per month</th>
                  <th className="font-medium py-1 text-right">Last 30 days vs. before</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {spendRows.map((c) => (
                  <tr key={c.category + c.class}>
                    <td className="py-1.5 pr-3 text-slate-800">{c.label}<span className="text-xs text-slate-400"> · {c.transactionCount}</span></td>
                    <td className="py-1.5 pr-3">
                      <div className="flex items-center gap-1">
                        <ClassSelect value={c.class} label={`Type for ${c.label}`} onChange={(v) => update((p) => ({ ...p, categoryOverrides: { ...p.categoryOverrides, [c.category]: v } }))} />
                        {c.overridden && <span className="text-[11px] text-slate-400">yours</span>}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono">{usd(c.monthlyAverage)}</td>
                    <td className="py-1.5 text-right text-xs">
                      {c.changePercent === null ? <span className="text-slate-400">—</span> : (
                        <span className={`inline-flex items-center gap-1 ${c.changePercent > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                          {c.changePercent > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {c.changePercent > 0 ? "+" : ""}{percent(c.changePercent, 0)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {prefs && Object.keys(prefs.categoryOverrides).length > 0 && (
            <Button size="sm" variant="ghost" className="mt-2" disabled={busy} onClick={() => update((p) => ({ ...p, categoryOverrides: {} }))}>Reset category types to defaults</Button>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-1"><Repeat className="h-4 w-4" /> Recurring charges</h3>
          {insights.recurring.length === 0 ? (
            <p className="text-sm text-slate-500">No regular weekly or monthly charges found yet. This needs at least two similar charges from the same merchant.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {insights.recurring.map((r) => (
                <li key={r.merchant + r.cadence} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div>
                    <span className="text-slate-900">{r.merchant}</span>
                    {r.likelySubscription && <Badge variant="secondary" className="ml-2 text-[11px] font-normal bg-violet-100 text-violet-800">Likely subscription</Badge>}
                    <div className="text-xs text-slate-500">{r.cadence === "monthly" ? "Monthly" : "Weekly"} · {r.occurrences} charges · last {shortDate(r.lastDate)} · next around {shortDate(r.nextExpected)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ClassSelect value={r.class} label={`Type for ${r.merchant}`} onChange={(v) => update((p) => ({ ...p, merchantOverrides: { ...p.merchantOverrides, [r.merchant]: v } }))} />
                    <span className="font-mono">{usd(r.monthlyEquivalent)}/mo</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-1"><Lightbulb className="h-4 w-4" /> Ways you could save</h3>
          {insights.scenarios.length === 0 ? (
            <p className="text-sm text-slate-500">No savings ideas yet. They appear once there's discretionary spending, subscriptions, or fees to work with.</p>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {insights.scenarios.map((s) => {
                // Category cuts can be adjusted; the same formula the server used.
                const isCut = s.id.startsWith("cut-");
                const pct = cut[s.id] ?? 20;
                const base = s.baseMonthly ?? 0;
                const monthly = isCut ? Math.round(base * pct) / 100 : s.monthlySavings;
                const annual = Math.round(monthly * 12 * 100) / 100;
                return (
                  <li key={s.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="font-medium text-slate-900">{isCut ? s.title.replace("20%", `${pct}%`) : s.title}</div>
                    <p className="text-xs text-slate-600 mt-1">{s.description}</p>
                    <div className="mt-2 flex items-baseline gap-3">
                      <span className="text-lg font-semibold font-mono text-emerald-700">{usd(monthly)}<span className="text-xs font-normal text-slate-500">/mo</span></span>
                      <span className="text-sm font-mono text-slate-700">{usd(annual)}<span className="text-xs text-slate-500">/yr</span></span>
                    </div>
                    {isCut && (
                      <div className="mt-2 flex gap-1" role="group" aria-label="Cut percentage">
                        {[10, 20, 30].map((p) => (
                          <Button key={p} size="sm" variant={pct === p ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setCut({ ...cut, [s.id]: p })}>{p}%</Button>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-[11px] text-slate-500 font-mono">
                      {isCut ? `${usd(base)} × ${pct}% = ${usd(monthly)}/month; × 12 = ${usd(annual)}/year` : s.calculation}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-slate-400">Ideas use only spending you or your bank classified as discretionary, recurring, or fees. Estimates, not guarantees.</p>
        </section>
      </CardContent>
    </Card>
  );
}
