// All GPT calls that produce investment analysis live here.
// Each function has one job: build a prompt, call the API, and return a typed result.

import OpenAI from "openai";
import { type RiskTolerance, type Timeline } from "@shared/schema";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// Takes the user's cash, holdings, risk profile, and timeline and asks GPT
// for 3 to 5 ranked buy/sell recommendations with reasoning.
export async function analyzePortfolio(
  cash: number,
  investments: string,
  riskTolerance: RiskTolerance,
  timeline: Timeline
): Promise<PortfolioAnalysis> {
  const prompt = `Analyze this investment portfolio and return recommendations in JSON.

Portfolio:
- Cash available: $${cash}
- Current holdings: ${investments}
- Risk tolerance: ${riskTolerance}
- Timeline: ${timeline}

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

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content:
          "You are an expert financial advisor. Provide actionable recommendations based on the user's portfolio. Always respond with valid JSON.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No response from OpenAI");

  const analysis: PortfolioAnalysis = JSON.parse(content);
  if (!analysis.recommendations || !Array.isArray(analysis.recommendations)) {
    throw new Error("AI returned an invalid portfolio analysis structure");
  }

  return analysis;
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

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      { role: "system", content: "You are an expert financial advisor. Respond with valid JSON only." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No response from AI");
  return JSON.parse(content);
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
// then asks GPT to identify recurring patterns and explain them in plain English.
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

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content:
          "You are a stock pattern analyst. Explain patterns clearly and return valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No response from AI");
  return JSON.parse(content);
}
