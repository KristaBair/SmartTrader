import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import type { MarketData } from "@shared/schema";

const LABELS: Record<string, string> = {
  SPY: "S&P 500 (SPY)",
  QQQ: "NASDAQ-100 (QQQ)",
  VIX: "Volatility (VIX)",
};

const FRESHNESS_LABELS: Record<NonNullable<MarketData["freshness"]>, string> = {
  "real-time": "Real-time",
  delayed: "Delayed",
  "previous-close": "Last close",
  historical: "Historical",
};

// Market overview cards. Every value shows its source and time; a symbol with no
// verified quote says so instead of showing a stand-in number.
export default function MarketTrends() {
  const { data: marketData = [], isLoading, isError } = useQuery<MarketData[]>({
    queryKey: ["/api/market-data"],
  });

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center">
          <BarChart3 className="text-secondary mr-3" />
          Market Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-4">
                <Skeleton className="h-4 w-16 mb-2" />
                <Skeleton className="h-8 w-24 mb-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-gray-500" data-testid="market-data-error">
            Market data could not be loaded. Try again later.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {marketData.map((quote) => {
              // For VIX, a rise means more expected volatility, so the colors flip.
              const inverse = quote.symbol === "VIX";
              const isUp = (quote.change ?? 0) > 0;
              const good = inverse ? !isUp : isUp;
              return (
                <div key={quote.symbol} className="bg-gray-50 rounded-lg p-4" data-testid={`market-card-${quote.symbol.toLowerCase()}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">{LABELS[quote.symbol] ?? quote.symbol}</span>
                    {quote.available && (isUp
                      ? <TrendingUp className={`h-4 w-4 ${good ? "text-profit" : "text-loss"}`} />
                      : <TrendingDown className={`h-4 w-4 ${good ? "text-profit" : "text-loss"}`} />)}
                  </div>
                  {quote.available && quote.price !== null ? (
                    <>
                      <div className="text-2xl font-bold text-gray-900 font-mono">{quote.price.toFixed(2)}</div>
                      <div className={`text-sm ${good ? "text-profit" : "text-loss"}`}>
                        {isUp ? "+" : ""}{(quote.changePercent ?? 0).toFixed(2)}% ({isUp ? "+" : ""}{(quote.change ?? 0).toFixed(2)})
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {quote.freshness ? FRESHNESS_LABELS[quote.freshness] : "Unverified"}
                        {quote.asOf ? ` · ${new Date(quote.asOf).toLocaleString()}` : ""}
                        {quote.source ? ` · ${quote.source}` : ""}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-2xl font-bold text-gray-300 font-mono">—</div>
                      <div className="text-xs text-gray-500 mt-1">
                        No verified quote available from the current data provider.
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
