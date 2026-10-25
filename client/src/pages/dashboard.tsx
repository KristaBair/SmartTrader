import { useState, useEffect, useMemo } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  getPortfolio, savePortfolio, getOnboarding, clearAll,
  getRecommendations, saveRecommendations, toPortfolioView, type SavedPortfolio
} from "@/lib/userData";
import { useUser } from "@/context/UserContext";
import PortfolioInput from "@/components/portfolio-input";
import PlaidAccountsPanel from "@/components/plaid-accounts";
import SpendingAnalysisPanel from "@/components/spending-analysis";
import AIRecommendations from "@/components/ai-recommendations";
import MarketTrends from "@/components/market-trends";
import PortfolioOverview from "@/components/portfolio-overview";
import { useToast } from "@/hooks/use-toast";
import { Bell, RefreshCw, TrendingUp, BarChart2, Trash2, DollarSign, Brain, FlaskConical, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import type { Recommendation } from "@shared/schema";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { user, signOut } = useUser();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  // Pre-load the saved portfolio so the form isn't blank on return visits
  const [portfolio, setPortfolio] = useState(getPortfolio());
  const { toast } = useToast();

  const onboarding = getOnboarding();

  // Memoize so unrelated re-renders don't hand the widgets a brand new object.
  const portfolioView = useMemo(() => toPortfolioView(portfolio), [portfolio]);

  // Restore cached recommendations so the user sees their last analysis right away
  // while they wait for a fresh one (or if they haven't run one yet today)
  useEffect(() => {
    const saved = getRecommendations();
    if (saved.length > 0) setRecommendations(saved);
  }, [user?.id]);

  // Called by the portfolio editor whenever the user changes anything.
  // The component already saved it. We just keep React state in sync.
  const handlePortfolioChange = (updated: SavedPortfolio) => {
    setPortfolio(updated);
  };

  // Called when the user clicks "Analyze with AI".
  // The portfolio has already been saved. We just run the analysis on it.
  const handleAnalyze = async (current: SavedPortfolio) => {
    try {
      setIsAnalyzing(true);

      const response = await apiRequest("POST", "/api/portfolios/analyze-direct", {
        cash: current.cash,
        investments: current.investments
          .map((i: any) => `${i.symbol}: $${i.averagePrice || 0}`)
          .join(", "),
        symbols: current.investments.map((i) => i.symbol),
        riskTolerance: current.riskTolerance,
        timeline: current.timeline,
      });
      const result = await response.json();

      if (result.recommendations) {
        setRecommendations(result.recommendations);
        saveRecommendations(result.recommendations);
      }

      // Linked-account problems don't block the analysis, but the user should know.
      const linkedDataNotices: string[] = Array.isArray(result.linkedDataNotices) ? result.linkedDataNotices : [];
      toast({
        title: "Analysis complete",
        description: linkedDataNotices.length > 0
          ? linkedDataNotices.join(" ")
          : "Your portfolio has been analyzed.",
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      const serverMessage = rawMessage.match(/"message"\s*:\s*"([^"]+)"/)?.[1];
      toast({
        title: "Analysis failed",
        description: serverMessage || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
      setLastRefresh(new Date());
    }
  };

  // Wipes this user's portfolio and recommendations, then sends them back through setup
  const handleReset = () => {
    clearAll();
    navigate("/onboarding");
  };

  // Signs out of Cognito and returns to the sign-in screen (the Router will render SignIn
  // automatically once user becomes null)
  const handleSignOut = () => {
    signOut().finally(() => navigate("/"));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <TrendingUp className="text-white h-4 w-4" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">InvestSmart</h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 text-sm text-gray-500">
                <RefreshCw className="h-4 w-4" />
                <span>Updated: {lastRefresh.toLocaleTimeString()}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/analytics")}
                className="text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50"
              >
                <FlaskConical className="h-4 w-4 mr-1" />
                Analytics
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/invest")}
                className="text-green-700 hover:text-green-900 hover:bg-green-50"
              >
                <DollarSign className="h-4 w-4 mr-1" />
                Invest Now
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/patterns")}
                className="text-purple-700 hover:text-purple-900 hover:bg-purple-50"
              >
                <Brain className="h-4 w-4 mr-1" />
                Patterns
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/market-intelligence")}
              >
                <BarChart2 className="h-4 w-4 mr-1" />
                Market Intel
              </Button>
              <button className="text-gray-600 hover:text-gray-900">
                <Bell className="h-5 w-5" />
              </button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="text-red-500 hover:text-red-700"
                title="Reset portfolio and start over"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              {/* User avatar + sign out */}
              {user && (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {user.firstName[0]}{user.lastName[0]}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSignOut}
                    className="text-gray-500 hover:text-gray-800"
                    title="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome back, {user ? user.firstName : "Trader"}
          </h2>
          <p className="text-gray-600 mb-6">
            {onboarding?.savingsAmount
              ? `Managing $${onboarding.savingsAmount.toLocaleString()} · AI-powered insights`
              : "Let's optimize your investment strategy with AI-powered insights"}
          </p>

          {/* Feature cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <button
              onClick={() => navigate("/invest")}
              className="text-left p-4 rounded-xl border-2 border-green-200 bg-green-50 hover:bg-green-100 hover:border-green-400 transition-all group"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                  <DollarSign className="text-white h-5 w-5" />
                </div>
                <h3 className="font-bold text-green-900">Smart Invest</h3>
              </div>
              <p className="text-sm text-green-800">Tell the AI how much you have, get a specific allocation plan instantly.</p>
            </button>

            <button
              onClick={() => navigate("/patterns")}
              className="text-left p-4 rounded-xl border-2 border-purple-200 bg-purple-50 hover:bg-purple-100 hover:border-purple-400 transition-all group"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-purple-600 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Brain className="text-white h-5 w-5" />
                </div>
                <h3 className="font-bold text-purple-900">Pattern Analyzer</h3>
              </div>
              <p className="text-sm text-purple-800">Look up any stock, see major dips/peaks, the news at the time, and AI-identified patterns.</p>
            </button>

            <button
              onClick={() => navigate("/analytics")}
              className="text-left p-4 rounded-xl border-2 border-indigo-200 bg-indigo-50 hover:bg-indigo-100 hover:border-indigo-400 transition-all group"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-indigo-700 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                  <FlaskConical className="text-white h-5 w-5" />
                </div>
                <h3 className="font-bold text-indigo-900">Analytics Lab</h3>
              </div>
              <p className="text-sm text-indigo-800">Monte Carlo simulation, VaR, Sharpe ratios, and scored recommendations. All real math.</p>
            </button>

            <button
              onClick={() => navigate("/market-intelligence")}
              className="text-left p-4 rounded-xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-400 transition-all group"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                  <BarChart2 className="text-white h-5 w-5" />
                </div>
                <h3 className="font-bold text-blue-900">Market Intel</h3>
              </div>
              <p className="text-sm text-blue-800">Live financial news with AI trading signals and market event tracking.</p>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-4">
            <PlaidAccountsPanel />
            <SpendingAnalysisPanel />
            <PortfolioInput
              portfolio={portfolio as SavedPortfolio}
              onPortfolioChange={handlePortfolioChange}
              onAnalyze={handleAnalyze}
              isAnalyzing={isAnalyzing}
            />
          </div>

          <div className="lg:col-span-2">
            <AIRecommendations
              recommendations={recommendations}
              isLoading={isAnalyzing}
            />
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <PortfolioOverview portfolio={portfolioView} isLoading={false} />
          <MarketTrends />
        </div>
      </div>
    </div>
  );
}
