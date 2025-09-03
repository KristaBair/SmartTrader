import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyzePortfolio, getRiskAssessment } from "./services/openai";
import { portfolioFormSchema } from "@shared/schema";
import { z } from "zod";
import { setupAuth, isAuthenticated } from "./replitAuth";
import multer from "multer";
import OpenAI from "openai";

export async function registerRoutes(app: Express): Promise<Server> {
  // Configure multer for image uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed'));
      }
    },
  });

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Portfolio routes
  app.post("/api/portfolios", isAuthenticated, async (req: any, res) => {
    try {
      const validatedData = portfolioFormSchema.parse(req.body);
      
      // Parse investments string into structured data
      const investmentsText = validatedData.investments;
      const investmentEntries = investmentsText.split(',').map(entry => {
        const [symbol, amount] = entry.trim().split(':');
        return {
          symbol: symbol?.trim() || '',
          name: symbol?.trim() || '',
          amount: parseFloat(amount?.replace(/[$,\s]/g, '') || '0'),
          currentValue: parseFloat(amount?.replace(/[$,\s]/g, '') || '0'),
        };
      }).filter(entry => entry.symbol && entry.amount > 0);

      const userId = req.user.claims.sub;
      const portfolioData = {
        userId: userId,
        cash: validatedData.cash,
        investments: investmentEntries,
        initialInvestment: validatedData.initialInvestment || "0",
        monthlyContribution: validatedData.monthlyContribution || "0",
        totalContributions: validatedData.initialInvestment || "0",
        riskTolerance: validatedData.riskTolerance,
        timeline: validatedData.timeline,
      };

      // Check if user already has a portfolio
      const existingPortfolio = await storage.getPortfolioByUserId(userId);
      
      let portfolio;
      if (existingPortfolio) {
        portfolio = await storage.updatePortfolio(existingPortfolio.id, portfolioData);
      } else {
        portfolio = await storage.createPortfolio(portfolioData);
      }

      res.json(portfolio);
    } catch (error) {
      console.error("Portfolio creation error:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Validation error", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create portfolio" });
      }
    }
  });

  app.get("/api/portfolios/user/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const portfolio = await storage.getPortfolioByUserId(userId);
      
      if (!portfolio) {
        res.status(404).json({ message: "Portfolio not found" });
        return;
      }

      res.json(portfolio);
    } catch (error) {
      console.error("Portfolio fetch error:", error);
      res.status(500).json({ message: "Failed to fetch portfolio" });
    }
  });

  // AI Analysis routes
  app.post("/api/portfolios/:id/analyze", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const portfolio = await storage.getPortfolio(id);

      if (!portfolio) {
        res.status(404).json({ message: "Portfolio not found" });
        return;
      }

      // Convert investments to string format for OpenAI
      const investmentsText = portfolio.investments
        .map(inv => `${inv.symbol}: $${inv.amount}`)
        .join(', ');

      const analysis = await analyzePortfolio(
        parseFloat(portfolio.cash),
        investmentsText,
        portfolio.riskTolerance as any,
        portfolio.timeline as any
      );

      // Clear existing recommendations
      await storage.deleteRecommendationsByPortfolio(id);

      // Save new recommendations
      const recommendations = await Promise.all(
        analysis.recommendations.map(rec =>
          storage.createRecommendation({
            portfolioId: id,
            symbol: rec.symbol,
            name: rec.name,
            action: rec.action,
            confidence: rec.confidence,
            reasoning: rec.reasoning,
            targetPrice: rec.targetPrice?.toString(),
            currentPrice: rec.currentPrice?.toString(),
            expectedReturn: rec.expectedReturn?.toString(),
            recommendedAmount: rec.recommendedAmount?.toString(),
          })
        )
      );

      res.json({
        recommendations,
        riskAssessment: analysis.riskAssessment,
        marketSentiment: analysis.marketSentiment,
        riskAlert: analysis.riskAlert,
      });
    } catch (error) {
      console.error("Portfolio analysis error:", error);
      res.status(500).json({ 
        message: "Failed to analyze portfolio", 
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/portfolios/:id/recommendations", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const recommendations = await storage.getRecommendationsByPortfolio(id);
      res.json(recommendations);
    } catch (error) {
      console.error("Recommendations fetch error:", error);
      res.status(500).json({ message: "Failed to fetch recommendations" });
    }
  });

  // Risk assessment route
  app.post("/api/risk-assessment", isAuthenticated, async (req: any, res) => {
    try {
      const { investments, riskTolerance } = req.body;
      
      if (!investments || !riskTolerance) {
        res.status(400).json({ message: "Investments and risk tolerance are required" });
        return;
      }

      const assessment = await getRiskAssessment(investments, riskTolerance);
      res.json(assessment);
    } catch (error) {
      console.error("Risk assessment error:", error);
      res.status(500).json({ 
        message: "Failed to assess risk",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Market data routes
  app.get("/api/market-data", async (req, res) => {
    try {
      const marketData = await storage.getAllMarketData();
      res.json(marketData);
    } catch (error) {
      console.error("Market data fetch error:", error);
      res.status(500).json({ message: "Failed to fetch market data" });
    }
  });

  // Transaction routes
  app.post("/api/transactions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { portfolioId, symbol, name, action, quantity, price, totalAmount, fees, notes } = req.body;
      
      if (!portfolioId || !symbol || !name || !action || !quantity || !price || !totalAmount) {
        res.status(400).json({ message: "Missing required transaction fields" });
        return;
      }

      const transaction = await storage.createTransaction({
        portfolioId,
        userId: userId,
        symbol,
        name,
        action,
        quantity: quantity.toString(),
        price: price.toString(),
        totalAmount: totalAmount.toString(),
        fees: fees?.toString(),
        notes,
      });

      res.json(transaction);
    } catch (error) {
      console.error("Transaction creation error:", error);
      res.status(500).json({ message: "Failed to create transaction" });
    }
  });

  app.get("/api/portfolios/:id/transactions", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      const transactions = await storage.getTransactionsByPortfolio(id);
      res.json(transactions);
    } catch (error) {
      console.error("Transactions fetch error:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  app.get("/api/users/:userId/transactions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const transactions = await storage.getTransactionsByUser(userId);
      res.json(transactions);
    } catch (error) {
      console.error("User transactions fetch error:", error);
      res.status(500).json({ message: "Failed to fetch user transactions" });
    }
  });

  // Desktop Notifier API endpoint (CORS enabled for local HTML files)
  app.get("/api/notifier/recommendations", async (req, res) => {
    // Set CORS headers for the desktop notifier
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET');
    
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'API Key required' });
      }

      const apiKey = authHeader.substring(7);
      
      // For demo purposes, accept any API key that looks like a valid format
      // In production, you'd validate against stored API keys
      if (!apiKey || apiKey.length < 10) {
        return res.status(401).json({ message: 'Invalid API Key' });
      }

      // Get sample recommendations (in production, you'd get user-specific data)
      const sampleRecommendations = [
        {
          id: 'notifier-1',
          symbol: 'AAPL',
          name: 'Apple Inc.',
          action: 'BUY',
          confidence: 0.82,
          reasoning: 'Strong quarterly earnings and product innovation pipeline.',
          createdAt: new Date()
        },
        {
          id: 'notifier-2',
          symbol: 'TSLA',
          name: 'Tesla, Inc.',
          action: 'HOLD',
          confidence: 0.75,
          reasoning: 'Volatility expected, but long-term outlook remains positive.',
          createdAt: new Date()
        },
        {
          id: 'notifier-3',
          symbol: 'SPY',
          name: 'SPDR S&P 500 ETF',
          action: 'BUY',
          confidence: 0.88,
          reasoning: 'Broad market exposure recommended for portfolio diversification.',
          createdAt: new Date()
        }
      ];

      res.json({
        recommendations: sampleRecommendations,
        timestamp: new Date().toISOString(),
        status: 'success'
      });
    } catch (error) {
      console.error('Notifier API error:', error);
      res.status(500).json({ message: 'Failed to fetch recommendations' });
    }
  });

  // Handle CORS preflight for notifier API
  app.options("/api/notifier/recommendations", (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.sendStatus(200);
  });

  // Image processing endpoint for portfolio data extraction
  app.post('/api/portfolio/extract-from-image', upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No image file provided' });
      }

      const imageBuffer = req.file.buffer;
      const base64Image = imageBuffer.toString('base64');
      const mimeType = req.file.mimetype;

      // Use OpenAI Vision to analyze the image
      const response = await openai.chat.completions.create({
        model: "gpt-4o", // GPT-4 with vision capabilities
        messages: [
          {
            role: "system",
            content: `You are a financial data extraction expert. Analyze the provided portfolio screenshot and extract the following information:

1. Available cash balance
2. Individual stock/ETF positions with their symbols and current values
3. Initial investment amount (if visible)
4. Monthly contribution amount (if visible)

Return the data in this exact JSON format:
{
  "cash": "dollar amount as string (e.g., '5000')",
  "investments": "comma-separated list of symbol:amount pairs (e.g., 'AAPL: $5000, GOOGL: $3000, SPY: $2000')",
  "initialInvestment": "dollar amount as string (e.g., '50000') or empty if not found",
  "monthlyContribution": "dollar amount as string (e.g., '1000') or empty if not found"
}

Extract only the numbers without dollar signs for cash, initialInvestment, and monthlyContribution. For investments, use the format shown above with symbols and dollar amounts.

If you cannot find specific information, leave those fields empty. Focus on accuracy over completeness.`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Please extract portfolio data from this brokerage account screenshot:"
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 1000,
      });

      const extractedData = JSON.parse(response.choices[0].message.content || '{}');
      
      // Validate and clean up the extracted data
      const portfolioData = {
        cash: extractedData.cash || '',
        investments: extractedData.investments || '',
        initialInvestment: extractedData.initialInvestment || '',
        monthlyContribution: extractedData.monthlyContribution || '',
      };

      console.log('Extracted portfolio data:', portfolioData);
      res.json(portfolioData);

    } catch (error) {
      console.error('Image processing error:', error);
      res.status(500).json({ 
        message: 'Failed to process image', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  });

  // Financial Chat API for onboarding
  app.post("/api/financial-chat", async (req, res) => {
    try {
      const { message, chatHistory, savingsAmount, contributionFrequency, contributionAmount } = req.body;
      
      const contributionInfo = contributionFrequency && contributionAmount ? 
        (contributionFrequency === 'irregular' 
          ? ` They plan to add money irregularly/as needed, roughly $${contributionAmount} when they can.`
          : ` They plan to contribute $${contributionAmount} ${contributionFrequency} to their investments.`
        ) : '';
      
      const systemPrompt = `You are a helpful financial advisor AI assistant. The user has $${savingsAmount} in savings and wants to start investing.${contributionInfo}

Your job is to:
1. Ask questions about their financial goals, timeline, risk tolerance, and current financial situation
2. Be conversational and friendly
3. Consider their planned contribution schedule when discussing investment strategies
4. Once you have enough information about their goals and risk tolerance, set readyForSuggestions to true
5. Keep responses concise but informative

Current conversation context: The user has $${savingsAmount} in savings and is new to investing.${contributionInfo}`;

      // Build messages array for OpenAI
      const messages = [
        { role: "system", content: systemPrompt },
        ...chatHistory,
        { role: "user", content: message }
      ];

      const response = await openai.chat.completions.create({
        model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
        messages: messages,
        max_tokens: 300,
        temperature: 0.7,
      });

      const aiReply = response.choices[0].message.content || "";
      
      // Simple logic to determine if we have enough context for suggestions
      const totalMessages = chatHistory.length + 1;
      const readyForSuggestions = totalMessages >= 4 || 
        aiReply.toLowerCase().includes("ready") ||
        aiReply.toLowerCase().includes("suggest") ||
        aiReply.toLowerCase().includes("recommend");

      res.json({
        reply: aiReply,
        readyForSuggestions
      });

    } catch (error) {
      console.error("Financial chat error:", error);
      res.status(500).json({ message: "Failed to process chat message" });
    }
  });

  // Generate Investment Suggestions API
  app.post("/api/generate-investment-suggestions", async (req, res) => {
    try {
      const { savingsAmount, chatHistory, contributionFrequency, contributionAmount } = req.body;
      
      // Extract goals and preferences from chat history
      const conversationSummary = chatHistory
        .filter((msg: any) => msg.role === "user")
        .map((msg: any) => msg.content)
        .join(" ");

      const contributionInfo = contributionFrequency && contributionAmount ? 
        (contributionFrequency === 'irregular'
          ? `\nIrregular contributions: roughly $${contributionAmount} when possible`
          : `\nRegular contributions: $${contributionAmount} ${contributionFrequency}`
        ) : '';

      const suggestionPrompt = `Based on this user's conversation and financial situation, create a personalized investment plan.

User has: $${savingsAmount} in savings${contributionInfo}
Conversation summary: ${conversationSummary}

Create a JSON response with investment recommendations that include:
1. An emergency fund (3-6 months expenses)
2. Diversified investment allocation based on their goals and risk tolerance
3. ${contributionFrequency === 'irregular' 
    ? 'Consider their flexible contribution approach - suggest simple, accessible investments they can easily add to when they have extra money'
    : 'Consider their regular contribution schedule for dollar-cost averaging strategies'}
4. Specific categories like: Emergency Fund, Index Funds, Bonds, Individual Stocks, etc.

Format as JSON:
{
  "recommendations": [
    {
      "category": "Emergency Fund",
      "suggestedAmount": number,
      "percentage": number,
      "explanation": "string explaining why this allocation"
    }
  ],
  "overallStrategy": "string explaining the overall approach${contributionFrequency === 'irregular' ? ' for irregular contributions' : ' and how to use regular contributions'}",
  "nextSteps": ["array of action items${contributionFrequency === 'irregular' ? '' : ' including how to set up automatic investing'}"]
}

Make suggestions realistic and appropriate for a beginner investor. ${contributionFrequency === 'irregular' 
  ? 'For irregular contributors, focus on simple, flexible investments they can easily add to when they have extra money.'
  : 'If they have regular contributions planned, emphasize dollar-cost averaging and automatic investment strategies.'}`;

      const response = await openai.chat.completions.create({
        model: "gpt-5", // the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
        messages: [
          { role: "system", content: "You are a professional financial advisor providing investment allocation suggestions." },
          { role: "user", content: suggestionPrompt }
        ],
        response_format: { type: "json_object" },
        max_tokens: 800,
        temperature: 0.3,
      });

      const suggestions = JSON.parse(response.choices[0].message.content || '{}');
      
      res.json(suggestions);

    } catch (error) {
      console.error("Investment suggestions error:", error);
      res.status(500).json({ message: "Failed to generate investment suggestions" });
    }
  });

  // Save Onboarding Data API
  app.post("/api/onboarding", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { onboardingType, savingsAmount, chatHistory, investmentSuggestions } = req.body;
      
      // Check if user already has onboarding data
      const existingData = await storage.getOnboardingDataByUserId(userId);
      
      let onboardingData;
      if (existingData) {
        // Update existing data
        onboardingData = await storage.updateOnboardingData(existingData.id, {
          onboardingType,
          savingsAmount: savingsAmount?.toString(),
          chatHistory,
          investmentSuggestions,
          completed: new Date(),
        });
      } else {
        // Create new onboarding data
        onboardingData = await storage.createOnboardingData({
          userId,
          onboardingType,
          savingsAmount: savingsAmount?.toString(),
          chatHistory,
          investmentSuggestions,
          completed: new Date(),
        });
      }
      
      res.json(onboardingData);
    } catch (error) {
      console.error("Save onboarding data error:", error);
      res.status(500).json({ message: "Failed to save onboarding data" });
    }
  });

  // Get Onboarding Data API
  app.get("/api/onboarding/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const onboardingData = await storage.getOnboardingDataByUserId(userId);
      
      res.json(onboardingData || null);
    } catch (error) {
      console.error("Get onboarding data error:", error);
      res.status(500).json({ message: "Failed to get onboarding data" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
