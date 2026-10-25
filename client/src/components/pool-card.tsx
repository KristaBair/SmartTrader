// One savings pool: progress, funding sources, warnings, and history.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Archive, ArchiveRestore, ChevronDown, ChevronUp, History, Pencil, Plus, Trash2, X, Check } from "lucide-react";
import { CATEGORY_PRESETS, POOL_ICON_COMPONENTS, poolWrite } from "@/lib/pools";
import { CLASS_LABELS, dateTime, shortDate, usd } from "@/lib/format";
import type { AllocationHistoryEntry, AllocationState, AllocationView, PoolView } from "@shared/pools";

const STATE: Record<AllocationState, { label: string; className: string }> = {
  verified: { label: "Verified", className: "bg-emerald-100 text-emerald-800" },
  "over-allocated": { label: "Reduced: source is short", className: "bg-amber-100 text-amber-800" },
  unavailable: { label: "Not verified: can't refresh", className: "bg-amber-100 text-amber-800" },
  disconnected: { label: "Account disconnected", className: "bg-slate-200 text-slate-700" },
  missing: { label: "Not found", className: "bg-slate-200 text-slate-700" },
};

interface Props {
  pool: PoolView;
  ledgerVersion: number;
  onEdit: () => void;
  onFund: () => void;
}

function AllocationRow({ allocation, ledgerVersion }: { allocation: AllocationView; ledgerVersion: number }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const isAmount = allocation.kind === "amount";
  const current = isAmount ? allocation.amount : allocation.shares;

  const save = async () => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    setBusy(true);
    const ok = await poolWrite("PUT", `/api/pools/allocations/${allocation.id}`, { value: n, expectedVersion: ledgerVersion });
    setBusy(false);
    if (ok) setEditing(false);
  };
  const release = async () => {
    setBusy(true);
    await poolWrite("DELETE", `/api/pools/allocations/${allocation.id}?expectedVersion=${ledgerVersion}`, undefined, "Released");
    setBusy(false);
  };

  return (
    <li className="py-2 flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-sm text-slate-900">
          {isAmount ? usd(allocation.amount) : `${allocation.shares} sh ${allocation.symbol ?? allocation.securityName ?? ""}`}
          <span className="text-slate-500"> · {allocation.accountLabel}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          <Badge variant="secondary" className="text-[11px] font-normal">{CLASS_LABELS[allocation.assetClass]}</Badge>
          <Badge variant="secondary" className={`text-[11px] font-normal ${STATE[allocation.state].className}`}>{STATE[allocation.state].label}</Badge>
          {!isAmount && allocation.price !== null && (
            <span className="text-[11px] text-slate-500">
              {usd(allocation.price)}/sh · {allocation.priceSource}{allocation.priceAsOf ? ` · ${allocation.priceAsOf.slice(0, 10)}` : ""}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {editing ? (
          <>
            <Input className="h-8 w-28" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label={isAmount ? "New amount" : "New shares"} autoFocus />
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy} onClick={save} aria-label="Save"><Check className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy} onClick={() => setEditing(false)} aria-label="Cancel"><X className="h-4 w-4" /></Button>
          </>
        ) : (
          <>
            <span className="font-mono text-sm text-slate-900 mr-1">{usd(allocation.verifiedValue)}</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy} onClick={() => { setValue(String(current)); setEditing(true); }} aria-label="Change">
              <Pencil className="h-3.5 w-3.5 text-slate-500" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy} onClick={release} aria-label="Release">
              <X className="h-4 w-4 text-slate-500" />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function PoolHistory({ poolId }: { poolId: string }) {
  const { data = [], isLoading } = useQuery<AllocationHistoryEntry[]>({ queryKey: ["/api/pools", poolId, "history"], staleTime: 0 });
  if (isLoading) return <p className="text-xs text-slate-500">Loading history…</p>;
  if (data.length === 0) return <p className="text-xs text-slate-500">No history yet.</p>;
  return (
    <ol className="space-y-1">
      {data.map((h) => (
        <li key={h.id + h.at} className="text-xs text-slate-600">
          <span className="text-slate-400">{dateTime(h.at)}</span> · {h.description}
        </li>
      ))}
    </ol>
  );
}

export default function PoolCard({ pool, ledgerVersion, onEdit, onFund }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const Icon = POOL_ICON_COMPONENTS[pool.icon];
  const funded = pool.remaining <= 0.005;

  const setArchived = (archived: boolean) => poolWrite("PUT", `/api/pools/${pool.id}`, {
    name: pool.name, category: pool.category, icon: pool.icon, description: pool.description,
    targetAmount: pool.targetAmount, targetDate: pool.targetDate, monthlyContributionGoal: pool.monthlyContributionGoal,
    archived, expectedVersion: ledgerVersion,
  }, archived ? "Pool archived" : "Pool restored");

  return (
    <Card className={pool.archived ? "opacity-75" : ""} data-testid={`pool-${pool.id}`}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center flex-shrink-0">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-900 truncate">{pool.name}</h3>
              <div className="text-xs text-slate-500">{CATEGORY_PRESETS[pool.category].label}{pool.archived ? " · Archived" : ""}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {!pool.archived && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit} aria-label="Edit pool"><Pencil className="h-4 w-4 text-slate-500" /></Button>}
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setArchived(!pool.archived)} aria-label={pool.archived ? "Restore pool" : "Archive pool"}>
              {pool.archived ? <ArchiveRestore className="h-4 w-4 text-slate-500" /> : <Archive className="h-4 w-4 text-slate-500" />}
            </Button>
          </div>
        </div>

        {pool.description && <p className="text-sm text-slate-600">{pool.description}</p>}

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono text-slate-900">{usd(pool.verifiedTotal)}</span>
            <span className="text-sm text-slate-500">of {usd(pool.targetAmount, { cents: false })}</span>
          </div>
          <Progress value={pool.progressPercent} className="mt-2 h-2 bg-slate-200" aria-label={`${pool.progressPercent}% funded`} />
          <div className="mt-1 flex justify-between text-xs text-slate-500">
            <span>{pool.progressPercent.toFixed(1)}% funded</span>
            <span>{funded ? "Target reached" : `${usd(pool.remaining)} to go`}</span>
          </div>
          {pool.unverifiedAmount > 0 && (
            <div className="mt-1 text-xs text-amber-700">+ {usd(pool.unverifiedAmount)} recorded but not verified right now</div>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Monthly goal</dt>
            <dd className="text-slate-900">{pool.monthlyContributionGoal !== null ? usd(pool.monthlyContributionGoal) : "Not set"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Target date</dt>
            <dd className="text-slate-900">{pool.targetDate ? shortDate(pool.targetDate) : "Not set"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Estimated completion</dt>
            <dd className="text-slate-900">
              {funded ? "Done" : pool.estimatedCompletion ? `${shortDate(pool.estimatedCompletion)} (${pool.monthsToComplete} mo)` : "Set a monthly goal"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Needed per month for target date</dt>
            <dd className="text-slate-900">{pool.requiredMonthly !== null ? usd(pool.requiredMonthly) : "—"}</dd>
          </div>
        </dl>
        {!funded && pool.estimatedCompletion && (
          <p className="text-[11px] text-slate-400">Estimate assumes you add the monthly goal each month and no investment growth or loss.</p>
        )}

        {pool.warnings.length > 0 && (
          <ul className="space-y-1">
            {pool.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 rounded-md px-2 py-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}

        <div>
          <button
            type="button"
            className="flex w-full items-center justify-between text-sm font-medium text-slate-700"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            Funding sources ({pool.allocations.length})
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {expanded && (
            <ul className="mt-1 divide-y divide-slate-100">
              {pool.allocations.length === 0 && <li className="py-2 text-sm text-slate-500">No money assigned yet.</li>}
              {pool.allocations.map((a) => <AllocationRow key={a.id} allocation={a} ledgerVersion={ledgerVersion} />)}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!pool.archived && <Button size="sm" onClick={onFund}><Plus className="h-4 w-4 mr-1" /> Assign money</Button>}
          <Button size="sm" variant="ghost" onClick={() => setShowHistory(!showHistory)}><History className="h-4 w-4 mr-1" /> History</Button>
          {pool.archived && (confirmDelete ? (
            <span className="flex items-center gap-2 text-xs text-rose-800">
              Delete pool and its history?
              <Button size="sm" variant="destructive" onClick={() => poolWrite("DELETE", `/api/pools/${pool.id}?expectedVersion=${ledgerVersion}`, undefined, "Pool deleted")}>Delete</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
          ))}
        </div>
        {showHistory && <div className="rounded-lg bg-slate-50 p-3"><PoolHistory poolId={pool.id} /></div>}
      </CardContent>
    </Card>
  );
}
