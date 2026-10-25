// My Finances: one reconciled view of linked accounts and manual entries.
// Every figure comes from /api/finances/overview, which applies the counting
// rules on the server; this page only displays them.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Building2, AlertTriangle } from "lucide-react";
import FinanceNotices from "@/components/finance-notices";
import FinanceReconciliation from "@/components/finance-reconciliation";
import ManualDebts from "@/components/manual-debts";
import PlaidAccountsPanel from "@/components/plaid-accounts";
import SpendingAnalysisPanel from "@/components/spending-analysis";
import { dateTime, errorMessage, shortDate, usd } from "@/lib/format";
import type { AssetClass, FinancialOverview, LinkedAccount } from "@shared/finance";

export const CLASS_LABELS: Record<AssetClass, string> = {
  cash: "Cash",
  savings: "Savings",
  "term-deposit": "CD / term deposit",
  "taxable-investment": "Taxable investment",
  retirement: "Retirement",
  restricted: "Restricted (HSA, 529…)",
  credit: "Credit",
  loan: "Loan",
  other: "Other",
};

function Tile({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold font-mono ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function AccountRow({ account }: { account: LinkedAccount }) {
  const liability = account.assetClass === "credit" || account.assetClass === "loan";
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900 truncate">
          {account.name}{account.mask && <span className="text-slate-400"> ••{account.mask}</span>}
        </div>
        <Badge variant="secondary" className="mt-0.5 text-[11px] font-normal">{CLASS_LABELS[account.assetClass]}</Badge>
      </div>
      <div className="text-right">
        <div className={`font-mono text-sm ${liability ? "text-rose-700" : "text-slate-900"}`}>
          {liability && account.currentBalance ? "−" : ""}{usd(account.currentBalance === null ? null : Math.abs(account.currentBalance))}
        </div>
        {account.availableBalance !== null && !liability && account.availableBalance !== account.currentBalance && (
          <div className="text-xs text-slate-500">{usd(account.availableBalance)} available</div>
        )}
        {account.currency && account.currency !== "USD" && <div className="text-xs text-amber-700">{account.currency} · not counted</div>}
      </div>
    </div>
  );
}

function Breakdown({ overview }: { overview: FinancialOverview }) {
  const t = overview.totals;
  const rows = [
    { label: "Cash", value: t.cash, note: "Checking and similar. Includes confirmed manual cash." },
    { label: "Savings", value: t.savings, note: "Savings and money market." },
    { label: "CDs / term deposits", value: t.termDeposits, note: "May carry early-withdrawal penalties." },
    { label: "Taxable investments", value: t.taxableInvestments, note: "Brokerage. Value changes with the market." },
    { label: "Retirement", value: t.retirement, note: "Withdrawals before retirement age may be taxed and penalized." },
    { label: "Restricted", value: t.restricted, note: "HSA, 529, and similar. Use is limited by plan rules." },
    { label: "Other", value: t.other, note: "" },
  ].filter((r) => r.value !== 0);
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">What your assets are made of</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-slate-500">No assets to show yet.</p>}
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-sm">
              <span className="text-slate-700">{r.label}</span>
              <span className="font-mono text-slate-900">{usd(r.value)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
            </div>
            {r.note && <div className="mt-0.5 text-xs text-slate-500">{r.note}</div>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function FinancesPage() {
  const queryClient = useQueryClient();
  const { data: overview, isLoading, isFetching, error } = useQuery<FinancialOverview>({
    queryKey: ["/api/finances/overview"],
    staleTime: 60_000,
  });

  const byInstitution = new Map<string, LinkedAccount[]>();
  for (const account of overview?.accounts ?? []) {
    const list = byInstitution.get(account.itemId) ?? [];
    list.push(account);
    byInstitution.set(account.itemId, list);
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">My Finances</h1>
          <p className="text-sm text-slate-500">
            {overview ? `Updated ${dateTime(overview.generatedAt)} · linked balances as reported by each institution` : "Your accounts, reconciled in one place"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isFetching}
          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/finances/overview"] })}
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle className="h-4 w-4 mt-0.5" /> {errorMessage(error, "Your overview could not be loaded.")}
        </div>
      )}

      {overview && (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Totals">
            <Tile label="Net worth" value={usd(overview.totals.netWorth)} tone={overview.totals.netWorth < 0 ? "bad" : "default"}
              sub={overview.totals.manualEstimates > 0 ? `Includes ${usd(overview.totals.manualEstimates)} you entered` : "Assets minus debts"} />
            <Tile label="Total assets" value={usd(overview.totals.assets)} />
            <Tile label="Total debts" value={usd(overview.totals.liabilities)} sub="Linked cards & loans + debts you entered" />
            <Tile label="Cash & savings" value={usd(overview.totals.cash + overview.totals.savings)} sub="Accessible without selling investments" />
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4" aria-label="Cash flow">
            {overview.cashFlow ? (
              <>
                <Tile label="Avg. monthly income" value={usd(overview.cashFlow.monthlyIncome)} sub={`${shortDate(overview.cashFlow.periodStart)} – ${shortDate(overview.cashFlow.periodEnd)}`} />
                <Tile label="Avg. monthly spending" value={usd(overview.cashFlow.monthlyExpenses)} sub="Completed transactions, transfers excluded" />
                <Tile label="Monthly cash flow" value={usd(overview.cashFlow.monthlySurplus)} tone={overview.cashFlow.monthlySurplus >= 0 ? "good" : "bad"} sub="Income minus spending" />
              </>
            ) : (
              <div className="sm:col-span-3 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                Income, spending, and monthly cash flow appear here once a bank account is linked for spending.
              </div>
            )}
          </section>

          <FinanceNotices notices={overview.notices} />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader><CardTitle className="text-base">Linked accounts</CardTitle></CardHeader>
                <CardContent className="space-y-5">
                  {overview.institutions.length === 0 && (
                    <p className="text-sm text-slate-500">No institutions linked yet. Use "Connected accounts" below to link one.</p>
                  )}
                  {overview.institutions.map((inst) => (
                    <div key={inst.itemId}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                          <Building2 className="h-4 w-4 text-slate-400" /> {inst.institutionName}
                        </div>
                        <span className={`text-xs ${inst.status === "connected" ? "text-slate-500" : "text-amber-700"}`}>
                          {inst.status === "connected" ? `Retrieved ${dateTime(inst.retrievedAt)}` : inst.message}
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100">
                        {(byInstitution.get(inst.itemId) ?? []).map((a) => <AccountRow key={a.key} account={a} />)}
                        {inst.status === "connected" && (byInstitution.get(inst.itemId) ?? []).length === 0 && inst.accountCount > 0 && (
                          <p className="py-2 text-xs text-slate-500">These accounts are already shown under another connection to the same institution.</p>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <FinanceReconciliation overview={overview} />
            </div>
            <div className="space-y-6">
              <Breakdown overview={overview} />
              <ManualDebts debts={overview.manualLiabilities} />
            </div>
          </div>
        </>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6" aria-label="Connected accounts">
        <PlaidAccountsPanel />
        <SpendingAnalysisPanel />
      </section>
    </main>
  );
}
