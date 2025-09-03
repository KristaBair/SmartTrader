import OpenAI from "openai";
import { type MarketEvent, type InsertMarketEvent, type UserAlert, type InsertUserAlert } from "@shared/schema";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_ENV_VAR || "default_key" 
});

export interface NewsEvent {
  title: string;
  description: string;
  publishedAt: Date;
  sourceUrl?: string;
}

export interface MarketAnalysis {
  eventType: string;
  affectedSymbol?: string;
  tone: 'positive' | 'negative' | 'neutral';
  impactLevel: 'low' | 'medium' | 'high';
  confidence: number;
  aiAnalysis: {
    reasoning: string;
    priceImpactPrediction: string;
    tradingRecommendation: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
    keyFactors: string[];
    riskLevel: string;
  };
}

export async function analyzeNewsEvent(newsEvent: NewsEvent): Promise<MarketAnalysis> {
  try {
    const analysisPrompt = `
Analyze this market news event and provide structured analysis in JSON format:

Event Title: ${newsEvent.title}
Event Description: ${newsEvent.description}
Published At: ${newsEvent.publishedAt.toISOString()}
Source: ${newsEvent.sourceUrl || 'N/A'}

Please analyze this news event and provide the following in JSON format:
{
  "eventType": "string (regulatory, earnings, merger, lawsuit, product_launch, economic_data, etc.)",
  "affectedSymbol": "string (stock ticker if specific company affected, null if market-wide)",
  "tone": "positive | negative | neutral (market sentiment)",
  "impactLevel": "low | medium | high (expected market impact)",
  "confidence": "number (1-100, your confidence in this analysis)",
  "aiAnalysis": {
    "reasoning": "string (detailed explanation of your analysis)",
    "priceImpactPrediction": "string (specific prediction about price movement)",
    "tradingRecommendation": "BUY | SELL | HOLD | WATCH",
    "keyFactors": ["array of key factors that influence this recommendation"],
    "riskLevel": "string (low/medium/high risk assessment)"
  }
}

Guidelines:
- Focus on factual analysis based on the event details
- Consider both short-term and long-term market implications
- Be specific about which companies/sectors are affected
- Provide clear reasoning for your recommendation
- Consider risk factors and potential downsides
- If the event affects a specific company, include its stock symbol
`;

    const response = await openai.chat.completions.create({
      model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
      messages: [
        {
          role: "system",
          content: "You are an expert financial analyst and market intelligence specialist. Analyze news events for their market impact and provide structured trading insights."
        },
        {
          role: "user",
          content: analysisPrompt
        }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1000,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const analysis: MarketAnalysis = JSON.parse(content);
    
    // Validate the response structure
    if (!analysis.eventType || !analysis.tone || !analysis.impactLevel) {
      throw new Error("Invalid analysis structure from OpenAI");
    }

    return analysis;
  } catch (error) {
    console.error("Market Analysis Error:", error);
    throw new Error(`Failed to analyze news event: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function generateAlertMessage(event: MarketEvent): string {
  const symbol = event.affectedSymbol ? `${event.affectedSymbol} ` : '';
  const impact = event.impactLevel.toUpperCase();
  
  switch (event.aiAnalysis?.tradingRecommendation) {
    case 'BUY':
      return `🚀 BUY OPPORTUNITY: ${symbol}${event.title}. ${impact} impact expected. AI Confidence: ${event.confidence}%`;
    case 'SELL':
      return `⚠️ SELL SIGNAL: ${symbol}${event.title}. ${impact} impact expected. AI Confidence: ${event.confidence}%`;
    case 'WATCH':
      return `👀 WATCH: ${symbol}${event.title}. ${impact} impact expected. Monitor closely.`;
    default:
      return `📊 MARKET UPDATE: ${symbol}${event.title}. ${impact} impact expected.`;
  }
}

export function shouldGenerateAlert(analysis: MarketAnalysis): boolean {
  // Generate alerts for high-impact events or high-confidence buy/sell recommendations
  return (
    analysis.impactLevel === 'high' ||
    (analysis.confidence >= 75 && ['BUY', 'SELL'].includes(analysis.aiAnalysis.tradingRecommendation)) ||
    analysis.aiAnalysis.tradingRecommendation === 'BUY' // Always alert for buy opportunities
  );
}

// Mock news feed - In production, this would connect to a real news API
export function getMockNewsEvents(): NewsEvent[] {
  return [
    {
      title: "Google Antitrust Ruling: Court Orders Operational Changes But Avoids Breakup",
      description: "A federal judge issued a landmark decision in the U.S. government's search monopoly case against Google. The ruling determined that Google holds an illegal monopoly but stopped short of breaking up the company. Instead, the judge ordered Google to implement significant changes to its search engine practices, including requirements to share search data with competitors to increase market fairness. The announcement was released on September 2, 2025, around 3:30 p.m. ET. Immediately following the announcement, Google's stock price rose approximately 8%, as investors perceived the ruling as less severe than feared (no breakup, only operational changes).",
      publishedAt: new Date('2025-09-02T19:30:00Z'),
      sourceUrl: 'https://example.com/google-antitrust-ruling'
    },
    {
      title: "Tesla Reports Record Q3 Deliveries, Beating Analyst Expectations",
      description: "Tesla announced record-breaking third-quarter vehicle deliveries, surpassing analyst expectations by 15%. The company delivered 485,000 vehicles globally, driven by strong demand for the Model Y and successful international expansion. CEO Elon Musk attributed the success to improved production efficiency and new gigafactory capacity.",
      publishedAt: new Date('2025-09-03T14:00:00Z'),
      sourceUrl: 'https://example.com/tesla-q3-deliveries'
    }
  ];
}