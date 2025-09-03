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
