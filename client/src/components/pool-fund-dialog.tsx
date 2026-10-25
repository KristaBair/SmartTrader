// Assign part of a linked account or holding to a pool. Shows how much of each
// source is still free; the server re-checks against live balances on save.

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { poolWrite } from "@/lib/pools";
import { CLASS_LABELS, usd } from "@/lib/format";
import type { AssetClass } from "@shared/finance";
import type { FundingSource, PoolView } from "@shared/pools";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pool: PoolView | null;
  sources: FundingSource[];
  ledgerVersion: number;
}

const sourceId = (s: FundingSource) => `${s.kind}|${s.accountKey}|${s.securityKey ?? ""}`;
const CLASS_ORDER: AssetClass[] = ["cash", "savings", "term-deposit", "taxable-investment", "retirement", "restricted", "other"];

export default function PoolFundDialog({ open, onOpenChange, pool, sources, ledgerVersion }: Props) {
  const [selected, setSelected] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setSelected(""); setValue(""); setError(""); }
  }, [open]);

  const source = sources.find((s) => sourceId(s) === selected);
  const grouped = useMemo(() => CLASS_ORDER
    .map((c) => ({ assetClass: c, items: sources.filter((s) => s.assetClass === c && s.remaining > 0) }))
    .filter((g) => g.items.length > 0), [sources]);

  if (!pool) return null;
  const emergencyMismatch = pool.category === "emergency" && source && source.assetClass !== "cash" && source.assetClass !== "savings";

  const save = async () => {
    if (!source) return setError("Choose where the money comes from.");
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return setError(source.kind === "amount" ? "Enter an amount greater than $0." : "Enter a number of shares greater than 0.");
    if (n > source.remaining + 1e-9) {
      return setError(source.kind === "amount"
        ? `Only ${usd(source.remaining)} of this account is free to assign.`
        : `Only ${source.remaining} shares are free to assign.`);
    }
    setSaving(true);
    const allocation = source.kind === "amount"
      ? { kind: "amount", poolId: pool.id, accountKey: source.accountKey, amount: Math.round(n * 100) / 100 }
      : { kind: "shares", poolId: pool.id, accountKey: source.accountKey, securityKey: source.securityKey, shares: n };
    const ok = await poolWrite("POST", "/api/pools/allocations", { allocation, expectedVersion: ledgerVersion }, `Added to ${pool.name}`);
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign money to {pool.name}</DialogTitle>
          <DialogDescription>
            This only labels money you already have. Nothing is transferred or sold, and your net worth doesn't change.
          </DialogDescription>
        </DialogHeader>
        {grouped.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nothing is free to assign. Link an account on My Finances, or release money from another pool.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <Label>From</Label>
              <Select value={selected} onValueChange={(v) => { setSelected(v); setValue(""); setError(""); }}>
                <SelectTrigger><SelectValue placeholder="Choose an account or holding" /></SelectTrigger>
                <SelectContent>
                  {grouped.map((g) => (
                    <SelectGroup key={g.assetClass}>
                      <SelectLabel>{CLASS_LABELS[g.assetClass]}</SelectLabel>
                      {g.items.map((s) => (
                        <SelectItem key={sourceId(s)} value={sourceId(s)}>
                          {s.kind === "amount" ? `${s.label} · ${usd(s.remaining)} free` : `${s.label} · ${s.remaining} sh free`}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {source && (
              <>
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                  <div>{source.institutionName} · {CLASS_LABELS[source.assetClass]}</div>
                  <div>
                    {source.kind === "amount"
                      ? <>Free to assign: <b>{usd(source.remaining)}</b> of {usd(source.capacity)} ({source.basis.toLowerCase()})</>
                      : <>Free to assign: <b>{source.remaining}</b> of {source.capacity} shares{source.price !== null && <> · {usd(source.price)}/share ({source.priceSource}{source.priceAsOf ? `, ${source.priceAsOf.slice(0, 10)}` : ""})</>}</>}
                  </div>
                </div>
                {emergencyMismatch && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    {source.assetClass === "retirement" || source.assetClass === "restricted"
                      ? "Retirement and restricted accounts usually can't be used for emergencies without taxes or penalties. The Emergency Fund Planner won't count this as accessible cash."
                      : "Investments can lose value and take days to sell, so the Emergency Fund Planner won't count this as accessible cash."}
                  </div>
                )}
                <div>
                  <Label htmlFor="fund-value">{source.kind === "amount" ? "Amount ($)" : "Shares"}</Label>
                  <div className="flex gap-2">
                    <Input id="fund-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
                    <Button type="button" variant="outline" onClick={() => setValue(String(source.remaining))}>All free</Button>
                  </div>
                </div>
              </>
            )}
            {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || grouped.length === 0}>Assign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
