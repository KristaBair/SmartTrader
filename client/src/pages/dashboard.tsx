import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { isUnauthorizedError } from "@/lib/authUtils";
import PortfolioInput from "@/components/portfolio-input";
import AIRecommendations from "@/components/ai-recommendations";
import MarketTrends from "@/components/market-trends";
import PortfolioOverview from "@/components/portfolio-overview";
import TransactionHistory from "@/components/transaction-history";
import PortfolioGrowthChart from "@/components/portfolio-growth-chart";
import { useToast } from "@/hooks/use-toast";
import { Bell, RefreshCw, LogOut, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Portfolio, Recommendation } from "@shared/schema";

export default function Dashboard() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  // Fetch user portfolio
  const { data: portfolio, isLoading: portfolioLoading } = useQuery<Portfolio>({
    queryKey: ["/api/portfolios/user", user?.id],
    retry: false,
    enabled: !!user?.id,
  });

  // Fetch recommendations if portfolio exists
  const { data: recommendations = [], isLoading: recommendationsLoading } = useQuery<Recommendation[]>({
    queryKey: ["/api/portfolios", portfolio?.id, "recommendations"],
    enabled: !!portfolio?.id,
  });

  // Analyze portfolio mutation
  const analyzePortfolioMutation = useMutation({
    mutationFn: async (portfolioId: string) => {
      const response = await apiRequest("POST", `/api/portfolios/${portfolioId}/analyze`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      toast({
        title: "Analysis Complete",
        description: "Your portfolio has been analyzed successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze portfolio. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Auto-refresh functionality
  const refreshData = async (showToast = false) => {
    try {
      setIsAutoRefreshing(true);
      
      // Refresh all data
      await queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/market-data"] });
      
      setLastRefresh(new Date());
      
      if (showToast) {
        toast({
          title: "Data Refreshed",
          description: "Portfolio and market data have been updated.",
        });
      }
    } catch (error) {
      if (showToast) {
        toast({
          title: "Refresh Failed",
          description: "Unable to refresh data. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setIsAutoRefreshing(false);
    }
  };

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshData();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(intervalId);
  }, [queryClient]);

  const handlePortfolioSubmit = async (portfolioData: any) => {
    try {
      setIsAnalyzing(true);
      
      // Create or update portfolio
      const response = await apiRequest("POST", "/api/portfolios", portfolioData);
      const newPortfolio = await response.json();
      
      // Invalidate and refetch portfolio data
      await queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      
      // Analyze the portfolio
      await analyzePortfolioMutation.mutateAsync(newPortfolio.id);
      
      // Force refresh after trade
      refreshData();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to submit portfolio",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <i className="fas fa-chart-line text-white text-sm"></i>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">SmartTrader</h1>
            </div>
            <div className="flex items-center space-x-4">
              {/* Auto-refresh status */}
              <div className="flex items-center space-x-2 text-sm text-gray-500">
                <RefreshCw className={`h-4 w-4 ${isAutoRefreshing ? 'animate-spin' : ''}`} />
                <span data-testid="text-last-refresh">
                  Last updated: {lastRefresh.toLocaleTimeString()}
                </span>
              </div>
              
              {/* Manual refresh button */}
              <button 
                onClick={() => refreshData(true)}
                disabled={isAutoRefreshing}
                className="text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
                data-testid="button-refresh"
                title="Refresh data now"
              >
                <RefreshCw className={`h-5 w-5 ${isAutoRefreshing ? 'animate-spin' : ''}`} />
              </button>
              
              <button 
                className="text-gray-600 hover:text-gray-900 transition-colors"
                data-testid="button-notifications"
              >
                <Bell className="h-5 w-5" />
              </button>
              
              {/* User Profile & Logout */}
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <img 
                    src={user?.profileImageUrl || undefined} 
                    alt="Profile"
                    className="w-8 h-8 rounded-full object-cover"
                    data-testid="img-avatar"
                  />
                  <span className="text-sm text-gray-700 hidden sm:block" data-testid="text-username">
                    {user?.firstName || user?.email || "User"}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.location.href = "/api/logout"}
                  className="text-gray-600 hover:text-gray-900"
                  data-testid="button-logout"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2" data-testid="text-welcome">
            Welcome back, <span className="text-primary">{user?.firstName || user?.email || "Trader"}</span>
          </h2>
          <p className="text-gray-600" data-testid="text-subtitle">
            Let's optimize your investment strategy with AI-powered insights
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Portfolio Input */}
          <div className="lg:col-span-1">
            <PortfolioInput 
              onSubmit={handlePortfolioSubmit}
              isLoading={isAnalyzing}
              portfolio={portfolio}
            />
          </div>

          {/* Main Content */}
          <div className="lg:col-span-2">
            <AIRecommendations 
              recommendations={recommendations}
              isLoading={recommendationsLoading || isAnalyzing}
            />
            
            <MarketTrends />
            
            <PortfolioGrowthChart 
              portfolio={portfolio}
              isLoading={portfolioLoading}
            />
            
            <PortfolioOverview 
              portfolio={portfolio}
              isLoading={portfolioLoading}
            />
            
            <TransactionHistory 
              portfolioId={portfolio?.id}
              userId={user?.id}
            />
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-4" data-testid="disclaimer-section">
          <div className="flex items-start space-x-3">
            <i className="fas fa-exclamation-triangle text-yellow-600 mt-0.5"></i>
            <div className="text-sm text-yellow-800">
              <p className="font-medium mb-1">Investment Disclaimer</p>
              <p>
                The recommendations provided by SmartTrader AI are for informational purposes only and should not be considered as financial advice. 
                Past performance does not guarantee future results. Please consult with a qualified financial advisor before making investment decisions. 
                All investments carry risk and you may lose money.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Loading Overlay */}
      {isAnalyzing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" data-testid="loading-overlay">
          <div className="bg-white rounded-lg p-8 max-w-sm mx-4">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2" data-testid="text-loading-title">
                Analyzing Your Portfolio
              </h3>
              <p className="text-gray-600" data-testid="text-loading-description">
                Our AI is processing market data and generating personalized recommendations...
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
