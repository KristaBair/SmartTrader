// All API routes live here. Most are public (no auth needed) because user data
// is managed in localStorage on the client. The only routes that still use
// isAuthenticated are the legacy DB-backed portfolio endpoints.

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyzePortfolio, getRiskAssessment, suggestInvestment, analyzeStockPatterns, type StockEvent } from "./services/openai";
import { runQuantAnalysis } from "./services/quantAnalytics";
import { analyzeNewsEvent, generateAlertMessage, shouldGenerateAlert, getMockNewsEvents } from "./services/marketIntelligence";
import { getStockQuote, getMultipleQuotes, searchSymbol, getHistoricalPrices } from "./services/finnhub";
import { getFinancialNews, getStockNews, getTopHeadlines, getNewsByDateRange } from "./services/newsApi";
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

  // Public: analyze portfolio directly (no auth needed - localStorage-based frontend)
  app.post("/api/portfolios/analyze-direct", async (req, res) => {
    try {
      const { cash, investments, riskTolerance, timeline } = req.body;
      const analysis = await analyzePortfolio(
        parseFloat(cash) || 0,
        investments || "",
        (riskTolerance || "moderate") as any,
        (timeline || "long_term") as any
      );
      res.json(analysis);
    } catch (error) {
      console.error("Direct analysis error:", error);
      res.status(500).json({ message: "Analysis failed" });
    }
  });

  // Public: full quantitative portfolio analysis (Monte Carlo, VaR, scores, etc.)
  // This is the main analytics endpoint - it fetches real historical data for each
  // holding, runs all the statistical calculations, and returns a complete report.
  app.post("/api/quant/analyze", async (req, res) => {
    try {
      const { holdings, cash, riskTolerance, timeHorizon } = req.body;
      if (!Array.isArray(holdings) || holdings.length === 0) {
        return res.status(400).json({ message: "At least one holding is required" });
      }
      const report = await runQuantAnalysis(
        holdings,
        parseFloat(cash) || 0,
        (["conservative", "moderate", "aggressive"].includes(riskTolerance) ? riskTolerance : "moderate"),
        parseInt(timeHorizon) || 5
      );
      res.json(report);
    } catch (error) {
      console.error("Quant analysis error:", error);
      res.status(500).json({ message: "Quantitative analysis failed. Please try again." });
    }
  });

  // Public: investment suggestion based on amount
  app.post("/api/invest/suggest", async (req, res) => {
    try {
      const { amount, riskTolerance, goal } = req.body;
      if (!amount || isNaN(parseFloat(amount))) {
        return res.status(400).json({ message: "Valid amount is required" });
      }
      const plan = await suggestInvestment(parseFloat(amount), riskTolerance || "moderate", goal);
      res.json(plan);
    } catch (error) {
      console.error("Investment suggestion error:", error);
      res.status(500).json({ message: "Failed to generate investment suggestions" });
    }
  });

  // Public: stock pattern analysis
  app.post("/api/patterns/analyze", async (req, res) => {
    try {
      const { ticker } = req.body;
      if (!ticker) return res.status(400).json({ message: "Ticker is required" });

      const symbol = ticker.trim().toUpperCase();

      // 1. Fetch historical price data (last 100 trading days)
      const prices = await getHistoricalPrices(symbol, "compact");
      if (prices.length < 10) {
        return res.status(404).json({ message: `No price data found for ${symbol}. Check the ticker symbol.` });
      }

      // 2. Find significant single-day moves (>4%)
      const events: StockEvent[] = [];
      for (let i = 1; i < prices.length; i++) {
        const prev = prices[i - 1].close;
        const curr = prices[i].close;
        const change = ((curr - prev) / prev) * 100;
        if (Math.abs(change) >= 4) {
          events.push({
            date: prices[i].date,
            type: change > 0 ? "PEAK" : "DIP",
            magnitude: Math.abs(change),
            price: curr,
            priceChange: change,
            news: [],
          });
        }
      }

      // Sort by magnitude, keep top 6
      events.sort((a, b) => b.magnitude - a.magnitude);
      const topEvents = events.slice(0, 6).sort((a, b) => a.date.localeCompare(b.date));

      // 3. Fetch news for each event (7 days before the event)
      for (const event of topEvents) {
        const eventDate = new Date(event.date);
        const fromDate = new Date(eventDate);
        fromDate.setDate(fromDate.getDate() - 7);
        const from = fromDate.toISOString().split("T")[0];
        const to = event.date;

        const articles = await getNewsByDateRange(symbol, from, to);
        event.news = articles.map((a) => ({
          title: a.title,
          source: a.source,
          publishedAt: a.publishedAt,
        }));

        // Avoid rate limiting
        await new Promise((r) => setTimeout(r, 300));
      }

      // 4. Get current quote for company name
      const quote = await getStockQuote(symbol);
      const companyName = quote?.name || symbol;

      // 5. AI pattern analysis
      const analysis = await analyzeStockPatterns(symbol, companyName, topEvents);

      // Include price data summary for chart
      const priceHistory = prices.map((p) => ({ date: p.date, close: p.close, volume: p.volume }));

      res.json({
        ticker: symbol,
        companyName,
        currentPrice: quote?.price,
        priceChange: quote?.changePercent,
        priceHistory,
        events: topEvents,
        analysis,
      });
    } catch (error) {
      console.error("Pattern analysis error:", error);
      res.status(500).json({ message: "Pattern analysis failed. Please try again." });
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

  // Alpha Vantage stock data routes
  app.get("/api/stocks/quote/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const quote = await getStockQuote(symbol.toUpperCase());
      if (!quote) {
        return res.status(404).json({ message: `No data found for symbol: ${symbol}` });
      }
      res.json(quote);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stock quote" });
    }
  });

  app.post("/api/stocks/quotes", async (req, res) => {
    try {
      const { symbols } = req.body;
      if (!symbols || !Array.isArray(symbols)) {
        return res.status(400).json({ message: "symbols array is required" });
      }
      const quotes = await getMultipleQuotes(symbols.map((s: string) => s.toUpperCase()));
      res.json(quotes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stock quotes" });
    }
  });

  app.get("/api/stocks/search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== "string") {
        return res.status(400).json({ message: "Query parameter 'q' is required" });
      }
      const results = await searchSymbol(q);
      res.json(results);
    } catch (error) {
      res.status(500).json({ message: "Failed to search stocks" });
    }
  });

  // News API routes
  app.get("/api/news", async (req, res) => {
    try {
      const { q } = req.query;
      const articles = q
        ? await getFinancialNews(q as string)
        : await getTopHeadlines();
      res.json(articles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch news" });
    }
  });

  // Trading signals — polled every 3 min by the frontend.
  // Grabs the latest 10 financial headlines and asks GPT to spot BUY/SELL opportunities.
  // Only high-confidence signals (>70%) make it through so alerts feel meaningful, not spammy.
  app.get("/api/trading-signals", async (req, res) => {
    try {
      const articles = await getTopHeadlines();
      if (articles.length === 0) {
        return res.json({ signals: [], generatedAt: new Date().toISOString() });
      }

      // Build a compact news summary for GPT
      const newsSummary = articles
        .slice(0, 10)
        .map((a: any, i: number) => `${i + 1}. ${a.title}${a.description ? " — " + a.description.slice(0, 120) : ""}`)
        .join("\n");

      const signalPrompt = `You are a sharp trading analyst. Read these financial news headlines and identify clear, confident BUY or SELL signals for specific stocks or ETFs.

NEWS HEADLINES:
${newsSummary}

Rules:
- Only include signals where you have >70% confidence
- Only BUY or SELL (not HOLD/WATCH)
- Ticker must be a real US stock or ETF symbol
- Keep the reason under 15 words, plain English, no jargon
- Max 5 signals total
- If no strong signals exist, return an empty array

Respond in JSON only:
{
  "signals": [
    {
      "ticker": "SPY",
      "action": "BUY",
      "reason": "Fed rate pause boosts broad market outlook",
      "confidence": 82,
      "urgency": "high",
      "newsHeadline": "Federal Reserve signals pause in rate hikes"
    }
  ]
}`;

      const response = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [{ role: "user", content: signalPrompt }],
        max_tokens: 600,
        response_format: { type: "json_object" },
      });

      const raw = response.choices[0].message.content || '{"signals":[]}';
      const parsed = JSON.parse(raw);

      // Stamp a unique ID on each signal so the frontend can tell if it's already shown it
      const signals = (parsed.signals || []).map((s: any, i: number) => ({
        ...s,
        id: `${s.ticker}_${Date.now()}_${i}`,
      }));

      res.json({ signals, generatedAt: new Date().toISOString() });
    } catch (error) {
      console.error("Trading signals error:", error);
      // Return an empty list instead of an error — background polling should never interrupt the user
      res.json({ signals: [], generatedAt: new Date().toISOString() });
    }
  });

  app.get("/api/news/stock/:symbol", async (req, res) => {
    try {
      const { symbol } = req.params;
      const articles = await getStockNews(symbol.toUpperCase());
      res.json(articles);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch stock news" });
    }
  });

  // Market intelligence now powered by real news
  app.get("/api/news/analyze", async (req, res) => {
    try {
      const articles = await getTopHeadlines();
      if (articles.length === 0) {
        return res.json({ events: [], message: "No news available" });
      }
      // Analyze top 3 articles with AI for trading signals
      const analyzed = [];
      for (const article of articles.slice(0, 3)) {
        try {
          const event = await analyzeNewsEvent({
            title: article.title,
            description: article.description,
            sourceUrl: article.url,
            publishedAt: new Date(article.publishedAt),
          });
          analyzed.push({ ...event, url: article.url, source: article.source });
        } catch {
          // Skip articles that fail analysis
        }
      }
      res.json({ events: analyzed });
    } catch (error) {
      res.status(500).json({ message: "Failed to analyze news" });
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
  // Test endpoint to verify OpenAI API key is working
  app.get("/api/test-openai", async (req, res) => {
    try {
      console.log("Testing OpenAI API...");
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: "Say 'API key is working'" }],
        max_tokens: 50
      });
      console.log("Full OpenAI response:", JSON.stringify(response, null, 2));
      console.log("Message content:", response.choices[0].message.content);
      res.json({ 
        success: true, 
        message: response.choices[0].message.content,
        fullResponse: response.choices[0],
        apiKeyStatus: "working"
      });
    } catch (error) {
      console.error("OpenAI API test error:", error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        apiKeyStatus: "failed"
      });
    }
  });

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
        max_completion_tokens: 1000,
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
        max_completion_tokens: 300,
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

      const suggestionPrompt = `Based on this user's conversation and financial situation, create a specific investment plan with exact stock/ETF recommendations.

User has: $${savingsAmount} in savings${contributionInfo}
Conversation summary: ${conversationSummary}

Create a JSON response with SPECIFIC stock and ETF recommendations that include:
1. Emergency fund allocation 
2. Specific stocks and ETFs to buy with ticker symbols
3. Exact dollar amounts to invest in each
4. ${contributionFrequency === 'irregular' 
    ? 'Simple, accessible investments for flexible contributions'
    : 'Dollar-cost averaging strategy for regular contributions'}

Format as JSON:
{
  "recommendations": [
    {
      "category": "Emergency Fund",
      "ticker": "HYSA",
      "name": "High-Yield Savings Account",
      "suggestedAmount": number,
      "percentage": number,
      "explanation": "string explaining why this allocation",
      "action": "ALLOCATE"
    },
    {
      "category": "Index Fund",
      "ticker": "SPY",
      "name": "SPDR S&P 500 ETF",
      "suggestedAmount": number,
      "percentage": number,
      "explanation": "string explaining why this stock/ETF",
      "action": "BUY"
    }
  ],
  "overallStrategy": "string explaining the overall approach${contributionFrequency === 'irregular' ? ' for irregular contributions' : ' and how to use regular contributions'}",
  "nextSteps": ["array of specific action items with broker recommendations${contributionFrequency === 'irregular' ? '' : ' including how to set up automatic investing'}"]
}

IMPORTANT REQUIREMENTS:
- Include specific ticker symbols (SPY, QQQ, VTI, AAPL, MSFT, etc.)
- Provide exact dollar amounts to invest in each
- Mix of ETFs for diversification and individual stocks for growth
- Consider current market conditions and popular beginner-friendly investments
- Include at least 3-5 specific investment recommendations
- Make sure all amounts add up to their total savings amount

Popular beginner investments to consider:
- SPY (S&P 500), QQQ (Nasdaq), VTI (Total Stock Market)
- Individual stocks: AAPL, MSFT, GOOGL, AMZN, TSLA
- Bond ETFs: BND, TLT for conservative allocation

Make suggestions realistic and actionable with specific buy orders they can place.`;

      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a professional financial advisor providing investment allocation suggestions. Always respond with valid JSON format only." },
          { role: "user", content: suggestionPrompt }
        ],
        max_tokens: 1000,
      });

      let suggestions;
      try {
        suggestions = JSON.parse(response.choices[0].message.content || '{}');
      } catch (parseError) {
        // If JSON parsing fails, create a fallback response
        suggestions = {
          recommendations: [
            {
              category: "Emergency Fund",
              ticker: "HYSA",
              name: "High-Yield Savings Account",
              suggestedAmount: Math.floor(savingsAmount * 0.3),
              percentage: 30,
              explanation: "Essential emergency fund for 3-6 months of expenses",
              action: "ALLOCATE"
            },
            {
              category: "Index Fund",
              ticker: "SPY",
              name: "SPDR S&P 500 ETF",
              suggestedAmount: Math.floor(savingsAmount * 0.4),
              percentage: 40,
              explanation: "Broad market exposure for long-term growth",
              action: "BUY"
            },
            {
              category: "Technology Growth",
              ticker: "QQQ",
              name: "Invesco QQQ Trust",
              suggestedAmount: Math.floor(savingsAmount * 0.3),
              percentage: 30,
              explanation: "Technology-focused growth for higher returns",
              action: "BUY"
            }
          ],
          overallStrategy: "Balanced approach with emergency fund, broad market exposure, and growth potential",
          nextSteps: ["Open a brokerage account", "Set up automatic investing", "Review and rebalance quarterly"]
        };
      }
      
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

  // Market Intelligence API Routes
  
  // Process news and generate market events (admin/background task)
  app.post("/api/market-intelligence/process-news", async (req, res) => {
    try {
      const newsEvents = getMockNewsEvents(); // In production, this would fetch from news APIs
      const processedEvents = [];

      for (const newsEvent of newsEvents) {
        try {
          // Analyze the news event with AI
          const analysis = await analyzeNewsEvent(newsEvent);
          
          // Create market event in database
          const marketEvent = await storage.createMarketEvent({
            title: newsEvent.title,
            description: newsEvent.description,
            eventType: analysis.eventType,
            affectedSymbol: analysis.affectedSymbol || null,
            tone: analysis.tone,
            impactLevel: analysis.impactLevel,
            confidence: analysis.confidence,
            sourceUrl: newsEvent.sourceUrl || null,
            publishedAt: newsEvent.publishedAt,
            aiAnalysis: analysis.aiAnalysis,
          });

          // Generate alerts for users if criteria met
          if (shouldGenerateAlert(analysis)) {
            const alertMessage = generateAlertMessage(marketEvent);
            
            // For now, create alerts for all authenticated users
            // In production, this would be based on user preferences and watchlists
            const alertType = analysis.aiAnalysis.tradingRecommendation === 'BUY' ? 'buy_opportunity' :
                             analysis.aiAnalysis.tradingRecommendation === 'SELL' ? 'sell_opportunity' : 'watch';
            
            // This would typically be done in a background job for all users
            // For demo purposes, we'll create a placeholder alert
          }

          processedEvents.push(marketEvent);
        } catch (error) {
          console.error(`Failed to analyze news event: ${newsEvent.title}`, error);
        }
      }

      res.json({ processedEvents, count: processedEvents.length });
    } catch (error) {
      console.error("Process news error:", error);
      res.status(500).json({ message: "Failed to process news events" });
    }
  });

  // Get recent market events
  app.get("/api/market-events", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const events = await storage.getRecentMarketEvents(limit);
      res.json(events);
    } catch (error) {
      console.error("Get market events error:", error);
      res.status(500).json({ message: "Failed to get market events" });
    }
  });

  // Get user alerts
  app.get("/api/alerts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const alerts = await storage.getUserAlerts(userId);
      res.json(alerts);
    } catch (error) {
      console.error("Get alerts error:", error);
      res.status(500).json({ message: "Failed to get alerts" });
    }
  });

  // Get unread user alerts
  app.get("/api/alerts/unread", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const alerts = await storage.getUnreadUserAlerts(userId);
      res.json(alerts);
    } catch (error) {
      console.error("Get unread alerts error:", error);
      res.status(500).json({ message: "Failed to get unread alerts" });
    }
  });

  // Mark alert as read
  app.put("/api/alerts/:id/read", isAuthenticated, async (req: any, res) => {
    try {
      const { id } = req.params;
      await storage.markAlertAsRead(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Mark alert read error:", error);
      res.status(500).json({ message: "Failed to mark alert as read" });
    }
  });

  // Create alert for specific user (for when they want to be notified about specific stocks)
  app.post("/api/alerts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { marketEventId, alertType, message } = req.body;
      
      const alert = await storage.createUserAlert({
        userId,
        marketEventId,
        alertType,
        message,
        isRead: 0,
      });
      
      res.json(alert);
    } catch (error) {
      console.error("Create alert error:", error);
      res.status(500).json({ message: "Failed to create alert" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
