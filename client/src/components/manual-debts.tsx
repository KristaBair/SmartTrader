// Debts the user enters by hand: loans at institutions they haven't linked,
// or details Plaid doesn't provide (Plaid Liabilities is not enabled).

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, usd } from "@/lib/format";
import type { ManualLiability, ManualLiabilityInput } from "@shared/finance";

const KINDS: { value: ManualLiabilityInput["kind"]; label: string }[] = [
  { value: "credit-card", label: "Credit card" },
  { value: "student-loan", label: "Student loan" },
  { value: "auto-loan", label: "Auto loan" },
  { value: "mortgage", label: "Mortgage" },
  { value: "personal-loan", label: "Personal loan" },
  { value: "medical", label: "Medical debt" },
  { value: "other", label: "Other" },
];

const optionalNumber = (value: string) => (value.trim() === "" ? null : Number(value));

export default function ManualDebts({ debts }: { debts: ManualLiability[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "credit-card" as ManualLiabilityInput["kind"], balance: "", monthlyPayment: "", interestRate: "" });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/finances/overview"] });

  const add = async () => {
    const balance = Number(form.balance);
    if (!form.name.trim() || !Number.isFinite(balance) || balance < 0) {
      toast({ title: "Enter a name and a balance of $0 or more", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await apiRequest("POST", "/api/finances/liabilities", {
        name: form.name.trim(),
        kind: form.kind,
        balance,
        monthlyPayment: optionalNumber(form.monthlyPayment),
        interestRate: optionalNumber(form.interestRate),
      });
      setForm({ name: "", kind: "credit-card", balance: "", monthlyPayment: "", interestRate: "" });
      setAdding(false);
      await refresh();
    } catch (error) {
      toast({ title: "Couldn't add debt", description: errorMessage(error), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/finances/liabilities/${id}`);
      await refresh();
    } catch (error) {
      toast({ title: "Couldn't remove debt", description: errorMessage(error), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center text-base">
            <CreditCard className="h-4 w-4 mr-2 text-indigo-600" />
            Debts you entered
          </CardTitle>
          <p className="text-sm text-slate-500 mt-1">Add loans or cards that aren't linked. Linked card and loan balances are included automatically.</p>
        </div>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {debts.length === 0 && !adding && <p className="text-sm text-slate-500">No debts entered.</p>}
        {debts.map((debt) => (
          <div key={debt.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
            <div className="min-w-0">
              <div className="font-medium text-slate-900 truncate">{debt.name}</div>
              <div className="text-xs text-slate-500">
                {KINDS.find((k) => k.value === debt.kind)?.label}
                {debt.monthlyPayment !== null && ` · ${usd(debt.monthlyPayment)}/mo`}
                {debt.interestRate !== null && ` · ${debt.interestRate}% APR`}
                {" · you entered"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-slate-900">{usd(debt.balance)}</span>
              <Button size="icon" variant="ghost" disabled={busy} onClick={() => remove(debt.id)} aria-label={`Remove ${debt.name}`}>
                <Trash2 className="h-4 w-4 text-slate-500" />
              </Button>
            </div>
          </div>
        ))}
        {adding && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="debt-name">Name</Label>
                <Input id="debt-name" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Student loan" />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={form.kind} onValueChange={(kind) => setForm({ ...form, kind: kind as ManualLiabilityInput["kind"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="debt-balance">Balance owed ($)</Label>
                <Input id="debt-balance" inputMode="decimal" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="debt-payment">Monthly payment ($, optional)</Label>
                <Input id="debt-payment" inputMode="decimal" value={form.monthlyPayment} onChange={(e) => setForm({ ...form, monthlyPayment: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="debt-rate">Interest rate (APR %, optional)</Label>
                <Input id="debt-rate" inputMode="decimal" value={form.interestRate} onChange={(e) => setForm({ ...form, interestRate: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={add}>Save debt</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
