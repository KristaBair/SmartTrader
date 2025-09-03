import { type Portfolio, type InsertPortfolio, type Recommendation, type InsertRecommendation, type MarketData, type InsertMarketData, type Transaction, type InsertTransaction, type User, type UpsertUser, users, portfolios, recommendations, marketData, transactions } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  // User operations - (IMPORTANT) these user operations are mandatory for Replit Auth.
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // Portfolio methods
  createPortfolio(portfolio: InsertPortfolio): Promise<Portfolio>;
  getPortfolio(id: string): Promise<Portfolio | undefined>;
  getPortfolioByUserId(userId: string): Promise<Portfolio | undefined>;
  updatePortfolio(id: string, portfolio: Partial<InsertPortfolio>): Promise<Portfolio | undefined>;

  // Recommendation methods
  createRecommendation(recommendation: InsertRecommendation): Promise<Recommendation>;
  getRecommendationsByPortfolio(portfolioId: string): Promise<Recommendation[]>;
  deleteRecommendationsByPortfolio(portfolioId: string): Promise<void>;

  // Market data methods
  upsertMarketData(marketData: InsertMarketData): Promise<MarketData>;
  getMarketData(symbol: string): Promise<MarketData | undefined>;
  getAllMarketData(): Promise<MarketData[]>;

  // Transaction methods
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  getTransactionsByPortfolio(portfolioId: string): Promise<Transaction[]>;
  getTransactionsByUser(userId: string): Promise<Transaction[]>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    // Initialize with mock market data on startup
    this.initializeMarketData();
  }

  private async initializeMarketData() {
    try {
      // Check if we already have market data
      const existingData = await db.select().from(marketData).limit(1);
      if (existingData.length > 0) {
        return; // Already initialized
      }

      // Insert initial market data
      const mockData = [
        { symbol: "SPY", price: "432.78", change: "5.12", changePercent: "1.2" },
        { symbol: "QQQ", price: "343.34", change: "7.68", changePercent: "2.1" },
        { symbol: "VIX", price: "16.82", change: "-0.13", changePercent: "-0.8" },
      ];

      for (const data of mockData) {
        await db.insert(marketData).values({
          symbol: data.symbol,
          price: data.price,
          change: data.change,
          changePercent: data.changePercent,
        });
      }
    } catch (error) {
      console.log("Market data initialization skipped:", error);
    }
  }

  // User operations - (IMPORTANT) these user operations are mandatory for Replit Auth.
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async createPortfolio(insertPortfolio: InsertPortfolio): Promise<Portfolio> {
    const [portfolio] = await db
      .insert(portfolios)
      .values(insertPortfolio)
      .returning();
    return portfolio;
  }

  async getPortfolio(id: string): Promise<Portfolio | undefined> {
    const [portfolio] = await db.select().from(portfolios).where(eq(portfolios.id, id));
    return portfolio;
  }

  async getPortfolioByUserId(userId: string): Promise<Portfolio | undefined> {
    const [portfolio] = await db.select().from(portfolios).where(eq(portfolios.userId, userId));
    return portfolio;
  }

  async updatePortfolio(id: string, updates: Partial<InsertPortfolio>): Promise<Portfolio | undefined> {
    const [portfolio] = await db
      .update(portfolios)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(portfolios.id, id))
      .returning();
    return portfolio;
  }

  async createRecommendation(insertRecommendation: InsertRecommendation): Promise<Recommendation> {
    const [recommendation] = await db
      .insert(recommendations)
      .values(insertRecommendation)
      .returning();
    return recommendation;
  }

  async getRecommendationsByPortfolio(portfolioId: string): Promise<Recommendation[]> {
    return await db.select().from(recommendations).where(eq(recommendations.portfolioId, portfolioId));
  }

  async deleteRecommendationsByPortfolio(portfolioId: string): Promise<void> {
    await db.delete(recommendations).where(eq(recommendations.portfolioId, portfolioId));
  }

  async upsertMarketData(insertMarketData: InsertMarketData): Promise<MarketData> {
    const [market] = await db
      .insert(marketData)
      .values(insertMarketData)
      .onConflictDoUpdate({
        target: marketData.symbol,
        set: {
          ...insertMarketData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return market;
  }

  async getMarketData(symbol: string): Promise<MarketData | undefined> {
    const [market] = await db.select().from(marketData).where(eq(marketData.symbol, symbol));
    return market;
  }

  async getAllMarketData(): Promise<MarketData[]> {
    return await db.select().from(marketData);
  }

  // Transaction methods
  async createTransaction(insertTransaction: InsertTransaction): Promise<Transaction> {
    const [transaction] = await db
      .insert(transactions)
      .values(insertTransaction)
      .returning();
    return transaction;
  }

  async getTransactionsByPortfolio(portfolioId: string): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(eq(transactions.portfolioId, portfolioId))
      .orderBy(transactions.createdAt);
  }

  async getTransactionsByUser(userId: string): Promise<Transaction[]> {
    return await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(transactions.createdAt);
  }
}

export const storage = new DatabaseStorage();
