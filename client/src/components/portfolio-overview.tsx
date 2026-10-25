import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { PortfolioView } from "@/lib/userData";

interface PortfolioOverviewProps {
  portfolio?: PortfolioView;
  isLoading: boolean;
}

// Subset of the server's StockQuote that this card uses.
interface VerifiedQuote {
  price: number;
  provenance: { source: string; asOf: string; freshness: string };
}

const usd = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

// Summary of the user's manually entered holdings, valued at verified quotes.
// Gain/loss uses the average cost the user entered; holdings without a verified
// quote are listed as unpriced and left out of market-value totals.
export default function PortfolioOverview({ portfolio, isLoading }: PortfolioOverviewProps) {
  const symbols = Array.from(new Set(portfolio?.investments.map((i) => i.symbol) ?? [])).sort();
  const { data: quotes = {}, isLoading: quotesLoading, isError: quotesError } = useQuery<Record<string, VerifiedQuote>>({
    queryKey: ["/api/stocks/quotes", symbols],
    queryFn: async () => (await apiRequest("POST", "/api/stocks/quotes", { symbols })).json(),
    enabled: symbols.length > 0,
    staleTime: 60_000,
  });

  const header = (
    <CardHeader>
      <CardTitle className="flex items-center">
        <Wallet className="text-accent mr-3" />
        Manual Holdings Overview
      </CardTitle>
    </CardHeader>
  );

  if (isLoading || (symbols.length > 0 && quotesLoading)) {
    return (
      <Card>
        {header}
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (!portfolio || (portfolio.investments.length === 0 && portfolio.cash === 0)) {
    return (
      <Card>
        {header}
        <CardContent>
          <div className="text-center py-8 text-gray-500" data-testid="empty-portfolio">
            <Wallet className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium mb-2">No manual holdings</p>
            <p className="text-sm">Add holdings you hold outside your linked accounts to see them valued here.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const rows = portfolio.investments.map((inv) => {
    const quote = quotes[inv.symbol];
    const costBasis = inv.averagePrice > 0 ? inv.shares * inv.averagePrice : null;
    const marketValue = quote ? inv.shares * quote.price : null;
    return { ...inv, quote, costBasis, marketValue };
  });
  const priced = rows.filter((r) => r.marketValue !== null);
  const unpriced = rows.filter((r) => r.marketValue === null);
  const marketValueTotal = priced.reduce((sum, r) => sum + r.marketValue!, 0);
  // Only holdings with both a cost and a verified price contribute to gain/loss.
  const comparable = priced.filter((r) => r.costBasis !== null);
  const comparableCost = comparable.reduce((sum, r) => sum + r.costBasis!, 0);
  const gainLoss = comparable.reduce((sum, r) => sum + (r.marketValue! - r.costBasis!), 0);
  const gainLossPct = comparableCost > 0 ? (gainLoss / comparableCost) * 100 : null;
  const latestAsOf = priced
    .map((r) => r.quote!.provenance.asOf)
    .sort()
    .at(-1);

  return (
    <Card>
      {header}
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg" data-testid="total-portfolio-value">
              <span className="text-gray-600">Market value of priced holdings</span>
              <span className="text-2xl font-bold text-gray-900 font-mono">{usd(marketValueTotal)}</span>
            </div>

            <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg" data-testid="total-gain-loss">
              <span className="text-gray-600">Gain/loss vs. your average cost</span>
              {gainLossPct === null ? (
                <span className="text-sm text-gray-500">Needs average cost and a verified price</span>
              ) : (
                <span className={`text-lg font-semibold font-mono ${gainLoss >= 0 ? "text-profit" : "text-loss"}`}>
                  {gainLoss >= 0 ? "+" : ""}{usd(gainLoss)} ({gainLoss >= 0 ? "+" : ""}{gainLossPct.toFixed(1)}%)
                </span>
              )}
            </div>

            <div className="flex justify-between items-center p-4 bg-blue-50 rounded-lg" data-testid="available-cash">
              <span className="text-blue-700">Cash (you entered)</span>
              <span className="text-lg font-semibold text-blue-900 font-mono">{usd(portfolio.cash)}</span>
            </div>

            <p className="text-xs text-gray-500">
              Holdings and cash here are what you entered by hand.
              {latestAsOf ? ` Prices: Finnhub, latest ${new Date(latestAsOf).toLocaleString()}.` : ""}
              {" "}Accounts you link with Plaid are shown separately so nothing is counted twice.
            </p>
          </div>

          <div>
            <h4 className="font-medium text-gray-900 mb-4" data-testid="asset-allocation-title">Allocation by market value</h4>
            {priced.length > 0 ? (
              <div className="space-y-3">
                {priced
                  .sort((a, b) => b.marketValue! - a.marketValue!)
                  .map((r) => (
                    <div key={r.symbol} className="flex items-center justify-between" data-testid={`allocation-${r.symbol.toLowerCase()}`}>
                      <span className="text-sm text-gray-700">{r.symbol} <span className="text-gray-400">· {r.shares} sh</span></span>
                      <span className="text-sm font-medium text-gray-900">
                        {((r.marketValue! / marketValueTotal) * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No holdings could be priced yet.</p>
            )}

            {(unpriced.length > 0 || quotesError) && (
              <div className="mt-4 flex items-start gap-2 p-3 bg-yellow-50 rounded-lg text-sm text-yellow-800" data-testid="unpriced-holdings">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  {quotesError
                    ? "Prices could not be loaded, so market values are not shown."
                    : `No verified price for ${unpriced.map((r) => r.symbol).join(", ")}. ${unpriced.length === 1 ? "It is" : "They are"} left out of the totals.`}
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
