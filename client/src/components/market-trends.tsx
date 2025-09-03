import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, BarChart3, Info, AlertTriangle } from "lucide-react";
import type { MarketData } from "@shared/schema";

export default function MarketTrends() {
  const { data: marketData = [], isLoading } = useQuery<MarketData[]>({
    queryKey: ["/api/market-data"],
  });

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center">
            <BarChart3 className="text-secondary mr-3" />
            Market Trends Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-4">
                <Skeleton className="h-4 w-16 mb-2" />
                <Skeleton className="h-8 w-24 mb-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
          <Skeleton className="h-64 w-full mb-6" />
        </CardContent>
      </Card>
    );
  }

  const getMarketIndicator = (symbol: string) => {
    const data = marketData.find(d => d.symbol === symbol);
    if (!data) return null;

    const change = parseFloat(data.change);
    const changePercent = parseFloat(data.changePercent);
    const isPositive = change > 0;

    return {
      ...data,
      change,
      changePercent,
      isPositive,
    };
  };

  const sp500 = getMarketIndicator("SPY");
  const nasdaq = getMarketIndicator("QQQ");
  const vix = getMarketIndicator("VIX");

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center">
          <BarChart3 className="text-secondary mr-3" />
          Market Trends Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Market Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {sp500 && (
            <div className="bg-gray-50 rounded-lg p-4" data-testid="market-card-sp500">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">S&P 500</span>
                {sp500.isPositive ? (
                  <TrendingUp className="text-profit h-4 w-4" />
                ) : (
                  <TrendingDown className="text-loss h-4 w-4" />
                )}
              </div>
              <div className="text-2xl font-bold text-gray-900 font-mono" data-testid="text-sp500-price">
                {parseFloat(sp500.price).toFixed(2)}
              </div>
              <div className={`text-sm ${sp500.isPositive ? 'text-profit' : 'text-loss'}`} data-testid="text-sp500-change">
                {sp500.isPositive ? '+' : ''}{sp500.changePercent.toFixed(1)}% ({sp500.isPositive ? '+' : ''}{sp500.change.toFixed(2)})
              </div>
            </div>
          )}

          {nasdaq && (
            <div className="bg-gray-50 rounded-lg p-4" data-testid="market-card-nasdaq">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">NASDAQ</span>
                {nasdaq.isPositive ? (
                  <TrendingUp className="text-profit h-4 w-4" />
                ) : (
                  <TrendingDown className="text-loss h-4 w-4" />
                )}
              </div>
              <div className="text-2xl font-bold text-gray-900 font-mono" data-testid="text-nasdaq-price">
                {parseFloat(nasdaq.price).toFixed(2)}
              </div>
              <div className={`text-sm ${nasdaq.isPositive ? 'text-profit' : 'text-loss'}`} data-testid="text-nasdaq-change">
                {nasdaq.isPositive ? '+' : ''}{nasdaq.changePercent.toFixed(1)}% ({nasdaq.isPositive ? '+' : ''}{nasdaq.change.toFixed(2)})
              </div>
            </div>
          )}

          {vix && (
            <div className="bg-gray-50 rounded-lg p-4" data-testid="market-card-vix">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">VIX</span>
                {vix.isPositive ? (
                  <TrendingUp className="text-loss h-4 w-4" />
                ) : (
                  <TrendingDown className="text-profit h-4 w-4" />
                )}
              </div>
              <div className="text-2xl font-bold text-gray-900 font-mono" data-testid="text-vix-price">
                {parseFloat(vix.price).toFixed(2)}
              </div>
              <div className={`text-sm ${vix.isPositive ? 'text-loss' : 'text-profit'}`} data-testid="text-vix-change">
                {vix.isPositive ? '+' : ''}{vix.changePercent.toFixed(1)}% ({vix.isPositive ? '+' : ''}{vix.change.toFixed(2)})
              </div>
            </div>
          )}
        </div>

        {/* Chart Placeholder */}
        <div className="bg-gray-50 rounded-lg p-6 h-64 flex items-center justify-center mb-6" data-testid="chart-placeholder">
          <div className="text-center text-gray-500">
            <BarChart3 className="h-12 w-12 mx-auto mb-4" />
            <p className="text-sm font-medium">Market Trends Chart</p>
            <p className="text-xs text-gray-400 mt-1">Real-time visualization coming soon</p>
          </div>
        </div>

        {/* Trend Insights */}
        <div className="space-y-3">
          <div className="flex items-start space-x-3 p-3 bg-blue-50 rounded-lg" data-testid="market-sentiment">
            <Info className="text-blue-600 mt-0.5 h-4 w-4" />
            <div className="text-sm">
              <span className="font-medium text-blue-900">Market Sentiment:</span>
              <span className="text-blue-700 ml-1">
                Bullish - Technology sector showing strong momentum with AI-related stocks leading gains.
              </span>
            </div>
          </div>
          
          <div className="flex items-start space-x-3 p-3 bg-yellow-50 rounded-lg" data-testid="risk-alert">
            <AlertTriangle className="text-yellow-600 mt-0.5 h-4 w-4" />
            <div className="text-sm">
              <span className="font-medium text-yellow-900">Risk Alert:</span>
              <span className="text-yellow-700 ml-1">
                Federal Reserve meeting next week may impact interest rate expectations.
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
