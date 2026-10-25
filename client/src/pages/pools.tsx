// My Savings Pools: virtual earmarks on linked money. All numbers come from
// /api/pools, which checks every allocation against live balances.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, RefreshCw, AlertTriangle, PiggyBank } from "lucide-react";
import FinanceNotices from "@/components/finance-notices";
import PoolCard from "@/components/pool-card";
import PoolEditor from "@/components/pool-editor";
import PoolFundDialog from "@/components/pool-fund-dialog";
import { POOLS_QUERY_KEY } from "@/lib/pools";
import { CLASS_LABELS, errorMessage, usd } from "@/lib/format";
import type { Pool, PoolsResponse } from "@shared/pools";

export default function PoolsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, error } = useQuery<PoolsResponse>({ queryKey: POOLS_QUERY_KEY, staleTime: 60_000 });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Pool | undefined>();
  const [fundingId, setFundingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const active = data?.pools.filter((p) => !p.archived) ?? [];
  const archived = data?.pools.filter((p) => p.archived) ?? [];
  const earmarked = active.reduce((sum, p) => sum + p.verifiedTotal, 0);
  const funding = data?.pools.find((p) => p.id === fundingId) ?? null;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">My Savings Pools</h1>
          <p className="text-sm text-slate-500">Set money aside for each goal without moving it between accounts.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => queryClient.invalidateQueries({ queryKey: POOLS_QUERY_KEY })}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" disabled={!data} onClick={() => { setEditing(undefined); setEditorOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> New pool
          </Button>
        </div>
      </div>

      {isLoading && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-72" />)}</div>}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle className="h-4 w-4 mt-0.5" /> {errorMessage(error, "Your pools could not be loaded.")}
        </div>
      )}

      {data && (
        <>
          <FinanceNotices notices={data.notices} />

          <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Allocation summary">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Assigned to active pools</div>
                <div className="text-2xl font-semibold font-mono text-slate-900">{usd(earmarked)}</div>
              </div>
              <p className="text-xs text-slate-500 max-w-md">Pools are labels on money you already have, so this is not added to your net worth.</p>
            </div>
            {data.unallocated.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="font-medium py-1 pr-4">Type of money</th>
                      <th className="font-medium py-1 pr-4 text-right">Available</th>
                      <th className="font-medium py-1 pr-4 text-right hidden sm:table-cell">Assigned</th>
                      <th className="font-medium py-1 text-right">Unassigned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.unallocated.map((row) => (
                      <tr key={row.assetClass}>
                        <td className="py-1.5 pr-4 text-slate-700">{CLASS_LABELS[row.assetClass]}</td>
                        <td className="py-1.5 pr-4 text-right font-mono">{usd(row.total)}</td>
                        <td className="py-1.5 pr-4 text-right font-mono hidden sm:table-cell">{usd(row.allocated)}</td>
                        <td className="py-1.5 text-right font-mono text-slate-900">{usd(row.unallocated)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] text-slate-400">
                  Bank accounts count the lower of current and available balance, so pending charges aren't assigned twice.
                  Investment accounts use the value your institution reports.
                </p>
              </div>
            )}
          </section>

          {active.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <PiggyBank className="h-10 w-10 mx-auto text-slate-300" />
              <p className="mt-3 font-medium text-slate-800">No savings pools yet</p>
              <p className="text-sm text-slate-500">Create one for an emergency fund, a house, a ring, or anything else.</p>
              <Button className="mt-4" onClick={() => { setEditing(undefined); setEditorOpen(true); }}><Plus className="h-4 w-4 mr-1" /> Create a pool</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {active.map((pool) => (
                <PoolCard
                  key={pool.id}
                  pool={pool}
                  ledgerVersion={data.ledgerVersion}
                  onEdit={() => { setEditing(pool); setEditorOpen(true); }}
                  onFund={() => setFundingId(pool.id)}
                />
              ))}
            </div>
          )}

          {archived.length > 0 && (
            <section>
              <Button variant="ghost" size="sm" onClick={() => setShowArchived(!showArchived)}>
                {showArchived ? "Hide" : "Show"} archived pools ({archived.length})
              </Button>
              {showArchived && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {archived.map((pool) => (
                    <PoolCard key={pool.id} pool={pool} ledgerVersion={data.ledgerVersion} onEdit={() => {}} onFund={() => {}} />
                  ))}
                </div>
              )}
            </section>
          )}

          <PoolEditor open={editorOpen} onOpenChange={setEditorOpen} pool={editing} ledgerVersion={data.ledgerVersion} />
          <PoolFundDialog
            open={fundingId !== null}
            onOpenChange={(open) => { if (!open) setFundingId(null); }}
            pool={funding}
            sources={data.sources}
            ledgerVersion={data.ledgerVersion}
          />
        </>
      )}
    </main>
  );
}
