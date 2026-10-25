import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CLASS_LABELS, shortDate } from "@/lib/format";
import type { ConsolidatedInvestmentPosition, ManualStatus } from "@shared/finance";

const manualStatus: Record<ManualStatus, string> = {
  counted: "Manual · counted",
  duplicate: "Manual · duplicate excluded",
  "needs-review": "Manual · needs review",
  unpriced: "Manual · no verified price",
};

function money(value: number | null, currency: string | null) {
  if (value === null) return "Not reported";
  if (!currency) return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · currency not reported`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  }
}

function PositionRow({ position }: { position: ConsolidatedInvestmentPosition }) {
  const accountNames = Array.from(new Set(position.linkedPositions.map((p) => {
    const detail = p.accountSubtype || p.accountType;
    return `${p.accountName}${p.accountMask ? ` ···· ${p.accountMask}` : ""} · ${CLASS_LABELS[p.accountClass] || detail}`;
  })));
  const hasStalePrice = position.linkedPositions.some((p) => p.stalePrice);
  const categoryLabels = {
    "cash-equivalent": "Cash equivalent",
    stock: "Individual stock",
    etf: "ETF",
    "mutual-fund": "Mutual fund",
    bond: "Bond / fixed income",
    other: "Other security",
    unknown: "Type not provided",
  } as const;

  return (
    <tr className="align-top">
      <td className="py-3 pr-4">
        <div className="font-medium text-slate-900">{position.symbol || position.name}</div>
        {position.symbol && <div className="text-xs text-slate-500">{position.name}</div>}
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge variant="outline" className="text-[10px]">
            {position.source === "mixed" ? "Linked + manual" : position.source === "linked" ? "Plaid linked" : "Manual"}
          </Badge>
          <Badge variant="secondary" className="text-[10px]" title={position.securityType ?? undefined}>
            {categoryLabels[position.securityCategory]}
          </Badge>
          {hasStalePrice && <Badge variant="outline" className="text-[10px] text-amber-800">Reported price may be stale</Badge>}
        </div>
      </td>
      <td className="py-3 pr-4 text-right font-mono text-slate-800">{position.shares.toLocaleString("en-US", { maximumFractionDigits: 6 })}</td>
      <td className="py-3 pr-4 text-right font-mono text-slate-800">
        {money(position.marketValue, position.currency)}
        {!position.valueComplete && position.marketValue !== null && <div className="text-[11px] text-amber-700">Partial; some values unavailable</div>}
      </td>
      <td className="py-3 pr-4 text-right font-mono text-slate-700">
        {money(position.costBasis, position.currency)}
        {!position.costBasisComplete && position.costBasis !== null && <div className="text-[11px] text-slate-500">Partial or not reported for all positions</div>}
      </td>
      <td className="py-3 text-sm text-slate-600">
        {accountNames.map((name) => <div key={name}>{name}</div>)}
        {position.manualEntries.map((entry, index) => (
          <div key={`${entry.name}-${index}`} className="mt-1">
            <span>{entry.shares.toLocaleString("en-US", { maximumFractionDigits: 6 })} shares · manual entry</span>
            <Badge variant="secondary" className="ml-1 text-[10px]">{manualStatus[entry.status]}</Badge>
            {entry.priceAsOf && <div className="text-[11px] text-slate-500">Manual quote as of {shortDate(entry.priceAsOf)}</div>}
          </div>
        ))}
        {position.linkedPositions.map((p) => (
          <div key={`${p.accountKey}-${p.itemId}`} className="text-[11px] text-slate-500">
            Linked data retrieved {shortDate(p.retrievedAt)}
            {p.priceAsOf ? ` · price as of ${shortDate(p.priceAsOf)}` : " · price date not provided"}
          </div>
        ))}
      </td>
    </tr>
  );
}

export default function InvestmentPortfolio({ positions }: { positions: ConsolidatedInvestmentPosition[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Consolidated investment holdings</CardTitle>
        <p className="text-sm text-slate-500">
          Plaid positions are grouped across linked accounts while account-level details remain visible. Manual entries
          that overlap a linked holding are excluded until you confirm they are separate.
        </p>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs leading-5 text-indigo-900">
          These are position details, not an additional net-worth total. Investment account balances already include
          their holdings. Plaid does not provide underlying ETF or mutual-fund holdings or expense ratios here.
        </div>
        {positions.length === 0 ? (
          <p className="text-sm text-slate-500">No investment positions are available yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-2 pr-4 font-medium">Security</th>
                  <th className="py-2 pr-4 text-right font-medium">Shares</th>
                  <th className="py-2 pr-4 text-right font-medium">Reported value</th>
                  <th className="py-2 pr-4 text-right font-medium">Cost basis</th>
                  <th className="py-2 font-medium">Account and data source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {positions.map((position) => <PositionRow key={position.id} position={position} />)}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
