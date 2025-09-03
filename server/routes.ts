import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyzePortfolio, getRiskAssessment } from "./services/openai";
import { portfolioFormSchema } from "@shared/schema";
import { z } from "zod";
import { setupAuth, isAuthenticated } from "./replitAuth";

export async function registerRoutes(app: Express): Promise<Server> {
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

  const httpServer = createServer(app);
  return httpServer;
}
