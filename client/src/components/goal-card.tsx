// One financial goal with its projection, assumptions, and status controls.

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Pause, Pencil, Play, Archive, ArchiveRestore, Trash2, MessageSquareText } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorMessage, shortDate, usd } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { GOAL_TYPE_LABELS } from "@/components/goal-editor";
import type { Goal, GoalInput, GoalStatus, GoalView } from "@shared/goals";

// The editable fields of a goal, as the API expects them.
function goalInput(g: Goal): GoalInput {
  return {
    name: g.name, type: g.type, targetAmount: g.targetAmount, deadline: g.deadline, poolIds: g.poolIds,
    debtAccountKeys: g.debtAccountKeys, manualDebtIds: g.manualDebtIds, monthlyContribution: g.monthlyContribution,
    annualReturnPercent: g.annualReturnPercent, notes: g.notes, status: g.status,
  };
}

const STATUS_BADGE: Record<GoalStatus, string> = {
  active: "bg-emerald-100 text-emerald-800",
  paused: "bg-slate-200 text-slate-700",
  completed: "bg-indigo-100 text-indigo-800",
  archived: "bg-slate-200 text-slate-600",
};

export default function GoalCard({ goal, onEdit }: { goal: GoalView; onEdit: () => void }) {
  const [showDetails, setShowDetails] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = goal.projection;
  const isDebt = goal.type === "debt-payoff";

  const setStatus = async (status: GoalStatus) => {
    setBusy(true);
    try {
      await apiRequest("PUT", `/api/goals/${goal.id}`, { ...goalInput(goal), status });
      await queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
    } catch (e) {
      toast({ title: "Couldn't update goal", description: errorMessage(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/goals/${goal.id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
    } catch (e) {
      toast({ title: "Couldn't delete goal", description: errorMessage(e), variant: "destructive" });
      setBusy(false);
    }
  };

  return (
    <Card data-testid={`goal-${goal.id}`}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 truncate">{goal.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-slate-500">{GOAL_TYPE_LABELS[goal.type]}</span>
              <Badge variant="secondary" className={`text-[11px] font-normal capitalize ${STATUS_BADGE[goal.status]}`}>{goal.status}</Badge>
            </div>
          </div>
          {goal.status !== "archived" && (
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit} aria-label="Edit goal"><Pencil className="h-4 w-4 text-slate-500" /></Button>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-semibold font-mono text-slate-900">{usd(p.currentAmount)}</span>
            <span className="text-sm text-slate-500 text-right">
              {isDebt ? `paid of ${usd(p.targetAmount, { cents: false })} owed at start` : `of ${usd(p.targetAmount, { cents: false })}`}
            </span>
          </div>
          <Progress value={p.progressPercent} className="mt-2 h-2 bg-slate-200" aria-label={`${p.progressPercent}% complete`} />
          <div className="mt-1 flex justify-between text-xs text-slate-500">
            <span>{p.progressPercent.toFixed(1)}%</span>
            <span>{isDebt ? `${usd(p.currentDebt)} still owed` : `${usd(p.remaining)} to go`}</span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">{isDebt ? "Monthly payment" : "Monthly contribution"}</dt>
            <dd>{goal.monthlyContribution !== null ? usd(goal.monthlyContribution) : isDebt ? "Not set" : "From pools / not set"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Deadline</dt>
            <dd>{goal.deadline ? shortDate(goal.deadline) : "None"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Estimated completion</dt>
            <dd>{p.remaining <= 0.005 ? "Reached" : p.estimatedCompletion ? `${shortDate(p.estimatedCompletion)} (${p.monthsToTarget} mo)` : "Can't estimate"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Needed per month for deadline</dt>
            <dd className={p.onTrack === false ? "text-amber-700 font-medium" : ""}>{p.requiredMonthly !== null ? usd(p.requiredMonthly) : "—"}</dd>
          </div>
        </dl>
        {p.onTrack === true && <p className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> On track for the deadline under these assumptions.</p>}

        {goal.warnings.length > 0 && (
          <ul className="space-y-1">
            {goal.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 rounded-md px-2 py-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> {w}
              </li>
            ))}
          </ul>
        )}

        <div>
          <button type="button" className="flex w-full items-center justify-between text-sm font-medium text-slate-700" onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails}>
            Assumptions and linked {isDebt ? "debts" : "pools"}
            {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showDetails && (
            <div className="mt-2 space-y-3 text-sm">
              <ul className="list-disc pl-5 space-y-1 text-slate-600 text-xs">
                {goal.assumptions.map((a) => <li key={a}>{a}</li>)}
              </ul>
              <ul className="divide-y divide-slate-100">
                {isDebt
                  ? goal.linkedDebts.map((d) => <li key={d.key} className="py-1 flex justify-between"><span>{d.label} <span className="text-xs text-slate-400">({d.source === "linked" ? "linked" : "you entered"})</span></span><span className="font-mono">{usd(d.balance)}</span></li>)
                  : goal.linkedPools.map((lp) => <li key={lp.id} className="py-1 flex justify-between"><span>{lp.name}</span><span className="font-mono">{usd(lp.verifiedTotal)}</span></li>)}
              </ul>
              {goal.notes && <p className="text-xs text-slate-500 whitespace-pre-wrap">{goal.notes}</p>}
            </div>
          )}
        </div>

        {goal.status !== "archived" && (
          <Link
            href={`/advisor?q=${encodeURIComponent(`What are some realistic ways to reach my goal "${goal.name}"?`)}`}
            className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:underline"
          >
            <MessageSquareText className="h-3.5 w-3.5" /> Ask the AI Advisor about this goal
          </Link>
        )}

        <div className="flex flex-wrap gap-2">
          {goal.status === "active" && <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus("paused")}><Pause className="h-4 w-4 mr-1" /> Pause</Button>}
          {goal.status === "paused" && <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus("active")}><Play className="h-4 w-4 mr-1" /> Resume</Button>}
          {(goal.status === "active" || goal.status === "paused") && <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus("completed")}><CheckCircle2 className="h-4 w-4 mr-1" /> Mark complete</Button>}
          {goal.status !== "archived"
            ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus("archived")}><Archive className="h-4 w-4 mr-1" /> Archive</Button>
            : <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus("active")}><ArchiveRestore className="h-4 w-4 mr-1" /> Restore</Button>}
          {goal.status === "archived" && (confirmDelete
            ? <span className="flex items-center gap-2 text-xs text-rose-800">Delete permanently? <Button size="sm" variant="destructive" disabled={busy} onClick={remove}>Delete</Button><Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Keep</Button></span>
            : <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>)}
        </div>
      </CardContent>
    </Card>
  );
}
