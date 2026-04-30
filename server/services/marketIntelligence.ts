// AI-powered news analysis used by the Market Intelligence page.
// Takes a raw news article and asks GPT to classify it, assess its market impact,
// and decide whether it looks like a buy, sell, hold, or watch situation.

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface NewsEvent {
  title: string;
  description: string;
  publishedAt: Date;
  sourceUrl?: string;
}

export interface MarketAnalysis {
  eventType: string;
  affectedSymbol?: string;
  tone: "positive" | "negative" | "neutral";
  impactLevel: "low" | "medium" | "high";
  confidence: number;
  aiAnalysis: {
    reasoning: string;
    priceImpactPrediction: string;
    tradingRecommendation: "BUY" | "SELL" | "HOLD" | "WATCH";
    keyFactors: string[];
    riskLevel: string;
  };
}

export async function analyzeNewsEvent(event: NewsEvent): Promise<MarketAnalysis> {
  const prompt = `Analyze this financial news event and return structured JSON.

Title: ${event.title}
Description: ${event.description}
Published: ${event.publishedAt.toISOString()}
Source: ${event.sourceUrl || "N/A"}

Return this exact JSON shape:
{
  "eventType": "one of: regulatory, earnings, merger, lawsuit, product_launch, economic_data, other",
  "affectedSymbol": "stock ticker if a specific company is affected, otherwise null",
  "tone": "positive | negative | neutral",
  "impactLevel": "low | medium | high",
  "confidence": number from 1 to 100,
  "aiAnalysis": {
    "reasoning": "plain English explanation of what this means for investors",
    "priceImpactPrediction": "what you expect to happen to the stock or market price",
    "tradingRecommendation": "BUY | SELL | HOLD | WATCH",
    "keyFactors": ["factor 1", "factor 2", "factor 3"],
    "riskLevel": "low | medium | high"
  }
}`;

  const response = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content:
          "You are an expert financial analyst. Analyze news events for their market impact and return valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 1000,
  });

  const content = response.choices[0].message.content;
  if (!content) throw new Error("No response from OpenAI");

  const analysis: MarketAnalysis = JSON.parse(content);

  if (!analysis.eventType || !analysis.tone || !analysis.impactLevel) {
    throw new Error("AI returned an incomplete analysis structure");
  }

  return analysis;
}
