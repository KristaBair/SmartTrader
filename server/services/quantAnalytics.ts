/**
 * quantAnalytics.ts - The mathematical core of InvestSmart.
 *
 * Implements real quant finance calculations:
 *   - Geometric Brownian Motion (GBM) Monte Carlo simulation
 *   - Parametric Value at Risk (VaR) and Conditional VaR (CVaR / Expected Shortfall)
 *   - Markowitz portfolio variance with uniform pairwise correlation assumption
 *   - Herfindahl-Hirschman Index (HHI) for concentration risk
 *   - Momentum signals (20-day and 60-day price return)
 *   - Composite recommendation scoring (5 components, 0-100 scale)
 *
 * All math is kept simple and defensible - no black boxes.
 * Assumptions are documented in comments so the model is transparent.
 */

import { getPriceHistory } from "./finnhub";
import type { DataProvenance } from "./dataProvenance";

// Thrown when none of the holdings have enough real price history to analyze.
// We refuse to fill the gap with made-up numbers.
export class InsufficientDataError extends Error {}

// Fewer daily closes than this and the volatility estimate is too noisy to use.
export const MIN_PRICE_HISTORY = 20;

// -- Statistical helpers --

/**
 * Compute daily log returns from a price series.
 * Log returns are preferred over simple returns in quant finance because:
 * 1. They're additive across time (log compounding)
 * 2. They're more normally distributed than simple returns
 * 3. They can't go below -100% (mathematically consistent)
 */
export function calcLogReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0 && prices[i] > 0) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }
  return returns;
}

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Sample standard deviation (divides by n-1, Bessel's correction)
export function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/**
 * Box-Muller transform - generates a standard normal random variate Z ~ N(0,1).
 * We implement this ourselves to avoid adding a dependency.
 */
function sampleNormal(): number {
  let u = 0, v = 0;
  // Avoid log(0) - keep sampling until non-zero
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Return the p-th percentile of a pre-sorted array.
 * Uses nearest-rank method for simplicity.
 */
export function percentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const idx = Math.max(0, Math.floor((p / 100) * sortedArr.length) - 1);
  return sortedArr[idx];
}

// Standard normal PDF - used for CVaR calculation
function normPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

// -- Types --

export interface HoldingInput {
  symbol: string;
  shares: number;
}

export interface HoldingStats {
  symbol: string;
  shares: number;
  currentPrice: number;
  currentValue: number;
  // Portfolio weight (fraction of total including cash)
  weight: number;
  // Annualized return = mean daily log return × 252
  annualizedReturn: number;
  // Annualized volatility = daily std × √252
  annualizedVolatility: number;
  // Sharpe ratio = (annualizedReturn - riskFreeRate) / annualizedVolatility
  sharpeRatio: number;
  // Price momentum over last 20 and 60 trading days (percentage change)
  momentum20d: number;
  momentum60d: number;
}

export interface MonteCarloTimestep {
  month: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface MonteCarloResult {
  timeHorizonYears: number;
  numSimulations: number;
  initialValue: number;
  // Monthly snapshots of percentile portfolio values - used for the fan chart
  timeSeries: MonteCarloTimestep[];
  finalOutcomes: { p5: number; p25: number; p50: number; p75: number; p95: number };
  probabilityOfLoss: number;  // % of paths ending below initial value
}

export interface RecommendationScore {
  symbol: string;
  currentWeight: number;
  totalScore: number;
  components: {
    momentum: number;      // 0-20: positive momentum → higher score
    volatility: number;    // 0-20: lower vol relative to baseline → higher score
    concentration: number; // 0-20: position not exceeding target weight → higher score
    diversification: number; // 0-20: contribution to portfolio vol reduction
    cash: number;          // 0-20: idle cash × momentum signal
  };
  action: "BUY_MORE" | "HOLD" | "REDUCE";
  confidenceLevel: "Low" | "Medium" | "High";
  reasoning: string;
  riskNote: string;
}

export interface QuantReport {
  portfolioValue: number;
  cashAmount: number;
  cashWeight: number;
  holdings: HoldingStats[];
  // Portfolio-level statistics
  portfolioAnnualReturn: number;
  portfolioAnnualVol: number;
  portfolioSharpe: number;
  // Herfindahl-Hirschman Index: Σwᵢ² - ranges 0 (perfect diversity) to 1 (all in one)
  hhi: number;
  // Value at Risk (1-day, 95% confidence, in dollars and %)
  var95Daily: number;
  var95Pct: number;
  // Conditional VaR / Expected Shortfall - expected loss given that VaR is breached
  cvar95Daily: number;
  monteCarlo: MonteCarloResult;
  scores: RecommendationScore[];
  allocationTargets: AllocationTarget[];
  // Model assumptions surfaced for transparency
  assumptions: { label: string; value: string }[];
  // Where each holding's price history came from and how recent it is
  dataSources: (DataProvenance & { symbol: string; observations: number })[];
  // Holdings left out of every calculation because real data was unavailable
  excludedHoldings: { symbol: string; reason: string }[];
}

export interface AllocationTarget {
  name: string;
  ticker: string;
  targetPct: number;
  currentPct: number;
  deviation: number;
}

// -- Main analysis function --

export async function runQuantAnalysis(
  holdings: HoldingInput[],
  cash: number,
  riskTolerance: "conservative" | "moderate" | "aggressive",
  timeHorizonYears: number = 5,
  // Injectable so tests can supply fixed price series instead of calling Yahoo.
  fetchHistory: typeof getPriceHistory = getPriceHistory,
  // Pause between symbols to stay polite with the Yahoo Finance endpoint.
  requestDelayMs = 350
): Promise<QuantReport> {

  // 3-month US T-bill yield (~5.25% in early 2025) used as risk-free rate.
  // This is a fixed assumption, not a live rate; the UI says so.
  const RISK_FREE_RATE = 0.0525;

  // Pairwise correlation assumption between equity holdings.
  // Using 0.5 (moderate positive correlation) - conservative for US large-cap equities
  // which historically correlate around 0.4-0.7. We document this assumption explicitly.
  const ASSUMED_CORRELATION = 0.5;

  const NUM_SIMULATIONS = 1000;

  // -- Step 1: Fetch historical data and compute per-holding statistics --

  const holdingStats: (HoldingStats & { _dailyReturns: number[]; _closes: number[] })[] = [];
  const dataSources: QuantReport["dataSources"] = [];
  const excludedHoldings: QuantReport["excludedHoldings"] = [];

  for (const h of holdings) {
    const history = await fetchHistory(h.symbol, "compact");
    const closes = history.points.map(p => p.close);

    if (closes.length < MIN_PRICE_HISTORY || !history.provenance) {
      // Not enough real data. Leave the holding out and say so, rather than
      // substituting a made-up price or market-average return.
      excludedHoldings.push({
        symbol: h.symbol,
        reason: closes.length === 0
          ? "No price history was returned. Check the ticker symbol."
          : `Only ${closes.length} daily closes available (need at least ${MIN_PRICE_HISTORY}).`,
      });
      continue;
    }
    dataSources.push({ symbol: h.symbol, observations: closes.length, ...history.provenance });

    const dailyReturns = calcLogReturns(closes);
    const currentPrice = closes[closes.length - 1];
    const currentValue = currentPrice * h.shares;

    // Scale to annual: 252 trading days per year
    const meanDaily = mean(dailyReturns);
    const volDaily = stdDev(dailyReturns);
    const annualizedReturn = meanDaily * 252;
    const annualizedVolatility = volDaily * Math.sqrt(252);

    // Sharpe: excess return over risk-free, per unit of volatility
    const sharpeRatio = annualizedVolatility > 0
      ? (annualizedReturn - RISK_FREE_RATE) / annualizedVolatility
      : 0;

    // Momentum: how much has the price changed over 20 and 60 trading days?
    // Using simple returns here (not log) for interpretability
    const price20dAgo = closes.length >= 21 ? closes[closes.length - 21] : closes[0];
    const price60dAgo = closes.length >= 61 ? closes[closes.length - 61] : closes[0];
    const momentum20d = (currentPrice / price20dAgo - 1) * 100;
    const momentum60d = (currentPrice / price60dAgo - 1) * 100;

    holdingStats.push({
      symbol: h.symbol,
      shares: h.shares,
      currentPrice,
      currentValue,
      weight: 0,
      annualizedReturn,
      annualizedVolatility,
      sharpeRatio,
      momentum20d,
      momentum60d,
      _dailyReturns: dailyReturns,
      _closes: closes,
    });

    // Small delay between symbols to stay polite with the Yahoo Finance endpoint
    if (requestDelayMs > 0) await new Promise(r => setTimeout(r, requestDelayMs));
  }

  if (holdingStats.length === 0) {
    throw new InsufficientDataError(
      `Not enough price history to analyze: ${excludedHoldings.map(e => e.symbol).join(", ")}.`
    );
  }

  // -- Step 2: Portfolio weights --

  const totalInvested = holdingStats.reduce((sum, h) => sum + h.currentValue, 0);
  const portfolioValue = totalInvested + Math.max(0, cash);
  const cashWeight = portfolioValue > 0 ? cash / portfolioValue : 0;

  holdingStats.forEach(h => {
    h.weight = portfolioValue > 0 ? h.currentValue / portfolioValue : 0;
  });

  // -- Step 3: Portfolio return --

  const portfolioAnnualReturn = holdingStats.reduce(
    (sum, h) => sum + h.weight * h.annualizedReturn, 0
  );

  // -- Step 4: Portfolio volatility --
  // σ²_p = Σᵢ wᵢ²σᵢ² + 2ρ Σᵢ<ⱼ wᵢwⱼσᵢσⱼ
  // The second term captures correlation between holdings. With ρ=0.5,
  // diversification reduces portfolio vol but doesn't eliminate it.

  let portfolioVariance = holdingStats.reduce(
    (sum, h) => sum + h.weight ** 2 * h.annualizedVolatility ** 2, 0
  );

  for (let i = 0; i < holdingStats.length; i++) {
    for (let j = i + 1; j < holdingStats.length; j++) {
      portfolioVariance += 2 * ASSUMED_CORRELATION
        * holdingStats[i].weight * holdingStats[j].weight
        * holdingStats[i].annualizedVolatility * holdingStats[j].annualizedVolatility;
    }
  }

  // Fallback to 18% if no holdings (matches historical S&P 500 vol)
  const portfolioAnnualVol = holdingStats.length > 0 ? Math.sqrt(portfolioVariance) : 0.18;

  // Portfolio Sharpe ratio
  const portfolioSharpe = portfolioAnnualVol > 0
    ? (portfolioAnnualReturn - RISK_FREE_RATE) / portfolioAnnualVol
    : 0;

  // -- Step 5: Concentration Index --
  // HHI = Σ wᵢ² (including cash as one "asset")
  // HHI = 1/n for n equally-weighted assets (e.g., 1/5 = 0.20 for 5 holdings)
  // HHI > 0.25 indicates meaningful concentration risk
  const hhi = holdingStats.reduce((sum, h) => sum + h.weight ** 2, 0) + cashWeight ** 2;

  // -- Step 6: Value at Risk --
  // VaR_95 = portfolio × (μ_daily - 1.645 × σ_daily)
  // "With 95% confidence, daily losses won't exceed VaR_95 dollars."
  // Expressed as a positive number (loss amount).

  const dailyMean = portfolioAnnualReturn / 252;
  const dailyVol = portfolioAnnualVol / Math.sqrt(252);
  const Z_95 = 1.645;  // z-score for 95th percentile of normal distribution

  const var95Pct = Math.max(0, -(dailyMean - Z_95 * dailyVol));
  const var95Daily = var95Pct * portfolioValue;

  // Conditional VaR (Expected Shortfall) at 95%:
  // CVaR_95 = μ - σ × φ(Z_95) / (1 - 0.95) for normal distribution
  // This is the expected loss *given* that losses exceed VaR - a more conservative metric
  const cvar95Pct = Math.max(0, -(dailyMean - dailyVol * normPdf(Z_95) / 0.05));
  const cvar95Daily = cvar95Pct * portfolioValue;

  // -- Step 7: Monte Carlo simulation --
  // Model: S(t + Δt) = S(t) × exp((μ - σ²/2)Δt + σ√Δt × Z)
  //   where μ = portfolio annual return, σ = portfolio annual vol, Z ~ N(0,1)
  // The term (μ - σ²/2) is the "drift correction" - it converts from arithmetic
  // to geometric mean, which is the mathematically correct form for GBM.
  // We simulate monthly steps (Δt = 1/12) for interpretability.

  const monthsTotal = timeHorizonYears * 12;
  const dt = 1 / 12;
  const driftTerm = (portfolioAnnualReturn - 0.5 * portfolioAnnualVol ** 2) * dt;
  const diffusionTerm = portfolioAnnualVol * Math.sqrt(dt);

  // Run NUM_SIMULATIONS independent paths, each stored as monthly values
  const allPaths: number[][] = [];
  for (let sim = 0; sim < NUM_SIMULATIONS; sim++) {
    const path = [portfolioValue];
    for (let t = 0; t < monthsTotal; t++) {
      const prev = path[path.length - 1];
      const z = sampleNormal();
      path.push(prev * Math.exp(driftTerm + diffusionTerm * z));
    }
    allPaths.push(path);
  }

  // Compute cross-sectional percentiles at each month - this creates the fan chart shape
  const timeSeries: MonteCarloTimestep[] = [];
  for (let t = 0; t <= monthsTotal; t++) {
    const valuesAtT = allPaths.map(p => p[t]).sort((a, b) => a - b);
    timeSeries.push({
      month: t,
      p5: percentile(valuesAtT, 5),
      p25: percentile(valuesAtT, 25),
      p50: percentile(valuesAtT, 50),
      p75: percentile(valuesAtT, 75),
      p95: percentile(valuesAtT, 95),
    });
  }

  const finalValues = allPaths.map(p => p[p.length - 1]).sort((a, b) => a - b);
  const lossCount = finalValues.filter(v => v < portfolioValue).length;

  const monteCarlo: MonteCarloResult = {
    timeHorizonYears,
    numSimulations: NUM_SIMULATIONS,
    initialValue: portfolioValue,
    timeSeries,
    finalOutcomes: {
      p5: percentile(finalValues, 5),
      p25: percentile(finalValues, 25),
      p50: percentile(finalValues, 50),
      p75: percentile(finalValues, 75),
      p95: percentile(finalValues, 95),
    },
    probabilityOfLoss: (lossCount / NUM_SIMULATIONS) * 100,
  };

  // ── Step 8: Recommendation scores (5-component composite, 0-100) ──────────
  //
  // Each component is scored 0-20 and summed for a total of 0-100.
  // Score interpretation:
  //   70-100: Strong buy signal (relative to current position)
  //   50-69:  Hold - no compelling reason to change position
  //   30-49:  Consider reducing - several negative signals
  //   0-29:   Reduce - high concentration, poor momentum, high vol

  // Max target weight per holding depends on risk tolerance
  const maxWeight = riskTolerance === "conservative" ? 0.15
    : riskTolerance === "moderate" ? 0.25
    : 0.40;

  const scores: RecommendationScore[] = holdingStats.map(h => {
    // Component 1 - Momentum (20-day): clamp [-30%, +30%] → map to [0, 20]
    const clampedMom = Math.max(-30, Math.min(30, h.momentum20d));
    const momentum = Math.round(((clampedMom + 30) / 60) * 20);

    // Component 2 - Volatility: 20% annual vol → score of 10 (neutral).
    // Each 5pp above 20% reduces score by ~2.5 points.
    const volatility = Math.round(Math.max(0, Math.min(20, 20 - (h.annualizedVolatility - 0.20) * 50)));

    // Component 3 - Concentration: score falls as position weight exceeds target
    const excess = Math.max(0, h.weight - maxWeight);
    const concentration = Math.round(Math.max(0, 20 - (excess / Math.max(maxWeight, 0.01)) * 20));

    // Component 4 - Diversification benefit:
    // Holdings with lower vol than the portfolio reduce portfolio risk → reward them.
    // Score is higher when individual vol is below portfolio vol.
    const diversification = Math.round(
      Math.max(0, Math.min(20, 10 + (portfolioAnnualVol - h.annualizedVolatility) * 25))
    );

    // Component 5 - Cash utilization: reward deploying idle cash into assets with positive momentum
    const cashRatio = portfolioValue > 0 ? Math.min(1, cash / portfolioValue) : 0;
    const cashComponent = h.momentum20d > 0
      ? Math.round(cashRatio * 20)
      : Math.round(cashRatio * 5);

    const totalScore = momentum + volatility + concentration + diversification + cashComponent;

    // Action thresholds - calibrated against the score distribution
    let action: "BUY_MORE" | "HOLD" | "REDUCE";
    if (h.weight > maxWeight * 1.3 || (totalScore < 35)) {
      action = "REDUCE";
    } else if (totalScore >= 65 && cash > portfolioValue * 0.05) {
      action = "BUY_MORE";
    } else {
      action = "HOLD";
    }

    // Confidence is proportional to how far from neutral (50) the score is
    const distFromNeutral = Math.abs(totalScore - 50);
    const confidenceLevel: "Low" | "Medium" | "High" =
      distFromNeutral > 25 ? "High" : distFromNeutral > 12 ? "Medium" : "Low";

    // Build plain-English reasoning from the signals
    const points: string[] = [];
    if (h.momentum20d > 5) points.push(`positive 20-day momentum (+${h.momentum20d.toFixed(1)}%)`);
    else if (h.momentum20d < -5) points.push(`negative 20-day momentum (${h.momentum20d.toFixed(1)}%)`);
    if (h.annualizedVolatility > 0.35) points.push(`elevated annualized volatility (${(h.annualizedVolatility * 100).toFixed(0)}%)`);
    if (h.weight > maxWeight) points.push(`weight of ${(h.weight * 100).toFixed(1)}% exceeds the ${(maxWeight * 100).toFixed(0)}% target for ${riskTolerance} risk`);
    if (cash > portfolioValue * 0.10 && action === "BUY_MORE") points.push(`${(cashWeight * 100).toFixed(0)}% idle cash available for deployment`);

    const reasoning = points.length > 0
      ? `${h.symbol}: ` + points.join("; ") + "."
      : `${h.symbol} shows balanced risk/return characteristics at current weight (${(h.weight * 100).toFixed(1)}%).`;

    const riskNote = `Annualized vol: ${(h.annualizedVolatility * 100).toFixed(1)}% | Sharpe: ${h.sharpeRatio.toFixed(2)} | Score is rule-based, not a return forecast.`;

    return {
      symbol: h.symbol,
      currentWeight: h.weight,
      totalScore,
      components: { momentum, volatility, concentration, diversification, cash: cashComponent },
      action,
      confidenceLevel,
      reasoning,
      riskNote,
    };
  });

  // ── Step 9: Allocation targets ────────────────────────────────────────────

  const TARGET_ALLOCATIONS: Record<string, AllocationTarget[]> = {
    conservative: [
      { name: "Bonds / Fixed Income", ticker: "BND", targetPct: 40, currentPct: 0, deviation: 0 },
      { name: "US Large Cap", ticker: "VTI", targetPct: 30, currentPct: 0, deviation: 0 },
      { name: "International", ticker: "VXUS", targetPct: 15, currentPct: 0, deviation: 0 },
      { name: "Cash / Stable", ticker: "CASH", targetPct: 15, currentPct: 0, deviation: 0 },
    ],
    moderate: [
      { name: "US Large Cap", ticker: "VTI", targetPct: 45, currentPct: 0, deviation: 0 },
      { name: "International", ticker: "VXUS", targetPct: 20, currentPct: 0, deviation: 0 },
      { name: "Bonds / Fixed Income", ticker: "BND", targetPct: 20, currentPct: 0, deviation: 0 },
      { name: "US Small Cap", ticker: "VBR", targetPct: 15, currentPct: 0, deviation: 0 },
    ],
    aggressive: [
      { name: "US Large Cap Growth", ticker: "VUG", targetPct: 40, currentPct: 0, deviation: 0 },
      { name: "International", ticker: "VXUS", targetPct: 20, currentPct: 0, deviation: 0 },
      { name: "US Small Cap", ticker: "VBR", targetPct: 20, currentPct: 0, deviation: 0 },
      { name: "Emerging Markets", ticker: "VWO", targetPct: 20, currentPct: 0, deviation: 0 },
    ],
  };

  const allocationTargets = TARGET_ALLOCATIONS[riskTolerance].map(target => {
    const match = holdingStats.find(h => h.symbol === target.ticker);
    const currentPct = match ? match.weight * 100 : (target.ticker === "CASH" ? cashWeight * 100 : 0);
    return { ...target, currentPct, deviation: currentPct - target.targetPct };
  });

  // ── Step 10: Surface assumptions for UI transparency ──────────────────────

  const assumptions = [
    { label: "Risk-free rate", value: `${(RISK_FREE_RATE * 100).toFixed(2)}% (fixed estimate of the US 3-month T-bill yield from early 2025, not a live rate)` },
    { label: "Pairwise correlation ρ", value: `${ASSUMED_CORRELATION} (moderate positive, assumed uniform)` },
    { label: "Historical window", value: "~6 months of daily closes (Yahoo Finance, split-adjusted, dividends excluded)" },
    { label: "Annualization factor", value: "252 trading days / year" },
    { label: "Monte Carlo model", value: "Geometric Brownian Motion (GBM), lognormal returns" },
    { label: "Monte Carlo paths", value: `${NUM_SIMULATIONS.toLocaleString()} simulations, monthly time steps` },
    { label: "VaR confidence", value: "95% parametric (normal distribution assumed)" },
    { label: "Drift correction", value: "μ − σ²/2 (Itô's lemma adjustment for GBM)" },
  ];

  // Strip internal _dailyReturns/_closes arrays from the returned holding stats
  const cleanHoldings: HoldingStats[] = holdingStats.map(
    ({ _dailyReturns: _d, _closes: _c, ...h }) => h
  );

  return {
    portfolioValue,
    cashAmount: cash,
    cashWeight,
    holdings: cleanHoldings,
    portfolioAnnualReturn,
    portfolioAnnualVol,
    portfolioSharpe,
    hhi,
    var95Daily,
    var95Pct,
    cvar95Daily,
    monteCarlo,
    scores,
    allocationTargets,
    assumptions,
    dataSources,
    excludedHoldings,
  };
}
