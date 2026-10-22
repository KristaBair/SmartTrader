// AI-powered news analysis used by the Market Intelligence page.
// Takes a raw news article and asks the model to classify it, assess its market impact,
// and decide whether it looks like a buy, sell, hold, or watch situation.

import { converseJson } from "./bedrock";

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

  const analysis = await converseJson<MarketAnalysis>({
    system:
      "You are an expert financial analyst. Analyze news events for their market impact and return valid JSON only.",
    prompt,
    maxTokens: 1000,
  });

  if (!analysis.eventType || !analysis.tone || !analysis.impactLevel) {
    throw new Error("AI returned an incomplete analysis structure");
  }

  return analysis;
}
