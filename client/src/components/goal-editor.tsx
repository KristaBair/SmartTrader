// Create or edit a financial goal and choose which pools or debts it tracks.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorMessage, usd } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { GOAL_TYPES, type Goal, type GoalsResponse, type GoalType } from "@shared/goals";

export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  retirement: "Retirement",
  emergency: "Emergency savings",
  home: "Buying a home",
  "debt-payoff": "Paying off debt",
  college: "College savings",
  "major-purchase": "Major purchase",
  investing: "Building investments",
  custom: "Custom",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal?: Goal;
  options: Pick<GoalsResponse, "pools" | "debts">;
}

const blank = { name: "", type: "home" as GoalType, targetAmount: "", deadline: "", poolIds: [] as string[], debtKeys: [] as string[], monthly: "", annualReturn: "0", notes: "" };

export default function GoalEditor({ open, onOpenChange, goal, options }: Props) {
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setForm(goal
      ? {
          name: goal.name, type: goal.type, targetAmount: goal.type === "debt-payoff" ? "" : String(goal.targetAmount),
          deadline: goal.deadline ?? "", poolIds: goal.poolIds, debtKeys: [...goal.debtAccountKeys, ...goal.manualDebtIds],
          monthly: goal.monthlyContribution === null ? "" : String(goal.monthlyContribution),
          annualReturn: String(goal.annualReturnPercent), notes: goal.notes,
        }
      : blank);
  }, [open, goal]);

  const isDebt = form.type === "debt-payoff";
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const save = async () => {
    const target = Number(form.targetAmount);
    const monthly = form.monthly.trim() === "" ? null : Number(form.monthly);
    const annualReturn = Number(form.annualReturn || "0");
    if (!form.name.trim()) return setError("Give the goal a name.");
    if (!isDebt && (!Number.isFinite(target) || target <= 0)) return setError("Enter a target greater than $0.");
    if (isDebt && form.debtKeys.length === 0) return setError("Choose at least one debt.");
    if (monthly !== null && (!Number.isFinite(monthly) || monthly < 0)) return setError("Monthly amount must be $0 or more.");
    if (!Number.isFinite(annualReturn) || annualReturn < -20 || annualReturn > 20) return setError("Assumed return must be between -20% and 20%.");
    const body = {
      name: form.name.trim(), type: form.type, targetAmount: isDebt ? 0 : target, deadline: form.deadline || null,
      poolIds: isDebt ? [] : form.poolIds,
      debtAccountKeys: isDebt ? form.debtKeys.filter((k) => options.debts.find((d) => d.key === k)?.source === "linked") : [],
      manualDebtIds: isDebt ? form.debtKeys.filter((k) => options.debts.find((d) => d.key === k)?.source === "manual") : [],
      monthlyContribution: monthly, annualReturnPercent: isDebt ? 0 : annualReturn, notes: form.notes.trim(),
      status: goal?.status ?? "active",
    };
    setSaving(true);
    try {
      await apiRequest(goal ? "PUT" : "POST", goal ? `/api/goals/${goal.id}` : "/api/goals", body);
      await queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      toast({ title: goal ? "Goal updated" : "Goal created" });
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const activePools = options.pools.filter((p) => !p.archived || form.poolIds.includes(p.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{goal ? "Edit goal" : "New financial goal"}</DialogTitle>
          <DialogDescription>Projections use only the numbers and assumptions you see here.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as GoalType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{GOAL_TYPES.map((t) => <SelectItem key={t} value={t}>{GOAL_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="goal-name">Name</Label>
              <Input id="goal-name" maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={GOAL_TYPE_LABELS[form.type]} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!isDebt && (
              <div>
                <Label htmlFor="goal-target">Target ($)</Label>
                <Input id="goal-target" inputMode="decimal" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} />
              </div>
            )}
            <div>
              <Label htmlFor="goal-deadline">Deadline (optional)</Label>
              <Input id="goal-deadline" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="goal-monthly">{isDebt ? "Monthly payment ($)" : "Monthly contribution ($)"}</Label>
              <Input id="goal-monthly" inputMode="decimal" value={form.monthly} onChange={(e) => setForm({ ...form, monthly: e.target.value })} placeholder={isDebt ? "" : "Uses pools' monthly goals if blank"} />
            </div>
            {!isDebt && (
              <div>
                <Label htmlFor="goal-return">Assumed annual return (%)</Label>
                <Input id="goal-return" inputMode="decimal" value={form.annualReturn} onChange={(e) => setForm({ ...form, annualReturn: e.target.value })} />
                <p className="text-[11px] text-slate-500 mt-1">0% assumes no growth. Returns are never guaranteed.</p>
              </div>
            )}
          </div>

          {isDebt ? (
            <fieldset>
              <legend className="text-sm font-medium">Debts to pay off</legend>
              {options.debts.length === 0 && <p className="text-sm text-slate-500 mt-1">No debts found. Link a card or loan, or enter one on My Finances.</p>}
              <div className="mt-2 space-y-2">
                {options.debts.map((d) => (
                  <label key={d.key} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.debtKeys.includes(d.key)} onCheckedChange={() => setForm({ ...form, debtKeys: toggle(form.debtKeys, d.key) })} />
                    <span>{d.label} · {usd(d.balance)} <span className="text-slate-400">({d.source === "linked" ? "linked" : "you entered"}{d.interestRate !== null ? `, ${d.interestRate}% APR` : ""})</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <fieldset>
              <legend className="text-sm font-medium">Savings pools that count toward this goal</legend>
              {activePools.length === 0 && <p className="text-sm text-slate-500 mt-1">No pools yet. Create one on Savings Pools first.</p>}
              <div className="mt-2 space-y-2">
                {activePools.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.poolIds.includes(p.id)} onCheckedChange={() => setForm({ ...form, poolIds: toggle(form.poolIds, p.id) })} />
                    {p.name}{p.archived ? " (archived)" : ""}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div>
            <Label htmlFor="goal-notes">Notes</Label>
            <Textarea id="goal-notes" rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{goal ? "Save changes" : "Create goal"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
