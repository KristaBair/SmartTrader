import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Search, TrendingDown, TrendingUp, Newspaper, Brain, Lightbulb, Eye, Loader2, AlertTriangle
} from "lucide-react";

interface NewsItem {
  title: string;
  source: string;
  publishedAt: string;
}

interface StockEvent {
  date: string;
  type: "DIP" | "PEAK";
  magnitude: number;
  price: number;
  priceChange: number;
  news: NewsItem[];
}

interface Pattern {
  name: string;
  description: string;
  occurrences: number;
  reliability: string;
  tradingImplication: string;
}

interface PatternAnalysis {
  ticker: string;
  patternSummary: string;
  patterns: Pattern[];
  keyInsights: string[];
  whatToWatchFor: string;
}

interface PatternResult {
  ticker: string;
  companyName: string;
  currentPrice?: number;
  priceChange?: number;
  priceHistory: { date: string; close: number }[];
  events: StockEvent[];
  analysis: PatternAnalysis;
}

const reliabilityColors: Record<string, string> = {
  High: "bg-green-100 text-green-800",
  Medium: "bg-yellow-100 text-yellow-800",
  Low: "bg-red-100 text-red-800",
};

const popularTickers = ["AAPL", "TSLA", "NVDA", "MSFT", "GOOGL", "AMZN", "META", "SPY"];

export default function Patterns() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Pre-fill ticker from URL param: /patterns?ticker=AAPL (used by trading alerts)
  const urlTicker = new URLSearchParams(window.location.search).get("ticker") || "";
  const [ticker, setTicker] = useState(urlTicker.toUpperCase());
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<PatternResult | null>(null);

  const analyze = async (symbol: string) => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      toast({ title: "Enter a ticker symbol", variant: "destructive" });
      return;
    }
    try {
      setIsLoading(true);
      setResult(null);
      const response = await apiRequest("POST", "/api/patterns/analyze", { ticker: sym });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Analysis failed");
      }
      const data = await response.json();
      setResult(data);
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message || "Try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-analyze if a ticker was passed in the URL via ?ticker=AAPL
  useEffect(() => {
    if (urlTicker) {
      analyze(urlTicker.toUpperCase());
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    analyze(ticker);
  };

  // Simple sparkline component
  const Sparkline = ({ data }: { data: { date: string; close: number }[] }) => {
    if (data.length < 2) return null;
    const prices = data.map((d) => d.close);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const w = 400;
    const h = 80;
    const pts = data.map((d, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((d.close - min) / range) * h;
      return `${x},${y}`;
    });
    const isUp = prices[prices.length - 1] >= prices[0];
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke={isUp ? "#16a34a" : "#dc2626"}
          strokeWidth="2"
        />
      </svg>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate("/investments")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Investments
              </Button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
                  <Brain className="text-white h-4 w-4" />
                </div>
                <h1 className="text-xl font-bold text-gray-900">Pattern Analyzer</h1>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Search */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-t-lg">
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Stock Pattern & News Correlation Analyzer
            </CardTitle>
            <p className="text-purple-100 text-sm">
              Enter any stock ticker. The AI finds major dips and peaks, cross-references with news at the time, and identifies repeating patterns.
            </p>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Enter ticker symbol (e.g. AAPL, TSLA, NVDA)"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  className="pl-9 text-lg font-mono uppercase"
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading || !ticker}
                className="bg-purple-600 hover:bg-purple-700 text-white px-6"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Analyze"}
              </Button>
            </form>

            {/* Quick picks */}
            <div className="mt-4">
              <p className="text-xs text-gray-500 mb-2">Popular stocks:</p>
              <div className="flex flex-wrap gap-2">
                {popularTickers.map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTicker(t); analyze(t); }}
                    disabled={isLoading}
                    className="px-3 py-1 rounded-full text-xs font-mono font-semibold bg-gray-100 hover:bg-purple-100 hover:text-purple-700 transition-colors disabled:opacity-50"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Loading state */}
        {isLoading && (
          <Card className="border-0 shadow-md">
            <CardContent className="p-12 text-center">
              <Loader2 className="h-10 w-10 animate-spin mx-auto mb-4 text-purple-600" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Analyzing patterns...</h3>
              <p className="text-gray-500 text-sm">Fetching price history, cross-referencing news, and running AI analysis. This takes about 15-30 seconds.</p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            {/* Stock overview */}
            <Card className="border-0 shadow-md">
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-3xl font-bold text-gray-900">{result.ticker}</h2>
                      {result.currentPrice && (
                        <span className="text-2xl font-semibold text-gray-700">
                          ${result.currentPrice.toFixed(2)}
                        </span>
                      )}
                      {result.priceChange !== undefined && (
                        <Badge className={result.priceChange >= 0 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                          {result.priceChange >= 0 ? "▲" : "▼"} {Math.abs(result.priceChange).toFixed(2)}% today
                        </Badge>
                      )}
                    </div>
                    <p className="text-gray-500 mt-1">{result.companyName} · Last 100 trading days</p>
                  </div>
                  <div className="text-right text-sm text-gray-500">
                    <p>{result.events.length} major events found</p>
                    <p>{result.analysis.patterns.length} patterns identified</p>
                  </div>
                </div>

                {/* Sparkline chart */}
                {result.priceHistory.length > 0 && (
                  <div className="bg-gray-50 rounded-lg p-3 border">
                    <Sparkline data={result.priceHistory} />
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                      <span>{result.priceHistory[0]?.date}</span>
                      <span>{result.priceHistory[result.priceHistory.length - 1]?.date}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* AI Pattern Summary */}
            <Card className="border-0 shadow-md border-l-4 border-l-purple-500">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-purple-700">
                  <Brain className="h-5 w-5" />
                  AI Pattern Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                <p className="text-gray-800">{result.analysis.patternSummary}</p>

                {/* Patterns grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  {result.analysis.patterns.map((p, i) => (
                    <div key={i} className="bg-gray-50 rounded-lg p-4 border">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-gray-900">{p.name}</h4>
                        <div className="flex gap-2">
                          <Badge className={reliabilityColors[p.reliability] || "bg-gray-100 text-gray-700"}>
                            {p.reliability} reliability
                          </Badge>
                          <Badge variant="outline">{p.occurrences}x seen</Badge>
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 mb-2">{p.description}</p>
                      <div className="bg-blue-50 rounded p-2 text-xs text-blue-800">
                        <strong>What to do:</strong> {p.tradingImplication}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Key insights */}
                <div className="mt-4">
                  <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-yellow-500" />
                    Key Insights
                  </h4>
                  <ul className="space-y-2">
                    {result.analysis.keyInsights.map((insight, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        {insight}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* What to watch */}
                <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-200">
                  <h4 className="font-semibold text-indigo-900 mb-1 flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    What to Watch For
                  </h4>
                  <p className="text-sm text-indigo-800">{result.analysis.whatToWatchFor}</p>
                </div>
              </CardContent>
            </Card>

            {/* Major events */}
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Newspaper className="h-5 w-5 text-gray-600" />
                Major Events & News Correlation
              </h2>
              <div className="space-y-4">
                {result.events.map((event, i) => (
                  <Card key={i} className={`border-0 shadow-sm border-l-4 ${event.type === "DIP" ? "border-l-red-500" : "border-l-green-500"}`}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          {event.type === "DIP" ? (
                            <TrendingDown className="h-5 w-5 text-red-500" />
                          ) : (
                            <TrendingUp className="h-5 w-5 text-green-500" />
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge className={event.type === "DIP" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}>
                                {event.type === "DIP" ? "▼ DIP" : "▲ PEAK"}
                              </Badge>
                              <span className="font-bold text-lg">
                                {event.type === "DIP" ? "-" : "+"}{event.magnitude.toFixed(1)}%
                              </span>
                            </div>
                            <p className="text-sm text-gray-500">{event.date} · Price: ${event.price.toFixed(2)}</p>
                          </div>
                        </div>
                      </div>

                      {/* News from that period */}
                      {event.news.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">News from that period:</p>
                          {event.news.map((n, j) => (
                            <div key={j} className="bg-gray-50 rounded p-3 border-l-2 border-gray-200">
                              <p className="text-sm font-medium text-gray-900 leading-snug">{n.title}</p>
                              <p className="text-xs text-gray-400 mt-1">
                                {n.source} · {new Date(n.publishedAt).toLocaleDateString()}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400 italic">No major news found for this event window.</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Disclaimer */}
            <Card className="border-yellow-200 bg-yellow-50">
              <CardContent className="p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
                  <p className="text-xs text-yellow-800">
                    Pattern analysis is for educational purposes only. Past patterns do not guarantee future results.
                    Always do your own research and consult a financial advisor before investing.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
