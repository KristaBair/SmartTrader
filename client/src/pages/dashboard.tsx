import { useState, useEffect, useMemo } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  getPortfolio, savePortfolio, getOnboarding, clearAll,
  getRecommendations, saveRecommendations, toPortfolioView, type SavedPortfolio
} from "@/lib/userData";
import { useUser } from "@/context/UserContext";
import PortfolioInput from "@/components/portfolio-input";
import AIRecommendations from "@/components/ai-recommendations";
import MarketTrends from "@/components/market-trends";
import PortfolioOverview from "@/components/portfolio-overview";
import { useToast } from "@/hooks/use-toast";
import { BarChart2, Trash2, DollarSign, Brain, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import type { Recommendation } from "@shared/schema";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { user } = useUser();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
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
    }
  };

  // Wipes this user's portfolio and recommendations, then sends them back through setup
  const handleReset = () => {
    clearAll();
    navigate("/onboarding");
  };

  return (
    <div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Investments</h1>
              <p className="text-sm text-slate-500">
                Research tools and holdings you enter by hand. Linked accounts are on My Finances.
                {onboarding?.savingsAmount ? ` Starting savings you entered: $${onboarding.savingsAmount.toLocaleString()}.` : ""}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="text-red-600 hover:text-red-700"
              title="Clear manual holdings, onboarding answers, and recommendations"
            >
              <Trash2 className="h-4 w-4 mr-1" /> Reset investment profile
            </Button>
          </div>

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
              <p className="text-sm text-blue-800">Financial news with AI-summarized market events. Research only, not trade instructions.</p>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-4">
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
