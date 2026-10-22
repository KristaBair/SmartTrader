// All Bedrock calls that produce investment analysis live here.
// Each function has one job: build a prompt, call the model, and return a typed result.

import { type RiskTolerance, type Timeline } from "@shared/schema";
import { converseJson } from "./bedrock";
import { getMultipleQuotes } from "./finnhub";
import { applyVerifiedPrices, formatQuotesForPrompt, type QuoteMap } from "./verifiedPrices";

// ── Portfolio analysis ──────────────────────────────────────────────────────

export interface InvestmentRecommendation {
  symbol: string;
  name: string;
  action: "BUY" | "SELL";
  confidence: number;
  reasoning: string;
  targetPrice?: number;
  currentPrice?: number;
  expectedReturn?: number;
  recommendedAmount?: number;
  priceSource?: string;
  priceAsOf?: string;
  priceFreshness?: string;
}

export interface PortfolioAnalysis {
  recommendations: InvestmentRecommendation[];
  riskAssessment: {
    level: string;
    score: number;
    explanation: string;
  };
  marketSentiment: string;
  riskAlert?: string;
}

// Takes the user's cash, holdings, risk profile, and timeline and asks the model
// for 3 to 5 ranked buy/sell recommendations with reasoning. The model is given
// verified quotes for the holdings, and every currentPrice in the result is
// replaced with a verified quote (or removed), so no price comes from the model.
export async function analyzePortfolio(
  cash: number,
  investments: string,
  riskTolerance: RiskTolerance,
  timeline: Timeline,
  heldSymbols: string[] = [],
  linkedInvestmentSummary?: string
): Promise<PortfolioAnalysis> {
  const quotes: QuoteMap = heldSymbols.length > 0
    ? await getMultipleQuotes(heldSymbols.map((s) => s.toUpperCase()))
    : {};

  const prompt = `Analyze this investment portfolio and return recommendations in JSON.

Portfolio:
- Cash available: $${cash}
- Current holdings (symbol: average cost per share): ${investments}
- Risk tolerance: ${riskTolerance}
- Timeline: ${timeline}
${linkedInvestmentSummary ? `
User-authorized linked investment holdings:
${linkedInvestmentSummary}
These institution-reported values may be cached and may overlap with manually entered holdings. Do not double-count overlapping positions, and do not treat institution values as live market quotes.
` : ""}

Verified market data (the only current prices you may rely on):
${formatQuotesForPrompt(quotes)}

Data rules:
- Do not state a current price, earnings figure, or other market fact that is not in the verified data above. Omit "currentPrice" for any ticker not listed.
- "targetPrice" and "expectedReturn" are your own estimates. Include them only if your reasoning justifies them; otherwise omit them.
- "confidence" is your subjective confidence in the reasoning, not a statistical probability of profit.
- If the data is not enough to support a recommendation, say so in the reasoning.

Return this exact JSON shape:
{
  "recommendations": [
    {
      "symbol": "TICKER",
      "name": "Company Name",
      "action": "BUY or SELL",
      "confidence": number from 1 to 100,
      "reasoning": "plain English explanation",
      "targetPrice": optional number,
      "currentPrice": optional number,
      "expectedReturn": optional percentage number,
      "recommendedAmount": optional dollar amount
    }
  ],
  "riskAssessment": {
    "level": "Low | Medium | High",
    "score": number from 1 to 100,
    "explanation": "what makes this portfolio more or less risky"
  },
  "marketSentiment": "brief overall market commentary",
  "riskAlert": "important warning if applicable, otherwise omit"
}

Give 3 to 5 specific, actionable recommendations. Consider the user's risk tolerance and timeline.`;

  const analysis = await converseJson<PortfolioAnalysis>({
    system:
      "You are an expert financial advisor. Provide actionable recommendations based on the user's portfolio. Always respond with valid JSON.",
    prompt,
    maxTokens: 2000,
  });
  if (!analysis.recommendations || !Array.isArray(analysis.recommendations)) {
    throw new Error("AI returned an invalid portfolio analysis structure");
  }

  // Look up anything the model recommended that we haven't quoted yet.
  const missing = analysis.recommendations
    .map((r) => String(r.symbol ?? "").toUpperCase())
    .filter((sym) => sym && !(sym in quotes));
  const allQuotes = missing.length > 0
    ? { ...quotes, ...(await getMultipleQuotes(Array.from(new Set(missing)))) }
    : quotes;

  return { ...analysis, recommendations: applyVerifiedPrices(analysis.recommendations, allQuotes) };
}

// ── Smart Invest ────────────────────────────────────────────────────────────

export interface InvestSuggestion {
  symbol: string;
  name: string;
  amount: number;
  allocationPercent: number;
  reasoning: string;
  confidence: number;
  assetType: string;
}

export interface InvestPlan {
  totalAmount: number;
  suggestions: InvestSuggestion[];
  summary: string;
  riskNote: string;
}

// Given a dollar amount and risk tolerance, returns a complete allocation plan
// with specific tickers and dollar amounts that add up to the total.
export async function suggestInvestment(
  amount: number,
  riskTolerance: string,
  goal?: string
): Promise<InvestPlan> {
  const prompt = `A user wants to invest $${amount} right now.
Risk tolerance: ${riskTolerance}
${goal ? `Goal: ${goal}` : ""}
Today's date: ${new Date().toISOString().split("T")[0]}

Return a specific, actionable plan in this exact JSON shape:
{
  "totalAmount": ${amount},
  "suggestions": [
    {
      "symbol": "TICKER",
      "name": "Full Company or Fund Name",
      "amount": dollar amount to invest,
      "allocationPercent": percentage of total,
      "reasoning": "why this makes sense right now",
      "confidence": number from 1 to 100,
      "assetType": "Stock | ETF | Index Fund | Bond ETF"
    }
  ],
  "summary": "brief strategy overview",
  "riskNote": "important risk disclaimer"
}

Rules:
- All suggestion amounts must sum to exactly $${amount}
- Include 3 to 6 investments with real ticker symbols
- Match the risk profile: conservative leans toward bonds and ETFs, aggressive leans toward growth stocks`;

  return converseJson<InvestPlan>({
    system: "You are an expert financial advisor. Respond with valid JSON only.",
    prompt,
    maxTokens: 2000,
  });
}

// ── Pattern Analyzer ────────────────────────────────────────────────────────

export interface StockEvent {
  date: string;
  type: "DIP" | "PEAK";
  magnitude: number;
  price: number;
  priceChange: number;
  news: { title: string; source: string; publishedAt: string }[];
}

export interface PatternAnalysis {
  ticker: string;
  patternSummary: string;
  patterns: {
    name: string;
    description: string;
    occurrences: number;
    reliability: string;
    tradingImplication: string;
  }[];
  keyInsights: string[];
  whatToWatchFor: string;
}

// Takes the biggest price moves for a stock along with surrounding news headlines,
// then asks the model to identify recurring patterns and explain them in plain English.
export async function analyzeStockPatterns(
  ticker: string,
  companyName: string,
  events: StockEvent[]
): Promise<PatternAnalysis> {
  const eventsText = events
    .map(
      (e) =>
        `${e.date}: ${e.type} of ${e.magnitude.toFixed(1)}% (price $${e.price.toFixed(2)})\n` +
        (e.news.length > 0
          ? `  News: ${e.news.map((n) => n.title).join(" | ")}`
          : "  News: No major news found")
    )
    .join("\n\n");

  const prompt = `Look at the big price moves for ${ticker} (${companyName}) over the last several months.

${eventsText}

What news tends to move this stock up or down? What patterns keep repeating?
Use plain English that a regular person can understand. Avoid jargon.

Return this exact JSON:
{
  "ticker": "${ticker}",
  "patternSummary": "2 to 3 sentences on what usually moves this stock",
  "patterns": [
    {
      "name": "Short descriptive pattern name",
      "description": "What happens and why, in plain English",
      "occurrences": number,
      "reliability": "High | Medium | Low",
      "tradingImplication": "What should someone do when they see this?"
    }
  ],
  "keyInsights": ["insight 1", "insight 2", "insight 3"],
  "whatToWatchFor": "What kinds of news or events should investors track?"
}`;

  return converseJson<PatternAnalysis>({
    system: "You are a stock pattern analyst. Explain patterns clearly and return valid JSON only.",
    prompt,
    maxTokens: 2000,
  });
}
