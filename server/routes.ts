// All API routes live here.
// Most routes are public because user data lives in localStorage on the client.
// The only route that still requires Replit Auth is /api/auth/user, which is kept
// for the session system to function correctly.

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyzePortfolio, suggestInvestment, analyzeStockPatterns, type StockEvent } from "./services/openai";
import { runQuantAnalysis } from "./services/quantAnalytics";
import { analyzeNewsEvent } from "./services/marketIntelligence";
import { getStockQuote, getMultipleQuotes, searchSymbol, getHistoricalPrices } from "./services/finnhub";
import { getFinancialNews, getStockNews, getTopHeadlines, getNewsByDateRange } from "./services/newsApi";
import { setupAuth, isAuthenticated } from "./replitAuth";
import multer from "multer";
import OpenAI from "openai";

export async function registerRoutes(app: Express): Promise<Server> {
  // Multer stores uploaded images in memory so we can pass them directly
  // to OpenAI vision without writing temporary files to disk.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/")) cb(null, true);
      else cb(new Error("Only image files are allowed"));
    },
  });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Replit Auth setup (required for the session table and /api/auth/user to work).
  await setupAuth(app);

  // Returns the currently signed-in Replit user. Used by the auth session system.
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      res.json(user);
    } catch {
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // AI portfolio analysis: the main "analyze with AI" button on the dashboard.
  // Accepts the current holdings and returns ranked buy/sell recommendations.
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

  // Quantitative portfolio analysis for the Analytics Lab page.
  // Fetches real historical data for each holding and runs Monte Carlo,
  // VaR, CVaR, Sharpe ratio, and Markowitz calculations on the server.
  app.post("/api/quant/analyze", async (req, res) => {
    try {
      const { holdings, cash, riskTolerance, timeHorizon } = req.body;
      if (!Array.isArray(holdings) || holdings.length === 0) {
        return res.status(400).json({ message: "At least one holding is required" });
      }
      const validRisk = ["conservative", "moderate", "aggressive"].includes(riskTolerance)
        ? riskTolerance
        : "moderate";
      const report = await runQuantAnalysis(
        holdings,
        parseFloat(cash) || 0,
        validRisk,
        parseInt(timeHorizon) || 5
      );
      res.json(report);
    } catch (error) {
      console.error("Quant analysis error:", error);
      res.status(500).json({ message: "Quantitative analysis failed. Please try again." });
    }
  });

  // Smart Invest takes an amount and risk tolerance and returns a full allocation plan
  // with specific tickers, dollar amounts, and reasoning for each position.
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

  // Pattern Analyzer fetches historical prices, finds the biggest single-day moves,
  // pulls news from around those dates, and asks GPT to explain the patterns it sees.
  app.post("/api/patterns/analyze", async (req, res) => {
    try {
      const { ticker } = req.body;
      if (!ticker) return res.status(400).json({ message: "Ticker is required" });

      const symbol = ticker.trim().toUpperCase();

      // Pull the last 6 months of daily prices to look for significant moves.
      const prices = await getHistoricalPrices(symbol, "compact");
      if (prices.length < 10) {
        return res.status(404).json({
          message: `No price data found for ${symbol}. Check the ticker symbol.`,
        });
      }

      // Flag any day where the price moved more than 4% in either direction.
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

      // Keep the 6 biggest moves. More than that makes the AI analysis too noisy.
      events.sort((a, b) => b.magnitude - a.magnitude);
      const topEvents = events.slice(0, 6).sort((a, b) => a.date.localeCompare(b.date));

      // Fetch news from the week leading up to each big move so we can correlate
      // the price action with what was happening in the headlines at the time.
      for (const event of topEvents) {
        const eventDate = new Date(event.date);
        const from = new Date(eventDate);
        from.setDate(from.getDate() - 7);
        const articles = await getNewsByDateRange(
          symbol,
          from.toISOString().split("T")[0],
          event.date
        );
        event.news = articles.map((a) => ({
          title: a.title,
          source: a.source,
          publishedAt: a.publishedAt,
        }));
        // Small pause to avoid hitting the News API rate limit on back-to-back calls.
        await new Promise((r) => setTimeout(r, 300));
      }

      const quote = await getStockQuote(symbol);
      const analysis = await analyzeStockPatterns(symbol, quote?.name || symbol, topEvents);
      const priceHistory = prices.map((p) => ({ date: p.date, close: p.close, volume: p.volume }));

      res.json({
        ticker: symbol,
        companyName: quote?.name || symbol,
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

  // Market overview data shown on the dashboard (SPY, QQQ, VIX).
  // Values come from the database, which is seeded on startup.
  app.get("/api/market-data", async (_req, res) => {
    try {
      const data = await storage.getAllMarketData();
      res.json(data);
    } catch {
      res.status(500).json({ message: "Failed to fetch market data" });
    }
  });

  // Live quote for a single ticker via Finnhub.
  app.get("/api/stocks/quote/:symbol", async (req, res) => {
    try {
      const quote = await getStockQuote(req.params.symbol.toUpperCase());
      if (!quote) return res.status(404).json({ message: `No data found for ${req.params.symbol}` });
      res.json(quote);
    } catch {
      res.status(500).json({ message: "Failed to fetch stock quote" });
    }
  });

  // Batch quotes used by the onboarding page to show live prices for suggested stocks.
  app.post("/api/stocks/quotes", async (req, res) => {
    try {
      const { symbols } = req.body;
      if (!symbols || !Array.isArray(symbols)) {
        return res.status(400).json({ message: "symbols array is required" });
      }
      const quotes = await getMultipleQuotes(symbols.map((s: string) => s.toUpperCase()));
      res.json(quotes);
    } catch {
      res.status(500).json({ message: "Failed to fetch stock quotes" });
    }
  });

  // Ticker symbol search, supports partial names, returns up to 10 matches.
  app.get("/api/stocks/search", async (req, res) => {
    try {
      const q = req.query.q as string;
      if (!q) return res.status(400).json({ message: "Query parameter 'q' is required" });
      const results = await searchSymbol(q);
      res.json(results);
    } catch {
      res.status(500).json({ message: "Failed to search stocks" });
    }
  });

  // Financial news feed that returns top headlines, or results filtered by a keyword query.
  app.get("/api/news", async (req, res) => {
    try {
      const { q } = req.query;
      const articles = q ? await getFinancialNews(q as string) : await getTopHeadlines();
      res.json(articles);
    } catch {
      res.status(500).json({ message: "Failed to fetch news" });
    }
  });

  // News for a specific stock symbol, shown in the Pattern Analyzer.
  app.get("/api/news/stock/:symbol", async (req, res) => {
    try {
      const articles = await getStockNews(req.params.symbol.toUpperCase());
      res.json(articles);
    } catch {
      res.status(500).json({ message: "Failed to fetch stock news" });
    }
  });

  // Trading signals polled every 3 minutes by the frontend.
  // Takes the 10 latest headlines, asks GPT to spot BUY or SELL opportunities,
  // and only returns signals with more than 70% confidence to keep alerts meaningful.
  app.get("/api/trading-signals", async (_req, res) => {
    try {
      const articles = await getTopHeadlines();
      if (articles.length === 0) {
        return res.json({ signals: [], generatedAt: new Date().toISOString() });
      }

      const newsSummary = articles
        .slice(0, 10)
        .map((a: any, i: number) =>
          `${i + 1}. ${a.title}${a.description ? " - " + a.description.slice(0, 120) : ""}`
        )
        .join("\n");

      const prompt = `You are a sharp trading analyst. Read these financial news headlines and identify clear, confident BUY or SELL signals for specific stocks or ETFs.

NEWS HEADLINES:
${newsSummary}

Rules:
- Only include signals where you have more than 70% confidence
- Only BUY or SELL (not HOLD or WATCH)
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
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 600,
        response_format: { type: "json_object" },
      });

      const parsed = JSON.parse(response.choices[0].message.content || '{"signals":[]}');

      // Add a unique ID to each signal so the frontend knows if it has already shown it.
      const signals = (parsed.signals || []).map((s: any, i: number) => ({
        ...s,
        id: `${s.ticker}_${Date.now()}_${i}`,
      }));

      res.json({ signals, generatedAt: new Date().toISOString() });
    } catch (error) {
      console.error("Trading signals error:", error);
      // Return empty rather than an error so background polling never breaks the UI.
      res.json({ signals: [], generatedAt: new Date().toISOString() });
    }
  });

  // Analyzes the top 3 current headlines with GPT and returns trading signals
  // with full reasoning. Used by the Market Intelligence page's "Analyze" button.
  app.get("/api/news/analyze", async (_req, res) => {
    try {
      const articles = await getTopHeadlines();
      if (articles.length === 0) {
        return res.json({ events: [], message: "No news available" });
      }

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
          // Skip articles that the AI cannot parse cleanly.
        }
      }

      res.json({ events: analyzed });
    } catch (error) {
      console.error("News analyze error:", error);
      res.status(500).json({ message: "Failed to analyze news" });
    }
  });

  // Portfolio image scan that accepts a screenshot of any brokerage account and uses
  // GPT-4o vision to read the positions off the screen. Returns structured holdings
  // that the portfolio editor merges directly into the user's current list.
  app.post("/api/portfolio/extract-from-image", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }

      const base64Image = req.file.buffer.toString("base64");
      const mimeType = req.file.mimetype;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a financial data extraction expert. Analyze the brokerage screenshot carefully and extract every visible position.

Return ONLY valid JSON in this exact shape, no markdown, no explanation:
{
  "cash": 1234.56,
  "holdings": [
    {
      "symbol": "AAPL",
      "shares": 10,
      "averagePrice": 172.50,
      "totalValue": 1725.00
    }
  ]
}

Rules:
- "cash" is any uninvested cash or money market balance. Use 0 if not visible.
- "symbol" must be the ticker (e.g. AAPL, not "Apple Inc"). Uppercase letters only.
- "shares" is the number of shares held. Use the exact number shown.
- "averagePrice" is the average cost per share or the current price if cost basis is not shown.
- "totalValue" is the total market value of that position.
- If shares are not shown but total value is, set shares to 1 and averagePrice to the total value.
- Omit positions you cannot read clearly rather than guessing.
- Numbers must be plain numbers, no dollar signs or commas.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all portfolio positions from this screenshot:" },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1200,
      });

      const extracted = JSON.parse(response.choices[0].message.content || "{}");

      // Validate and sanitize each holding before sending it back.
      const holdings = (extracted.holdings || [])
        .filter((h: any) => h.symbol && typeof h.symbol === "string")
        .map((h: any) => ({
          symbol: String(h.symbol).toUpperCase().replace(/[^A-Z.]/g, ""),
          shares: Math.abs(parseFloat(h.shares) || 1),
          averagePrice: Math.abs(parseFloat(h.averagePrice) || parseFloat(h.totalValue) || 0),
        }))
        .filter((h: any) => h.symbol && h.averagePrice > 0);

      res.json({ cash: Math.abs(parseFloat(extracted.cash) || 0), holdings });
    } catch (error) {
      console.error("Image scan error:", error);
      res.status(500).json({ message: "Failed to read the image. Please try a clearer screenshot." });
    }
  });

  // Onboarding chat with an AI advisor that walks new users through their goals
  // and financial situation during the first-run setup flow.
  app.post("/api/financial-chat", async (req, res) => {
    try {
      const { message, chatHistory, savingsAmount, contributionFrequency, contributionAmount } = req.body;

      const contributionNote =
        contributionFrequency && contributionAmount
          ? contributionFrequency === "irregular"
            ? ` They plan to add money irregularly, roughly $${contributionAmount} when they can.`
            : ` They plan to contribute $${contributionAmount} ${contributionFrequency}.`
          : "";

      const systemPrompt = `You are a helpful financial advisor. The user has $${savingsAmount} in savings and wants to start investing.${contributionNote}

Your job is to ask questions about their goals, timeline, and risk tolerance. Be conversational and concise.
Once you have enough information, set readyForSuggestions to true in your response.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          { role: "system", content: systemPrompt },
          ...chatHistory,
          { role: "user", content: message },
        ],
        max_completion_tokens: 300,
      });

      const aiReply = response.choices[0].message.content || "";
      const totalMessages = chatHistory.length + 1;

      // After 4 exchanges, or if the AI signals it has enough context, show suggestions.
      const readyForSuggestions =
        totalMessages >= 4 ||
        aiReply.toLowerCase().includes("ready") ||
        aiReply.toLowerCase().includes("suggest") ||
        aiReply.toLowerCase().includes("recommend");

      res.json({ reply: aiReply, readyForSuggestions });
    } catch (error) {
      console.error("Financial chat error:", error);
      res.status(500).json({ message: "Failed to process chat message" });
    }
  });

  // Generates a full investment plan from the onboarding conversation.
  // Returns specific tickers, dollar amounts, and reasoning for each allocation.
  app.post("/api/generate-investment-suggestions", async (req, res) => {
    try {
      const { savingsAmount, chatHistory, contributionFrequency, contributionAmount } = req.body;

      const conversationSummary = chatHistory
        .filter((msg: any) => msg.role === "user")
        .map((msg: any) => msg.content)
        .join(" ");

      const contributionNote =
        contributionFrequency && contributionAmount
          ? contributionFrequency === "irregular"
            ? `\nIrregular contributions: roughly $${contributionAmount} when possible`
            : `\nRegular contributions: $${contributionAmount} ${contributionFrequency}`
          : "";

      const prompt = `Based on this user's conversation, create a specific investment plan with exact stock and ETF recommendations.

User has: $${savingsAmount} in savings${contributionNote}
Conversation: ${conversationSummary}

Return JSON in this exact format:
{
  "recommendations": [
    {
      "category": "Emergency Fund",
      "ticker": "HYSA",
      "name": "High-Yield Savings Account",
      "suggestedAmount": 5000,
      "percentage": 30,
      "explanation": "Covers 3 to 6 months of expenses before investing",
      "action": "ALLOCATE"
    },
    {
      "category": "Index Fund",
      "ticker": "SPY",
      "name": "SPDR S&P 500 ETF",
      "suggestedAmount": 8000,
      "percentage": 40,
      "explanation": "Broad market exposure for long-term growth",
      "action": "BUY"
    }
  ],
  "overallStrategy": "Brief explanation of the overall approach",
  "nextSteps": ["Specific action item 1", "Specific action item 2"]
}

Requirements:
- Include 3 to 5 recommendations with real ticker symbols
- All amounts must add up to the total savings amount
- Mix ETFs for diversification and individual stocks for growth potential`;

      const response = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: "You are a professional financial advisor. Respond with valid JSON only.",
          },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 1000,
        response_format: { type: "json_object" },
      });

      const suggestions = JSON.parse(response.choices[0].message.content || "{}");
      res.json(suggestions);
    } catch (error) {
      console.error("Investment suggestions error:", error);
      res.status(500).json({ message: "Failed to generate investment suggestions" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
