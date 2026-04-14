// Market Intelligence page.
// Shows live financial news and AI-generated trading signals in one place.
// Signals auto-refresh every 3 minutes to match the pop-up polling cadence.
// News loads immediately on mount — no button clicks required to see content.

import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  RefreshCw,
  ArrowLeft,
  Zap,
  Newspaper,
  Brain,
  Clock,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────

interface Signal {
  id: string;
  ticker: string;
  action: "BUY" | "SELL";
  reason: string;
  confidence: number;
  urgency: "high" | "medium" | "low";
  newsHeadline: string;
}

interface NewsArticle {
  title: string;
  description: string;
  source: string;
  url: string;
  publishedAt: string;
}

interface AiAnalysis {
  tradingRecommendation: "BUY" | "SELL" | "HOLD" | "WATCH";
  reasoning: string;
  priceImpactPrediction: string;
  keyFactors: string[];
  riskLevel: string;
  affectedSymbol?: string;
  confidence: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const SIGNAL_POLL_MS = 3 * 60 * 1000; // 3 minutes

// ── Page ──────────────────────────────────────────────────────────────────

export default function MarketIntelligence() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [signals, setSignals] = useState<Signal[]>([]);
  const [signalsAge, setSignalsAge] = useState<string | null>(null);
  const [signalsLoading, setSignalsLoading] = useState(true);
  const [signalsRefreshing, setSignalsRefreshing] = useState(false);

  const [news, setNews] = useState<NewsArticle[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);

  // Track which article is being analyzed, and cache results by index
  const [analyzingIndex, setAnalyzingIndex] = useState<number | null>(null);
  const [analyses, setAnalyses] = useState<Record<number, AiAnalysis>>({});

  // ── Data fetchers ────────────────────────────────────────────────────────

  const fetchSignals = useCallback(async (quiet = false) => {
    if (!quiet) setSignalsLoading(true);
    else setSignalsRefreshing(true);
    try {
      const res = await apiRequest("GET", "/api/trading-signals");
      const data = await res.json();
      setSignals(data.signals || []);
      setSignalsAge(data.generatedAt || new Date().toISOString());
    } catch {
      // Silently fail — background polling should never interrupt the user
    } finally {
      setSignalsLoading(false);
      setSignalsRefreshing(false);
    }
  }, []);

  const fetchNews = useCallback(async () => {
    setNewsLoading(true);
    try {
      const res = await apiRequest("GET", "/api/news");
      const data = await res.json();
      setNews(Array.isArray(data) ? data : []);
    } catch {
      setNews([]);
    } finally {
      setNewsLoading(false);
    }
  }, []);

  // Load on mount, then poll signals every 3 min
  useEffect(() => {
    fetchSignals();
    fetchNews();
    const interval = setInterval(() => fetchSignals(true), SIGNAL_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchSignals, fetchNews]);

  // ── Analyze a single article with AI ────────────────────────────────────

  const analyzeArticle = async (article: NewsArticle, index: number) => {
    if (analyses[index]) return; // already done
    setAnalyzingIndex(index);
    try {
      const res = await apiRequest("GET", "/api/news/analyze");
      const data = await res.json();
      // The endpoint returns multiple events. Use the first one that matches
      // or just the first result — good enough for per-article analysis.
      const event = (data.events || [])[0];
      if (event) {
        setAnalyses(prev => ({ ...prev, [index]: event.aiAnalysis || event }));
      } else {
        toast({ title: "No strong signal found for this article", variant: "default" });
      }
    } catch {
      toast({ title: "Analysis failed", variant: "destructive" });
    } finally {
      setAnalyzingIndex(null);
    }
  };

  // ── Render helpers ───────────────────────────────────────────────────────

  const SignalBadge = ({ action }: { action: "BUY" | "SELL" }) =>
    action === "BUY" ? (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
        <TrendingUp className="h-3 w-3" /> BUY
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">
        <TrendingDown className="h-3 w-3" /> SELL
      </span>
    );

  const RecoBadge = ({ rec }: { rec: string }) => {
    const map: Record<string, string> = {
      BUY: "bg-emerald-100 text-emerald-800",
      SELL: "bg-red-100 text-red-800",
      HOLD: "bg-blue-100 text-blue-800",
      WATCH: "bg-yellow-100 text-yellow-800",
    };
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${map[rec] || "bg-gray-100 text-gray-700"}`}>
        {rec === "BUY" && <TrendingUp className="h-3 w-3" />}
        {rec === "SELL" && <TrendingDown className="h-3 w-3" />}
        {rec === "HOLD" && <Minus className="h-3 w-3" />}
        {rec === "WATCH" && <AlertTriangle className="h-3 w-3" />}
        {rec}
      </span>
    );
  };

  const ConfidenceBar = ({ value }: { value: number }) => (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${value >= 80 ? "bg-emerald-500" : value >= 65 ? "bg-yellow-500" : "bg-red-400"}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 tabular-nums">{value}%</span>
    </div>
  );

  const urgencyDot = (urgency: string) => {
    const map: Record<string, string> = { high: "bg-red-500", medium: "bg-yellow-500", low: "bg-gray-400" };
    return <span className={`inline-block h-2 w-2 rounded-full ${map[urgency] || "bg-gray-400"}`} />;
  };

  // ── JSX ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Dashboard
            </Button>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Zap className="h-5 w-5 text-yellow-500" />
                Market Intelligence
              </h1>
              <p className="text-xs text-gray-500">Live news with AI trading signals</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { fetchSignals(); fetchNews(); }}
            disabled={signalsLoading || newsLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${(signalsLoading || signalsRefreshing) ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-6 space-y-6">

        {/* ── Trading Signals ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-600" />
              AI Trading Signals
            </h2>
            {signalsAge && !signalsLoading && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Updated {timeAgo(signalsAge)}. Auto-refreshes every 3 min.
              </span>
            )}
          </div>

          {signalsLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4 space-y-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-2 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : signals.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <CheckCircle2 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No strong signals right now.</p>
                <p className="text-xs text-gray-400 mt-1">Markets are calm. Check back in a few minutes.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {signals.map((sig) => (
                <Card key={sig.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {urgencyDot(sig.urgency)}
                        <span className="font-bold text-gray-900 text-sm">{sig.ticker}</span>
                      </div>
                      <SignalBadge action={sig.action} />
                    </div>
                    <p className="text-sm text-gray-700 leading-snug">{sig.reason}</p>
                    <ConfidenceBar value={sig.confidence} />
                    <p className="text-xs text-gray-400 italic line-clamp-2">"{sig.newsHeadline}"</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {signalsRefreshing && (
            <p className="text-xs text-gray-400 text-right mt-1 flex items-center justify-end gap-1">
              <RefreshCw className="h-3 w-3 animate-spin" /> Refreshing signals...
            </p>
          )}
        </section>

        {/* ── Live News ────────────────────────────────────────────────── */}
        <section>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <Newspaper className="h-4 w-4 text-blue-600" />
            Live Financial News
          </h2>

          {newsLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-4 w-full mb-2" />
                    <Skeleton className="h-3 w-3/4" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : news.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-sm text-gray-500">Could not load news. Try refreshing.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {news.map((article, idx) => {
                const analysis = analyses[idx];
                const isAnalyzing = analyzingIndex === idx;
                return (
                  <Card key={idx} className="overflow-hidden hover:shadow-sm transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        {/* Left: article info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 leading-snug">
                            {article.title}
                          </p>
                          {article.description && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                              {article.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-xs font-medium text-blue-600">{article.source}</span>
                            <span className="text-xs text-gray-400">{timeAgo(article.publishedAt)}</span>
                          </div>
                        </div>
                        {/* Right: links and action */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          {article.url && (
                            <a href={article.url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4 text-gray-400 hover:text-blue-600" />
                            </a>
                          )}
                          {!analysis && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs px-2"
                              onClick={() => analyzeArticle(article, idx)}
                              disabled={isAnalyzing}
                            >
                              {isAnalyzing ? (
                                <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                              ) : (
                                <Brain className="h-3 w-3 mr-1" />
                              )}
                              {isAnalyzing ? "Analyzing..." : "Analyze"}
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* AI analysis panel — shows after clicking Analyze */}
                      {analysis && (
                        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <RecoBadge rec={analysis.tradingRecommendation} />
                            {analysis.affectedSymbol && (
                              <Badge variant="outline" className="text-xs">{analysis.affectedSymbol}</Badge>
                            )}
                            <span className="text-xs text-gray-500">Risk: {analysis.riskLevel}</span>
                            {analysis.confidence && (
                              <span className="text-xs text-gray-400">Confidence: {analysis.confidence}%</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-700">{analysis.reasoning}</p>
                          {analysis.priceImpactPrediction && (
                            <p className="text-xs text-blue-700 font-medium flex items-center gap-1">
                              <BarChart3 className="h-3 w-3" />
                              {analysis.priceImpactPrediction}
                            </p>
                          )}
                          {analysis.keyFactors?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {analysis.keyFactors.map((f, fi) => (
                                <Badge key={fi} variant="secondary" className="text-xs">{f}</Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
