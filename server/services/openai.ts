import OpenAI from "openai";
import { type Portfolio, type RiskTolerance, type Timeline } from "@shared/schema";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key" 
});

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

export async function analyzePortfolio(
  cash: number,
  investments: string,
  riskTolerance: RiskTolerance,
  timeline: Timeline
): Promise<PortfolioAnalysis> {
  try {
    const prompt = `
Analyze this investment portfolio and provide recommendations in JSON format:

Portfolio Details:
- Available Cash: $${cash}
- Current Investments: ${investments}
- Risk Tolerance: ${riskTolerance}
- Investment Timeline: ${timeline}

Please provide analysis in this exact JSON format:
{
  "recommendations": [
    {
      "symbol": "STOCK_SYMBOL",
      "name": "Company Name",
      "action": "BUY" or "SELL",
      "confidence": number (1-100),
      "reasoning": "detailed explanation",
      "targetPrice": number (optional),
      "currentPrice": number (optional),
      "expectedReturn": number (percentage, optional),
      "recommendedAmount": number (dollar amount, optional)
    }
  ],
  "riskAssessment": {
    "level": "Low/Medium/High",
    "score": number (1-100),
    "explanation": "risk analysis explanation"
  },
  "marketSentiment": "overall market sentiment analysis",
  "riskAlert": "any important warnings or alerts (optional)"
}

Guidelines:
- Provide 3-5 specific, actionable recommendations
- Consider the user's risk tolerance and timeline
- Include both buy and sell recommendations if appropriate
- Be specific about allocation amounts
- Provide clear reasoning for each recommendation
- Consider current market conditions
- Include proper risk warnings
`;

    const response = await openai.chat.completions.create({
      model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
      messages: [
        {
          role: "system",
          content: "You are an expert financial advisor and investment analyst. Provide detailed, actionable investment recommendations based on the user's portfolio and preferences. Always respond with valid JSON format."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const analysis: PortfolioAnalysis = JSON.parse(content);
    
    // Validate the response structure
    if (!analysis.recommendations || !Array.isArray(analysis.recommendations)) {
      throw new Error("Invalid response structure from OpenAI");
    }

    return analysis;
  } catch (error) {
    console.error("OpenAI API Error:", error);
    throw new Error(`Failed to analyze portfolio: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

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

export async function suggestInvestment(
  amount: number,
  riskTolerance: string,
  goal?: string
): Promise<InvestPlan> {
  const prompt = `
A user wants to invest $${amount} right now.
Risk tolerance: ${riskTolerance}
${goal ? `Investment goal: ${goal}` : ""}

Suggest a specific, actionable investment plan allocating the full $${amount} across stocks, ETFs, or funds.
Today's date: ${new Date().toISOString().split("T")[0]}

Respond in this exact JSON format:
{
  "totalAmount": ${amount},
  "suggestions": [
    {
      "symbol": "TICKER",
      "name": "Full Company/Fund Name",
      "amount": number (dollar amount to invest),
      "allocationPercent": number (percentage of total),
      "reasoning": "why this investment makes sense right now",
      "confidence": number (1-100),
      "assetType": "Stock" | "ETF" | "Index Fund" | "Bond ETF"
    }
  ],
  "summary": "brief overall strategy summary",
  "riskNote": "important risk warning for this allocation"
}

Rules:
- All suggestion amounts must sum to exactly $${amount}
- Provide 3-6 specific investments with real ticker symbols
- Match the risk tolerance: conservative = more bonds/ETFs, aggressive = more growth stocks
- Base suggestions on current market conditions and diversification principles
`;

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: "You are an expert financial advisor. Always respond with valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No response from AI");
  return JSON.parse(content);
}

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

  const prompt = `
Analyze price patterns for ${ticker} (${companyName}).

Here are the major dips and peaks over the past ~100 trading days, with news headlines from around each event:

${eventsText}

Identify patterns between news events and price movements. Look for:
- What types of news cause dips vs peaks
- Recurring triggers (earnings, macro news, sector events, etc.)
- How long moves typically last
- Any predictive signals

Respond in this exact JSON format:
{
  "ticker": "${ticker}",
  "patternSummary": "2-3 sentence overview of what drives this stock's price movements",
  "patterns": [
    {
      "name": "Pattern name",
      "description": "what the pattern is",
      "occurrences": number,
      "reliability": "High/Medium/Low",
      "tradingImplication": "what a trader should do when they see this signal"
    }
  ],
  "keyInsights": ["insight 1", "insight 2", "insight 3"],
  "whatToWatchFor": "What news/events to monitor for future price moves"
}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content: "You are a quantitative analyst specializing in stock pattern recognition. Always respond with valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No response from AI");
  return JSON.parse(content);
}

export async function getRiskAssessment(
  investments: string,
  riskTolerance: RiskTolerance
): Promise<{ level: string; score: number; explanation: string }> {
  try {
    const prompt = `
Assess the risk level of this investment portfolio:

Current Investments: ${investments}
Stated Risk Tolerance: ${riskTolerance}

Provide a risk assessment in this JSON format:
{
  "level": "Low/Medium/High",
  "score": number (1-100, where 1 is very low risk and 100 is very high risk),
  "explanation": "detailed explanation of the risk assessment"
}
`;

    const response = await openai.chat.completions.create({
      model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
      messages: [
        {
          role: "system",
          content: "You are a risk assessment specialist. Analyze investment portfolios and provide detailed risk evaluations."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    return JSON.parse(content);
  } catch (error) {
    console.error("Risk Assessment Error:", error);
    throw new Error(`Failed to assess risk: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
