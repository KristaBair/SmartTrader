// Financial Goals plus the planning calculators. Goal progress comes from
// savings pools and debt balances; projections are deterministic.

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Plus, Target } from "lucide-react";
import GoalCard from "@/components/goal-card";
import GoalEditor from "@/components/goal-editor";
import { errorMessage } from "@/lib/format";
import EmergencyPlanner from "@/components/emergency-planner";
import RentPlanner from "@/components/rent-planner";
import RetirementPlanner from "@/components/retirement-planner";
import type { Goal, GoalsResponse } from "@shared/goals";

export interface PlannerTab {
  value: string;
  label: string;
  content: ReactNode;
}

function GoalsList() {
  const { data, isLoading, error } = useQuery<GoalsResponse>({ queryKey: ["/api/goals"], staleTime: 60_000 });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | undefined>();
  const [showArchived, setShowArchived] = useState(false);
  const open = (goal?: Goal) => { setEditing(goal); setEditorOpen(true); };

  const visible = data?.goals.filter((g) => g.status !== "archived") ?? [];
  const archived = data?.goals.filter((g) => g.status === "archived") ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" disabled={!data} onClick={() => open()}><Plus className="h-4 w-4 mr-1" /> New goal</Button>
      </div>
      {isLoading && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{[1, 2].map((i) => <Skeleton key={i} className="h-72" />)}</div>}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle className="h-4 w-4 mt-0.5" /> {errorMessage(error, "Your goals could not be loaded.")}
        </div>
      )}
      {data && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Target className="h-10 w-10 mx-auto text-slate-300" />
          <p className="mt-3 font-medium text-slate-800">No goals yet</p>
          <p className="text-sm text-slate-500">Set a goal for a home, retirement, paying off debt, or anything else, and link the pools that fund it.</p>
          <Button className="mt-4" onClick={() => open()}><Plus className="h-4 w-4 mr-1" /> Create a goal</Button>
        </div>
      )}
      {data && visible.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((g) => <GoalCard key={g.id} goal={g} onEdit={() => open(g)} />)}
        </div>
      )}
      {archived.length > 0 && (
        <section>
          <Button variant="ghost" size="sm" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Hide" : "Show"} archived goals ({archived.length})</Button>
          {showArchived && <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{archived.map((g) => <GoalCard key={g.id} goal={g} onEdit={() => {}} />)}</div>}
        </section>
      )}
      {data && <GoalEditor open={editorOpen} onOpenChange={setEditorOpen} goal={editing} options={data} />}
    </div>
  );
}

// Each planner is a self-contained component.
export const PLANNER_TABS: PlannerTab[] = [
  { value: "emergency", label: "Emergency fund", content: <EmergencyPlanner /> },
  { value: "rent", label: "Rent affordability", content: <RentPlanner /> },
  { value: "retirement", label: "Retirement", content: <RetirementPlanner /> },
];

export default function GoalsPage() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Financial Goals</h1>
        <p className="text-sm text-slate-500">Track goals, and use planners built on your real numbers. For education and planning, not personalized financial advice.</p>
      </div>
      <Tabs defaultValue="goals">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="goals">My goals</TabsTrigger>
            {PLANNER_TABS.map((t) => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
          </TabsList>
        </div>
        <TabsContent value="goals" className="mt-4"><GoalsList /></TabsContent>
        {PLANNER_TABS.map((t) => <TabsContent key={t.value} value={t.value} className="mt-4">{t.content}</TabsContent>)}
      </Tabs>
    </main>
  );
}
