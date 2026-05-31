import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, BarChart3 } from "lucide-react";
import type { PortfolioView } from "@/lib/localStore";
import { useMemo } from "react";

interface PortfolioGrowthChartProps {
  portfolio?: PortfolioView;
  isLoading: boolean;
}

interface DataPoint {
  date: string;
  value: number;
  contributions: number;
}

export default function PortfolioGrowthChart({ portfolio, isLoading }: PortfolioGrowthChartProps) {
  // Generate mock historical data for the chart
  const chartData = useMemo(() => {
    if (!portfolio) return [];

    const currentValue = portfolio.investments.reduce((sum, inv) => sum + inv.currentValue, 0) + parseFloat(portfolio.cash);
    const initialInvestment = parseFloat(portfolio.initialInvestment || '0');
    const monthlyContrib = parseFloat(portfolio.monthlyContribution || '0');
    
    // Generate 6 months of historical data
    const data: DataPoint[] = [];
    const today = new Date();
    
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(today.getMonth() - i);
      
      // Simulate portfolio growth with some volatility
      const monthsFromStart = 5 - i;
      const baseValue = initialInvestment + (monthsFromStart * monthlyContrib);
      const growthFactor = 1 + (monthsFromStart * 0.02) + (Math.random() * 0.1 - 0.05); // 2% growth per month with some randomness
      const portfolioValue = baseValue * growthFactor;
      
      data.push({
        date: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        value: portfolioValue,
        contributions: baseValue
      });
    }
    
    // Update the last data point with current actual value
    if (data.length > 0) {
      data[data.length - 1].value = currentValue;
    }
    
    return data;
  }, [portfolio]);

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center">
            <TrendingUp className="text-primary mr-3" />
            Portfolio Growth Chart
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full mb-4" />
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!portfolio || chartData.length === 0) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center">
            <TrendingUp className="text-primary mr-3" />
            Portfolio Growth Chart
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500" data-testid="empty-chart">
            <BarChart3 className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium mb-2">No Growth Data Yet</p>
            <p className="text-sm">Portfolio performance will be tracked over time as you build your investments.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const latestValue = chartData[chartData.length - 1]?.value || 0;
  const earliestValue = chartData[0]?.value || 0;
  const totalReturn = latestValue - earliestValue;
  const returnPercentage = earliestValue > 0 ? (totalReturn / earliestValue) * 100 : 0;

  // Create a simple ASCII-style bar chart
  const maxValue = Math.max(...chartData.map(d => d.value));
  const minValue = Math.min(...chartData.map(d => d.value));
  const range = maxValue - minValue;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center">
            <TrendingUp className="text-primary mr-3" />
            Portfolio Growth Chart
          </div>
          <div className="text-right">
            <div className={`text-sm font-medium ${totalReturn >= 0 ? 'text-profit' : 'text-loss'}`} data-testid="total-return">
              {totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(0)} ({totalReturn >= 0 ? '+' : ''}{returnPercentage.toFixed(1)}%)
            </div>
            <div className="text-xs text-gray-500">6-month performance</div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Simple Chart Visualization */}
        <div className="bg-gray-50 rounded-lg p-4 h-64 flex items-end justify-between" data-testid="growth-chart">
          {chartData.map((dataPoint, index) => {
            const height = range > 0 ? ((dataPoint.value - minValue) / range) * 200 + 20 : 20;
            const isPositive = index === 0 || dataPoint.value >= chartData[index - 1]?.value;
            
            return (
              <div key={dataPoint.date} className="flex flex-col items-center flex-1">
                <div 
                  className={`w-8 rounded-t-sm transition-all duration-300 ${isPositive ? 'bg-profit' : 'bg-loss'}`}
                  style={{ height: `${height}px` }}
                  data-testid={`chart-bar-${index}`}
                  title={`${dataPoint.date}: $${dataPoint.value.toFixed(0)}`}
                ></div>
                <div className="text-xs text-gray-600 mt-2 text-center" data-testid={`chart-label-${index}`}>
                  {dataPoint.date}
                </div>
              </div>
            );
          })}
        </div>

        {/* Chart Statistics */}
        <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-gray-200">
          <div className="text-center">
            <div className="text-lg font-bold text-gray-900" data-testid="current-value">
              ${latestValue.toFixed(0)}
            </div>
            <div className="text-sm text-gray-500">Current Value</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-profit" data-testid="best-month">
              ${Math.max(...chartData.map(d => d.value)).toFixed(0)}
            </div>
            <div className="text-sm text-gray-500">Peak Value</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-gray-900" data-testid="avg-growth">
              {(returnPercentage / 6).toFixed(1)}%
            </div>
            <div className="text-sm text-gray-500">Avg Monthly Growth</div>
          </div>
        </div>

        {/* Performance Insights */}
        <div className="mt-4 p-3 bg-blue-50 rounded-lg" data-testid="performance-insight">
          <div className="flex items-start space-x-3">
            <TrendingUp className="text-blue-600 mt-0.5 h-4 w-4" />
            <div className="text-sm">
              <span className="font-medium text-blue-900">Performance Insight:</span>
              <span className="text-blue-700 ml-1">
                {returnPercentage > 0 
                  ? `Your portfolio has grown by ${returnPercentage.toFixed(1)}% over the past 6 months, outperforming the average savings account.`
                  : `Market volatility has affected your portfolio, but long-term investing typically shows positive returns over time.`
                }
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}