// Create or edit a savings pool's definition (not its money).

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORY_PRESETS, POOL_ICON_COMPONENTS, poolWrite } from "@/lib/pools";
import { POOL_CATEGORIES, POOL_ICONS, type Pool, type PoolCategory, type PoolIcon } from "@shared/pools";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pool?: Pool;
  ledgerVersion: number;
}

const blank = () => ({
  name: "", category: "emergency" as PoolCategory, icon: "shield" as PoolIcon, description: "",
  targetAmount: "", targetDate: "", monthlyContributionGoal: "",
});

export default function PoolEditor({ open, onOpenChange, pool, ledgerVersion }: Props) {
  const [form, setForm] = useState(blank());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    setForm(pool
      ? {
          name: pool.name, category: pool.category, icon: pool.icon, description: pool.description,
          targetAmount: String(pool.targetAmount), targetDate: pool.targetDate ?? "",
          monthlyContributionGoal: pool.monthlyContributionGoal === null ? "" : String(pool.monthlyContributionGoal),
        }
      : { ...blank(), name: CATEGORY_PRESETS.emergency.name });
  }, [open, pool]);

  const chooseCategory = (category: PoolCategory) => {
    const preset = CATEGORY_PRESETS[category];
    // Only replace the name if the user hasn't typed their own.
    const isPresetName = Object.values(CATEGORY_PRESETS).some((p) => p.name === form.name) || form.name === "";
    setForm({ ...form, category, icon: preset.icon, name: isPresetName ? preset.name : form.name });
  };

  const save = async () => {
    const targetAmount = Number(form.targetAmount);
    const monthly = form.monthlyContributionGoal.trim() === "" ? null : Number(form.monthlyContributionGoal);
    if (!form.name.trim()) return setError("Give the pool a name.");
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) return setError("Enter a target amount greater than $0.");
    if (monthly !== null && (!Number.isFinite(monthly) || monthly < 0)) return setError("Monthly goal must be $0 or more.");
    if (form.targetDate && form.targetDate <= new Date().toISOString().slice(0, 10)) return setError("Choose a target date in the future, or leave it blank.");
    setSaving(true);
    const body = {
      name: form.name.trim(), category: form.category, icon: form.icon, description: form.description.trim(),
      targetAmount, targetDate: form.targetDate || null, monthlyContributionGoal: monthly,
      archived: pool?.archived ?? false, expectedVersion: ledgerVersion,
    };
    const ok = pool
      ? await poolWrite("PUT", `/api/pools/${pool.id}`, body, "Pool updated")
      : await poolWrite("POST", "/api/pools", body, "Pool created");
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{pool ? "Edit pool" : "New savings pool"}</DialogTitle>
          <DialogDescription>A pool is a label for money you already have. It never moves money.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={form.category} onValueChange={(v) => chooseCategory(v as PoolCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POOL_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CATEGORY_PRESETS[c].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pool-name">Name</Label>
              <Input id="pool-name" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Icon</Label>
            <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Pool icon">
              {POOL_ICONS.map((icon) => {
                const Icon = POOL_ICON_COMPONENTS[icon];
                const selected = form.icon === icon;
                return (
                  <button
                    key={icon}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={icon}
                    onClick={() => setForm({ ...form, icon })}
                    className={`h-9 w-9 rounded-lg border flex items-center justify-center ${selected ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="pool-target">Target ($)</Label>
              <Input id="pool-target" inputMode="decimal" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="pool-date">Target date</Label>
              <Input id="pool-date" type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="pool-monthly">Monthly goal ($)</Label>
              <Input id="pool-monthly" inputMode="decimal" value={form.monthlyContributionGoal} onChange={(e) => setForm({ ...form, monthlyContributionGoal: e.target.value })} />
            </div>
          </div>
          <div>
            <Label htmlFor="pool-desc">Description</Label>
            <Textarea id="pool-desc" maxLength={500} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{pool ? "Save changes" : "Create pool"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
