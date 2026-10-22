/**
 * analytics.tsx - InvestSmart Quantitative Analytics Dashboard
 *
 * Displays real statistical analysis: Monte Carlo simulation, VaR,
 * risk/return scatter, composite recommendation scores, and allocation targets.
 *
 * All numbers shown come from actual calculations described in the Methodology tab -
 * nothing is made up or hardcoded.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { getPortfolio } from "@/lib/userData";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AreaChart, Area, ScatterChart, Scatter, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ReferenceLine, Cell
} from "recharts";
import {
  ArrowLeft, FlaskConical, TrendingUp, TrendingDown, AlertTriangle,
  Info, Loader2, Plus, Trash2, BookOpen, ShieldAlert, Target
} from "lucide-react";

// -- Types --

interface Holding { symbol: string; shares: number }
interface HoldingStats {
  symbol: string; currentPrice: number; currentValue: number; weight: number;
  annualizedReturn: number; annualizedVolatility: number; sharpeRatio: number;
  momentum20d: number; momentum60d: number;
}
interface MonteCarloTimestep { month: number; p5: number; p25: number; p50: number; p75: number; p95: number }
interface MonteCarloResult {
  timeHorizonYears: number; numSimulations: number; initialValue: number;
  timeSeries: MonteCarloTimestep[];
  finalOutcomes: { p5: number; p25: number; p50: number; p75: number; p95: number };
  probabilityOfLoss: number;
}
interface RecommendationScore {
  symbol: string; currentWeight: number; totalScore: number;
  components: { momentum: number; volatility: number; concentration: number; diversification: number; cash: number };
  action: "BUY_MORE" | "HOLD" | "REDUCE";
  confidenceLevel: "Low" | "Medium" | "High";
  reasoning: string; riskNote: string;
}
interface QuantReport {
  portfolioValue: number; cashAmount: number; cashWeight: number;
  holdings: HoldingStats[];
  portfolioAnnualReturn: number; portfolioAnnualVol: number; portfolioSharpe: number;
  hhi: number; var95Daily: number; var95Pct: number; cvar95Daily: number;
  monteCarlo: MonteCarloResult;
  scores: RecommendationScore[];
  allocationTargets: { name: string; ticker: string; targetPct: number; currentPct: number; deviation: number }[];
  assumptions: { label: string; value: string }[];
  dataSources: { symbol: string; source: string; asOf: string; retrievedAt: string; freshness: string; observations: number }[];
  excludedHoldings: { symbol: string; reason: string }[];
}

// -- Helper formatters --────

const fmt = {
  dollar: (n: number) => `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
  pct: (n: number) => `${(n * 100).toFixed(1)}%`,
  pct2: (n: number) => `${n.toFixed(1)}%`,
  round: (n: number) => n.toFixed(2),
};

// Score action colors
const actionColors: Record<string, string> = {
  BUY_MORE: "bg-green-100 text-green-800 border-green-300",
  HOLD: "bg-blue-100 text-blue-800 border-blue-300",
  REDUCE: "bg-red-100 text-red-800 border-red-300",
};
const confidenceColors: Record<string, string> = {
  High: "bg-purple-100 text-purple-800",
  Medium: "bg-yellow-100 text-yellow-800",
  Low: "bg-gray-100 text-gray-700",
};
const scoreBarColor = (score: number) =>
  score >= 65 ? "#16a34a" : score >= 45 ? "#2563eb" : "#dc2626";

// -- Main component --

export default function Analytics() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Pre-populate holdings from the saved portfolio if the user has one
  const savedPortfolio = getPortfolio();
  const [holdings, setHoldings] = useState<Holding[]>(
    savedPortfolio?.investments?.map(inv => ({ symbol: inv.symbol, shares: inv.shares })) ?? [
      { symbol: "AAPL", shares: 10 },
      { symbol: "MSFT", shares: 5 },
      { symbol: "SPY", shares: 3 },
    ]
  );
  const [cash, setCash] = useState(String(savedPortfolio?.cash ?? 5000));
  const [riskTolerance, setRiskTolerance] = useState<"conservative" | "moderate" | "aggressive">(
    (savedPortfolio?.riskTolerance as any) ?? "moderate"
  );
  const [timeHorizon, setTimeHorizon] = useState("5");
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<QuantReport | null>(null);

  // -- Input management --

  const addHolding = () => setHoldings(h => [...h, { symbol: "", shares: 1 }]);
  const removeHolding = (i: number) => setHoldings(h => h.filter((_, idx) => idx !== i));
  const updateHolding = (i: number, field: keyof Holding, value: string) =>
    setHoldings(h => h.map((item, idx) =>
      idx === i ? { ...item, [field]: field === "shares" ? parseFloat(value) || 1 : value.toUpperCase() } : item
    ));

  // ── Run analysis ──────────────────────────────────────────────────────────

  const runAnalysis = async () => {
    const validHoldings = holdings.filter(h => h.symbol.trim().length > 0);
    if (validHoldings.length === 0) {
      toast({ title: "Add at least one holding", variant: "destructive" });
      return;
    }
    try {
      setIsLoading(true);
      setReport(null);
      const response = await apiRequest("POST", "/api/quant/analyze", {
        holdings: validHoldings,
        cash: parseFloat(cash) || 0,
        riskTolerance,
        timeHorizon: parseInt(timeHorizon),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Analysis failed");
      }
      setReport(await response.json());
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Sub-components ─────────────────────────────────────────────────────────

  // KPI card - used in summary tab
  const KpiCard = ({ label, value, sub, color = "text-gray-900", warning = false }: {
    label: string; value: string; sub?: string; color?: string; warning?: boolean
  }) => (
    <Card className={`border shadow-sm ${warning ? "border-red-200 bg-red-50" : ""}`}>
      <CardContent className="p-5">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
              </Button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-indigo-700 rounded-lg flex items-center justify-center">
                  <FlaskConical className="text-white h-4 w-4" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">Analytics Lab</h1>
                  <p className="text-xs text-gray-500">Quantitative portfolio analysis</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* ── Input Panel ─────────────────────────────────────────────────── */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-indigo-700 to-purple-700 text-white rounded-t-lg">
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Portfolio Setup
            </CardTitle>
            <p className="text-indigo-100 text-sm">
              Enter your holdings and parameters. All analysis uses real historical price data from Yahoo Finance.
            </p>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {/* Holdings table */}
            <div>
              <Label className="text-sm font-semibold mb-3 block">Holdings</Label>
              <div className="space-y-2">
                {holdings.map((h, i) => (
                  <div key={i} className="flex gap-3 items-center">
                    <Input
                      className="w-32 font-mono uppercase"
                      placeholder="TICKER"
                      value={h.symbol}
                      onChange={e => updateHolding(i, "symbol", e.target.value)}
                    />
                    <Input
                      className="w-24"
                      type="number"
                      min="0.01"
                      placeholder="Shares"
                      value={h.shares}
                      onChange={e => updateHolding(i, "shares", e.target.value)}
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeHolding(i)} className="text-gray-400 hover:text-red-500">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addHolding} className="mt-3">
                <Plus className="h-4 w-4 mr-1" /> Add Holding
              </Button>
            </div>

            {/* Parameters */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label className="text-sm font-semibold mb-1 block">Cash Balance ($)</Label>
                <Input value={cash} onChange={e => setCash(e.target.value)} placeholder="e.g. 5000" />
              </div>
              <div>
                <Label className="text-sm font-semibold mb-1 block">Risk Tolerance</Label>
                <Select value={riskTolerance} onValueChange={(v: any) => setRiskTolerance(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservative">Conservative</SelectItem>
                    <SelectItem value="moderate">Moderate</SelectItem>
                    <SelectItem value="aggressive">Aggressive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-semibold mb-1 block">Time Horizon</Label>
                <Select value={timeHorizon} onValueChange={setTimeHorizon}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 year</SelectItem>
                    <SelectItem value="3">3 years</SelectItem>
                    <SelectItem value="5">5 years</SelectItem>
                    <SelectItem value="10">10 years</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              onClick={runAnalysis}
              disabled={isLoading}
              className="w-full bg-indigo-700 hover:bg-indigo-800 text-white font-semibold py-3 text-base"
            >
              {isLoading ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running analysis - fetching data & simulating {(1000).toLocaleString()} paths...</>
              ) : (
                <><FlaskConical className="h-4 w-4 mr-2" />Run Quantitative Analysis</>
              )}
            </Button>
            {isLoading && (
              <p className="text-center text-xs text-gray-500">
                Fetching historical prices from Yahoo Finance, computing statistics, and running Monte Carlo simulation. This takes 15-40 seconds depending on number of holdings.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── Results ─────────────────────────────────────────────────────── */}
        {report && (
          <Tabs defaultValue="summary" className="space-y-4">
            <TabsList className="grid grid-cols-6 w-full bg-white border shadow-sm">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="montecarlo">Monte Carlo</TabsTrigger>
              <TabsTrigger value="riskreturn">Risk / Return</TabsTrigger>
              <TabsTrigger value="scores">Scores</TabsTrigger>
              <TabsTrigger value="allocation">Allocation</TabsTrigger>
              <TabsTrigger value="methodology">Methodology</TabsTrigger>
            </TabsList>

            {/* ── Tab 1: Summary ─────────────────────────────────────────── */}
            <TabsContent value="summary" className="space-y-6">
              {/* Holdings we couldn't get real data for are left out, never estimated */}
              {report.excludedHoldings.length > 0 && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 text-sm text-amber-900">
                  <p className="font-semibold flex items-center gap-2 mb-1">
                    <AlertTriangle className="h-4 w-4" /> Left out of this analysis (no reliable data)
                  </p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {report.excludedHoldings.map(e => (
                      <li key={e.symbol}><strong>{e.symbol}</strong>: {e.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard
                  label="Portfolio Value"
                  value={fmt.dollar(report.portfolioValue)}
                  sub={`${fmt.pct(report.cashWeight)} cash`}
                />
                <KpiCard
                  label="Expected Annual Return"
                  value={fmt.pct(report.portfolioAnnualReturn)}
                  sub="Weighted avg of holdings"
                  color={report.portfolioAnnualReturn >= 0 ? "text-green-700" : "text-red-600"}
                />
                <KpiCard
                  label="Annual Volatility"
                  value={fmt.pct(report.portfolioAnnualVol)}
                  sub="Includes correlation ρ=0.5"
                  color={report.portfolioAnnualVol > 0.25 ? "text-red-600" : "text-gray-900"}
                />
                <KpiCard
                  label="Sharpe Ratio"
                  value={fmt.round(report.portfolioSharpe)}
                  sub="(Return − Rf) / Volatility"
                  color={report.portfolioSharpe > 0.5 ? "text-green-700" : report.portfolioSharpe < 0 ? "text-red-600" : "text-gray-900"}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard
                  label="1-Day VaR (95%)"
                  value={fmt.dollar(report.var95Daily)}
                  sub={`${fmt.pct2(report.var95Pct * 100)} of portfolio`}
                  color="text-orange-700"
                  warning={report.var95Pct > 0.025}
                />
                <KpiCard
                  label="CVaR / Exp. Shortfall"
                  value={fmt.dollar(report.cvar95Daily)}
                  sub="Expected loss beyond VaR"
                  color="text-red-700"
                />
                <KpiCard
                  label="HHI Concentration"
                  value={fmt.round(report.hhi)}
                  sub={report.hhi > 0.25 ? "⚠ Concentrated" : report.hhi > 0.15 ? "Moderate" : "Well diversified"}
                  color={report.hhi > 0.25 ? "text-red-600" : report.hhi > 0.15 ? "text-yellow-700" : "text-green-700"}
                  warning={report.hhi > 0.25}
                />
                <KpiCard
                  label="Prob. of Loss"
                  value={`${report.monteCarlo.probabilityOfLoss.toFixed(1)}%`}
                  sub={`Over ${report.monteCarlo.timeHorizonYears}yr Monte Carlo`}
                  color={report.monteCarlo.probabilityOfLoss > 30 ? "text-red-600" : "text-gray-900"}
                />
              </div>

              {/* Holdings table */}
              <Card className="border shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Holdings Detail</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr>
                          {["Symbol", "Value", "Weight", "Ann. Return", "Ann. Vol", "Sharpe", "20d Mom", "60d Mom"].map(h => (
                            <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.holdings.map((h, i) => (
                          <tr key={i} className="border-b hover:bg-gray-50">
                            <td className="px-4 py-3 font-bold font-mono">{h.symbol}</td>
                            <td className="px-4 py-3">{fmt.dollar(h.currentValue)}</td>
                            <td className="px-4 py-3">{fmt.pct(h.weight)}</td>
                            <td className={`px-4 py-3 font-medium ${h.annualizedReturn >= 0 ? "text-green-700" : "text-red-600"}`}>
                              {fmt.pct(h.annualizedReturn)}
                            </td>
                            <td className={`px-4 py-3 ${h.annualizedVolatility > 0.35 ? "text-red-600 font-medium" : ""}`}>
                              {fmt.pct(h.annualizedVolatility)}
                            </td>
                            <td className={`px-4 py-3 font-medium ${h.sharpeRatio > 0.5 ? "text-green-700" : h.sharpeRatio < 0 ? "text-red-600" : "text-gray-700"}`}>
                              {fmt.round(h.sharpeRatio)}
                            </td>
                            <td className={`px-4 py-3 ${h.momentum20d >= 0 ? "text-green-700" : "text-red-600"}`}>
                              {h.momentum20d >= 0 ? "+" : ""}{h.momentum20d.toFixed(1)}%
                            </td>
                            <td className={`px-4 py-3 ${h.momentum60d >= 0 ? "text-green-700" : "text-red-600"}`}>
                              {h.momentum60d >= 0 ? "+" : ""}{h.momentum60d.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Tab 2: Monte Carlo ──────────────────────────────────────── */}
            <TabsContent value="montecarlo" className="space-y-6">
              <Card className="border-0 shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Monte Carlo Simulation - {report.monteCarlo.numSimulations.toLocaleString()} Paths × {report.monteCarlo.timeHorizonYears} Years
                    <Badge variant="outline" className="text-xs">GBM Model</Badge>
                  </CardTitle>
                  <p className="text-sm text-gray-600">
                    Each shaded band represents the range of outcomes at that confidence level.
                    The dark line is the median (50th percentile) projection.
                  </p>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={380}>
                    <AreaChart data={report.monteCarlo.timeSeries} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="month"
                        tickFormatter={m => m === 0 ? "Now" : `Mo ${m}`}
                        label={{ value: "Months", position: "insideBottom", offset: -10, fontSize: 12 }}
                      />
                      <YAxis
                        tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                        width={70}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => [fmt.dollar(value), name]}
                        labelFormatter={m => m === 0 ? "Initial" : `Month ${m}`}
                      />
                      {/* Fan chart: outermost band → innermost (dark line last so it shows on top) */}
                      <Area type="monotone" dataKey="p95" stroke="none" fill="#bbf7d0" name="95th pct" fillOpacity={0.6} />
                      <Area type="monotone" dataKey="p75" stroke="none" fill="#6ee7b7" name="75th pct" fillOpacity={0.7} />
                      <Area type="monotone" dataKey="p25" stroke="none" fill="#a7f3d0" name="25th pct (lower)" fillOpacity={0.8} />
                      <Area type="monotone" dataKey="p5" stroke="none" fill="#fca5a5" name="5th pct" fillOpacity={0.6} />
                      <Area type="monotone" dataKey="p50" stroke="#1d4ed8" fill="none" name="Median" strokeWidth={2.5} />
                      <ReferenceLine y={report.monteCarlo.initialValue} stroke="#6b7280" strokeDasharray="4 4" label={{ value: "Initial", fontSize: 11 }} />
                      <Legend />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Final outcome table */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: "Bear Case (5th pct)", value: report.monteCarlo.finalOutcomes.p5, color: "text-red-700" },
                  { label: "25th Percentile", value: report.monteCarlo.finalOutcomes.p25, color: "text-orange-700" },
                  { label: "Median (50th)", value: report.monteCarlo.finalOutcomes.p50, color: "text-blue-700" },
                  { label: "75th Percentile", value: report.monteCarlo.finalOutcomes.p75, color: "text-green-600" },
                  { label: "Bull Case (95th pct)", value: report.monteCarlo.finalOutcomes.p95, color: "text-emerald-700" },
                ].map(o => (
                  <Card key={o.label} className="border shadow-sm text-center">
                    <CardContent className="p-4">
                      <p className="text-xs text-gray-500 mb-1">{o.label}</p>
                      <p className={`text-xl font-bold ${o.color}`}>{fmt.dollar(o.value)}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {o.value >= report.monteCarlo.initialValue ? "+" : ""}
                        {(((o.value - report.monteCarlo.initialValue) / report.monteCarlo.initialValue) * 100).toFixed(0)}% total
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className="border-blue-200 bg-blue-50">
                <CardContent className="p-4 text-sm text-blue-900">
                  <strong>Probability of loss ({report.monteCarlo.timeHorizonYears}yr horizon):</strong>{" "}
                  {report.monteCarlo.probabilityOfLoss.toFixed(1)}% of simulated paths ended below the initial portfolio value.
                  This is derived from the distribution of GBM terminal values, not historical data directly.
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Tab 3: Risk / Return ────────────────────────────────────── */}
            <TabsContent value="riskreturn" className="space-y-6">
              <Card className="border-0 shadow-md">
                <CardHeader>
                  <CardTitle>Expected Return vs. Annualized Volatility</CardTitle>
                  <p className="text-sm text-gray-600">
                    Each point represents one holding. Efficient holdings sit in the upper-left (high return, low vol).
                    The horizontal dashed line marks the risk-free rate (5.25%).
                  </p>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={340}>
                    <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        type="number"
                        dataKey="vol"
                        name="Annualized Vol"
                        tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                        label={{ value: "Annualized Volatility →", position: "insideBottom", offset: -15, fontSize: 12 }}
                      />
                      <YAxis
                        type="number"
                        dataKey="ret"
                        name="Annualized Return"
                        tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                        label={{ value: "Exp. Return →", angle: -90, position: "insideLeft", fontSize: 12 }}
                      />
                      <Tooltip
                        content={({ payload }) => {
                          if (!payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-white border rounded shadow p-3 text-sm">
                              <p className="font-bold">{d.symbol}</p>
                              <p>Return: {(d.ret * 100).toFixed(1)}%</p>
                              <p>Volatility: {(d.vol * 100).toFixed(1)}%</p>
                              <p>Sharpe: {d.sharpe.toFixed(2)}</p>
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine y={0.0525} stroke="#9ca3af" strokeDasharray="4 4" label={{ value: "Rf = 5.25%", fontSize: 10, fill: "#6b7280" }} />
                      <Scatter
                        name="Holdings"
                        data={report.holdings.map(h => ({
                          symbol: h.symbol,
                          vol: h.annualizedVolatility,
                          ret: h.annualizedReturn,
                          sharpe: h.sharpeRatio,
                        }))}
                        fill="#4f46e5"
                      >
                        {report.holdings.map((h, i) => (
                          <Cell key={i} fill={h.sharpeRatio > 0.5 ? "#16a34a" : h.sharpeRatio < 0 ? "#dc2626" : "#4f46e5"} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>

                  {/* Labels for each point (drawn separately since Recharts Scatter doesn't do labels well) */}
                  <div className="flex flex-wrap gap-3 mt-2 justify-center">
                    {report.holdings.map(h => (
                      <div key={h.symbol} className="flex items-center gap-1.5 text-sm">
                        <div className={`w-3 h-3 rounded-full ${h.sharpeRatio > 0.5 ? "bg-green-600" : h.sharpeRatio < 0 ? "bg-red-600" : "bg-indigo-600"}`} />
                        <span className="font-mono font-semibold">{h.symbol}</span>
                        <span className="text-gray-500">Sharpe: {h.sharpeRatio.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Tab 4: Recommendation Scores ───────────────────────────── */}
            <TabsContent value="scores" className="space-y-6">
              {/* Score bar chart */}
              <Card className="border-0 shadow-md">
                <CardHeader>
                  <CardTitle>Composite Recommendation Score (0–100)</CardTitle>
                  <p className="text-sm text-gray-600">5 components × 20 points each: momentum, volatility, concentration, diversification, cash utilization.</p>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={report.scores.map(s => ({ symbol: s.symbol, score: s.totalScore }))} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} />
                      <YAxis type="category" dataKey="symbol" width={60} tick={{ fontFamily: "monospace", fontWeight: 700 }} />
                      <Tooltip formatter={(v: number) => [`${v}/100`, "Score"]} />
                      <ReferenceLine x={65} stroke="#16a34a" strokeDasharray="4 4" label={{ value: "Buy threshold", fontSize: 10, fill: "#16a34a" }} />
                      <ReferenceLine x={35} stroke="#dc2626" strokeDasharray="4 4" label={{ value: "Reduce threshold", fontSize: 10, fill: "#dc2626" }} />
                      <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                        {report.scores.map((s, i) => (
                          <Cell key={i} fill={scoreBarColor(s.totalScore)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Detailed score cards */}
              <div className="space-y-4">
                {report.scores.map(s => (
                  <Card key={s.symbol} className="border shadow-sm">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <div className="flex items-center gap-3">
                            <span className="text-2xl font-bold font-mono">{s.symbol}</span>
                            <Badge className={`border ${actionColors[s.action]}`}>
                              {s.action === "BUY_MORE" ? "▲ BUY MORE" : s.action === "REDUCE" ? "▼ REDUCE" : "● HOLD"}
                            </Badge>
                            <Badge className={confidenceColors[s.confidenceLevel]}>
                              {s.confidenceLevel} confidence
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-600 mt-2">{s.reasoning}</p>
                        </div>
                        <div className="text-right ml-4 flex-shrink-0">
                          <p className="text-3xl font-bold" style={{ color: scoreBarColor(s.totalScore) }}>{s.totalScore}</p>
                          <p className="text-xs text-gray-400">/ 100</p>
                        </div>
                      </div>

                      {/* Score component breakdown */}
                      <div className="grid grid-cols-5 gap-2 text-center text-xs">
                        {[
                          { label: "Momentum", val: s.components.momentum },
                          { label: "Volatility", val: s.components.volatility },
                          { label: "Concentration", val: s.components.concentration },
                          { label: "Diversification", val: s.components.diversification },
                          { label: "Cash", val: s.components.cash },
                        ].map(c => (
                          <div key={c.label} className="bg-gray-50 rounded p-2 border">
                            <div className="text-lg font-bold text-gray-800">{c.val}<span className="text-gray-400 text-xs">/20</span></div>
                            <div className="text-gray-500">{c.label}</div>
                          </div>
                        ))}
                      </div>

                      <p className="text-xs text-gray-400 mt-3 italic">{s.riskNote}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* ── Tab 5: Allocation ───────────────────────────────────────── */}
            <TabsContent value="allocation" className="space-y-6">
              <Card className="border-0 shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Target className="h-5 w-5 text-indigo-600" />
                    Current vs. Target Allocation ({riskTolerance})
                  </CardTitle>
                  <p className="text-sm text-gray-600">
                    Target allocations based on widely-used passive investing frameworks for {riskTolerance} risk profiles.
                    Deviations highlight rebalancing opportunities.
                  </p>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={report.allocationTargets} margin={{ bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={50} />
                      <YAxis tickFormatter={v => `${v}%`} />
                      <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`]} />
                      <Legend />
                      <Bar dataKey="targetPct" fill="#c7d2fe" name="Target %" />
                      <Bar dataKey="currentPct" fill="#4f46e5" name="Current %" />
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Deviation table */}
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          {["Asset Class", "Ticker", "Target", "Current", "Deviation", "Action"].map(h => (
                            <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.allocationTargets.map((t, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-2 font-medium">{t.name}</td>
                            <td className="px-3 py-2 font-mono text-xs">{t.ticker}</td>
                            <td className="px-3 py-2">{t.targetPct.toFixed(0)}%</td>
                            <td className="px-3 py-2">{t.currentPct.toFixed(1)}%</td>
                            <td className={`px-3 py-2 font-medium ${t.deviation > 0 ? "text-orange-600" : t.deviation < 0 ? "text-blue-600" : "text-gray-500"}`}>
                              {t.deviation > 0 ? "+" : ""}{t.deviation.toFixed(1)}%
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {Math.abs(t.deviation) < 3 ? "On target" :
                                t.deviation > 0 ? `Consider trimming ${t.ticker}` : `Consider adding ${t.ticker}`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Tab 6: Methodology ─────────────────────────────────────── */}
            <TabsContent value="methodology" className="space-y-6">
              <Card className="border-0 shadow-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-indigo-600" />
                    Model Methodology - Plain English
                  </CardTitle>
                </CardHeader>
                <CardContent className="prose prose-sm max-w-none space-y-6">

                  {[
                    {
                      title: "1. Data & Returns",
                      body: `We fetch roughly the last 6 months of daily closing prices for each holding from Yahoo Finance's daily price history. From those prices we compute daily log returns: r_t = ln(P_t / P_{t-1}). Log returns are preferred over simple percentage returns in quantitative finance because they're additive across time periods and more closely approximate a normal distribution - a key assumption in most risk models.`,
                    },
                    {
                      title: "2. Annualization",
                      body: `Daily statistics are scaled to annual figures using the standard convention of 252 trading days per year. Annualized return = mean(r_t) × 252. Annualized volatility = std(r_t) × √252. This assumes returns are i.i.d. (independent and identically distributed) - a simplification that works reasonably well for liquid equities.`,
                    },
                    {
                      title: "3. Sharpe Ratio",
                      body: `Sharpe = (μ_annual − Rf) / σ_annual, where Rf = 5.25% (current US 3-month T-bill yield). Sharpe > 1.0 is considered excellent; > 0.5 is good; < 0 means the holding has underperformed cash. It measures excess return earned per unit of risk taken.`,
                    },
                    {
                      title: "4. Portfolio Volatility (Markowitz)",
                      body: `Portfolio variance = Σᵢ wᵢ²σᵢ² + 2ρ Σᵢ<ⱼ wᵢwⱼσᵢσⱼ, where wᵢ is the weight and σᵢ is the annualized volatility of holding i. We assume a uniform pairwise correlation ρ = 0.5 between all equity holdings. This is a conservative middle-ground for US equities, which historically correlate around 0.4–0.7. The key insight from Markowitz: portfolio volatility is lower than the weighted average of individual volatilities, because diversification partially cancels out idiosyncratic risk.`,
                    },
                    {
                      title: "5. Value at Risk (VaR) and CVaR",
                      body: `VaR_95 = portfolio × (μ_daily − 1.645 × σ_daily), expressed as a positive dollar loss. Interpretation: "We expect not to lose more than $VaR in a single trading day, 95% of the time." The 1.645 is the z-score for the 95th percentile of the standard normal distribution. CVaR (Conditional VaR, or Expected Shortfall) = portfolio × (μ_daily − σ_daily × φ(1.645) / 0.05), where φ is the normal PDF. CVaR answers: "If we do breach VaR, how bad does it get on average?" It's a more pessimistic and more useful risk measure.`,
                    },
                    {
                      title: "6. Monte Carlo Simulation (GBM)",
                      body: `We simulate 1,000 independent portfolio value paths using Geometric Brownian Motion: S(t+Δt) = S(t) × exp((μ − σ²/2)Δt + σ√Δt × Z), where Z ~ N(0,1) is a random normal draw and Δt = 1/12 (monthly steps). The term (μ − σ²/2) is the Itô drift correction - it converts from arithmetic to geometric mean, which is the mathematically correct form for multiplicative price processes. We use Box-Muller transform to generate the normal random numbers. The fan chart shows 5th, 25th, 50th, 75th, and 95th percentiles of the 1,000 simulations at each monthly time step.`,
                    },
                    {
                      title: "7. Herfindahl-Hirschman Index (HHI)",
                      body: `HHI = Σ wᵢ², summed across all holdings including cash. HHI = 1/n for n equally-weighted holdings (e.g., 0.10 for 10 equal positions). HHI = 1.0 means 100% in one asset. We flag HHI > 0.25 as concentrated - this is the threshold used in antitrust economics (though applied here to portfolio concentration, not market structure).`,
                    },
                    {
                      title: "8. Recommendation Score (0–100)",
                      body: `Each holding receives a composite score built from five 0–20 sub-components: (1) 20-day momentum - positive price trend boosts the score; (2) volatility - lower annualized vol scores higher, with 20% as the neutral midpoint; (3) concentration - penalizes positions exceeding the target max weight for the selected risk profile; (4) diversification benefit - rewards holdings whose individual vol is below the portfolio vol, indicating correlation benefit; (5) cash utilization - rewards buying momentum names when idle cash exceeds 5% of the portfolio. Actions: BUY_MORE if score ≥ 65 and cash available; REDUCE if score < 35 or weight exceeds 1.3× target; HOLD otherwise.`,
                    },
                  ].map(section => (
                    <div key={section.title} className="bg-gray-50 rounded-lg p-5 border">
                      <h3 className="font-bold text-gray-900 mb-2 text-base">{section.title}</h3>
                      <p className="text-gray-700 leading-relaxed text-sm">{section.body}</p>
                    </div>
                  ))}

                  {/* Data sources table */}
                  <div className="bg-white rounded-lg p-5 border border-gray-200">
                    <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
                      <Info className="h-4 w-4" /> Data Sources
                    </h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-1 text-gray-600">Ticker</th>
                          <th className="text-left py-1 text-gray-600">Source</th>
                          <th className="text-left py-1 text-gray-600">Latest bar</th>
                          <th className="text-left py-1 text-gray-600">Days</th>
                          <th className="text-left py-1 text-gray-600">Retrieved</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.dataSources.map(d => (
                          <tr key={d.symbol} className="border-b border-gray-100">
                            <td className="py-1.5 font-medium">{d.symbol}</td>
                            <td className="py-1.5">{d.source}</td>
                            <td className="py-1.5">{d.asOf} <span className="text-gray-500">({d.freshness})</span></td>
                            <td className="py-1.5">{d.observations}</td>
                            <td className="py-1.5">{new Date(d.retrievedAt).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Assumptions table */}
                  <div className="bg-indigo-50 rounded-lg p-5 border border-indigo-200">
                    <h3 className="font-bold text-indigo-900 mb-3 flex items-center gap-2">
                      <Info className="h-4 w-4" /> Model Assumptions
                    </h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-indigo-200">
                          <th className="text-left py-1 text-indigo-700">Parameter</th>
                          <th className="text-left py-1 text-indigo-700">Value / Assumption</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.assumptions.map((a, i) => (
                          <tr key={i} className="border-b border-indigo-100">
                            <td className="py-1.5 font-medium text-indigo-900">{a.label}</td>
                            <td className="py-1.5 text-indigo-800">{a.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Disclaimer */}
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-5">
                    <h3 className="font-bold text-yellow-900 mb-2 flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4" /> Limitations & Honest Disclaimers
                    </h3>
                    <ul className="text-sm text-yellow-900 space-y-2 list-disc list-inside">
                      <li>Historical return and volatility are <strong>not predictors</strong> of future performance. Markets change regime.</li>
                      <li>Uniform correlation (ρ = 0.5) is a simplification. Real pairwise correlations vary and tend to spike toward 1.0 during market crises - when you need diversification most.</li>
                      <li>GBM assumes log-normally distributed returns. Real returns have fat tails (kurtosis &gt; 3) and negative skew, meaning extreme events happen more often than the model predicts. VaR likely <strong>underestimates</strong> tail risk.</li>
                      <li>The model uses ~100 days of data. Short estimation windows amplify statistical noise. Estimates from sparse data should be treated with skepticism.</li>
                      <li>Sharpe ratios computed from short periods are unreliable. A Sharpe of 1.5 on 3 months of data means almost nothing statistically.</li>
                      <li>Recommendation scores are <strong>rule-based heuristics</strong>, not optimized predictions. They reflect structural signals, not forecasts of future returns.</li>
                      <li>This tool is for educational and analytical purposes only. Nothing here constitutes financial advice.</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
