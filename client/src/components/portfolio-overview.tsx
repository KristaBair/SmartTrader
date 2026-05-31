import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet } from "lucide-react";
import type { PortfolioView } from "@/lib/localStore";

interface PortfolioOverviewProps {
  portfolio?: PortfolioView;
  isLoading: boolean;
}

export default function PortfolioOverview({ portfolio, isLoading }: PortfolioOverviewProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Wallet className="text-accent mr-3" />
            Portfolio Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex justify-between items-center">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-6 w-20" />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <Skeleton className="h-4 w-32 mb-4" />
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Skeleton className="w-3 h-3 rounded-full" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                    <Skeleton className="h-3 w-8" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!portfolio) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Wallet className="text-accent mr-3" />
            Portfolio Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500" data-testid="empty-portfolio">
            <Wallet className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium mb-2">No Portfolio Data</p>
            <p className="text-sm">Add your portfolio details to see an overview of your investments.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate portfolio metrics
  const totalInvestmentValue = portfolio.investments.reduce((sum, inv) => sum + inv.currentValue, 0);
  const cash = parseFloat(portfolio.cash);
  const totalPortfolioValue = totalInvestmentValue + cash;
  const initialInvestment = parseFloat(portfolio.initialInvestment || '0');
  const monthlyContribution = parseFloat(portfolio.monthlyContribution || '0');
  const totalContributions = parseFloat(portfolio.totalContributions || '0');
  
  // Mock calculations for gain/loss (in a real app, this would be calculated based on purchase prices)
  const mockInitialValue = totalInvestmentValue * 0.9; // Assume 10% gain for demo
  const totalGainLoss = totalInvestmentValue - mockInitialValue;
  const gainLossPercentage = mockInitialValue > 0 ? (totalGainLoss / mockInitialValue) * 100 : 0;

  // Calculate asset allocation
  const stocksValue = portfolio.investments
    .filter(inv => !inv.symbol.includes('ETF') && !inv.symbol.includes('BTC'))
    .reduce((sum, inv) => sum + inv.currentValue, 0);
  
  const etfsValue = portfolio.investments
    .filter(inv => inv.symbol.includes('ETF') || inv.name.toLowerCase().includes('etf'))
    .reduce((sum, inv) => sum + inv.currentValue, 0);
  
  const cryptoValue = portfolio.investments
    .filter(inv => inv.symbol.includes('BTC') || inv.name.toLowerCase().includes('bitcoin'))
    .reduce((sum, inv) => sum + inv.currentValue, 0);

  const allocations = [
    { name: "Stocks", value: stocksValue, color: "bg-blue-500", percentage: ((stocksValue / totalInvestmentValue) * 100).toFixed(0) },
    { name: "ETFs", value: etfsValue, color: "bg-green-500", percentage: ((etfsValue / totalInvestmentValue) * 100).toFixed(0) },
    { name: "Crypto", value: cryptoValue, color: "bg-orange-500", percentage: ((cryptoValue / totalInvestmentValue) * 100).toFixed(0) },
  ].filter(allocation => allocation.value > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Wallet className="text-accent mr-3" />
          Portfolio Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Portfolio Summary */}
          <div>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-gray-50 rounded-lg" data-testid="total-portfolio-value">
                <span className="text-gray-600">Total Portfolio Value</span>
                <span className="text-2xl font-bold text-gray-900 font-mono">
                  ${totalPortfolioValue.toLocaleString()}
                </span>
              </div>
              
              <div className="flex justify-between items-center p-4 bg-green-50 rounded-lg" data-testid="total-gain-loss">
                <span className="text-green-700">Total Gain/Loss</span>
                <span className={`text-lg font-semibold font-mono ${totalGainLoss >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {totalGainLoss >= 0 ? '+' : ''}${totalGainLoss.toFixed(0)} ({totalGainLoss >= 0 ? '+' : ''}{gainLossPercentage.toFixed(1)}%)
                </span>
              </div>
              
              <div className="flex justify-between items-center p-4 bg-blue-50 rounded-lg" data-testid="available-cash">
                <span className="text-blue-700">Available Cash</span>
                <span className="text-lg font-semibold text-blue-900 font-mono">
                  ${cash.toLocaleString()}
                </span>
              </div>
              
              {initialInvestment > 0 && (
                <div className="flex justify-between items-center p-4 bg-purple-50 rounded-lg" data-testid="initial-investment">
                  <span className="text-purple-700">Initial Investment</span>
                  <span className="text-lg font-semibold text-purple-900 font-mono">
                    ${initialInvestment.toLocaleString()}
                  </span>
                </div>
              )}
              
              {monthlyContribution > 0 && (
                <div className="flex justify-between items-center p-4 bg-indigo-50 rounded-lg" data-testid="monthly-contribution">
                  <span className="text-indigo-700">Monthly Contribution</span>
                  <span className="text-lg font-semibold text-indigo-900 font-mono">
                    ${monthlyContribution.toLocaleString()}/month
                  </span>
                </div>
              )}
              
              {totalContributions > 0 && (
                <div className="flex justify-between items-center p-4 bg-teal-50 rounded-lg" data-testid="total-contributions">
                  <span className="text-teal-700">Total Contributions</span>
                  <span className="text-lg font-semibold text-teal-900 font-mono">
                    ${totalContributions.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Asset Allocation */}
          <div>
            <h4 className="font-medium text-gray-900 mb-4" data-testid="asset-allocation-title">Asset Allocation</h4>
            {allocations.length > 0 ? (
              <div className="space-y-3">
                {allocations.map((allocation) => (
                  <div key={allocation.name} className="flex items-center justify-between" data-testid={`allocation-${allocation.name.toLowerCase()}`}>
                    <div className="flex items-center space-x-3">
                      <div className={`w-3 h-3 rounded-full ${allocation.color}`}></div>
                      <span className="text-sm text-gray-700">{allocation.name}</span>
                    </div>
                    <span className="text-sm font-medium text-gray-900">{allocation.percentage}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No asset allocation data available</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
