import { type Portfolio, type InsertPortfolio, type Recommendation, type InsertRecommendation, type MarketData, type InsertMarketData, type Transaction, type InsertTransaction } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
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

export class MemStorage implements IStorage {
  private portfolios: Map<string, Portfolio>;
  private recommendations: Map<string, Recommendation>;
  private marketData: Map<string, MarketData>;
  private transactions: Map<string, Transaction>;

  constructor() {
    this.portfolios = new Map();
    this.recommendations = new Map();
    this.marketData = new Map();
    this.transactions = new Map();
    
    // Initialize with mock market data
    this.initializeMarketData();
  }

  private initializeMarketData() {
    const mockData = [
      { symbol: "SPY", price: "432.78", change: "5.12", changePercent: "1.2" },
      { symbol: "QQQ", price: "343.34", change: "7.68", changePercent: "2.1" },
      { symbol: "VIX", price: "16.82", change: "-0.13", changePercent: "-0.8" },
    ];

    mockData.forEach(data => {
      const id = randomUUID();
      const marketEntry: MarketData = {
        id,
        symbol: data.symbol,
        price: data.price,
        change: data.change,
        changePercent: data.changePercent,
        updatedAt: new Date(),
      };
      this.marketData.set(data.symbol, marketEntry);
    });
  }

  async createPortfolio(insertPortfolio: InsertPortfolio): Promise<Portfolio> {
    const id = randomUUID();
    const portfolio: Portfolio = {
      ...insertPortfolio,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Portfolio;
    this.portfolios.set(id, portfolio);
    return portfolio;
  }

  async getPortfolio(id: string): Promise<Portfolio | undefined> {
    return this.portfolios.get(id);
  }

  async getPortfolioByUserId(userId: string): Promise<Portfolio | undefined> {
    return Array.from(this.portfolios.values()).find(
      (portfolio) => portfolio.userId === userId,
    );
  }

  async updatePortfolio(id: string, updates: Partial<InsertPortfolio>): Promise<Portfolio | undefined> {
    const existing = this.portfolios.get(id);
    if (!existing) return undefined;

    const updated: Portfolio = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    } as Portfolio;
    this.portfolios.set(id, updated);
    return updated;
  }

  async createRecommendation(insertRecommendation: InsertRecommendation): Promise<Recommendation> {
    const id = randomUUID();
    const recommendation: Recommendation = {
      ...insertRecommendation,
      id,
      createdAt: new Date(),
      targetPrice: insertRecommendation.targetPrice || null,
      currentPrice: insertRecommendation.currentPrice || null,
      expectedReturn: insertRecommendation.expectedReturn || null,
      recommendedAmount: insertRecommendation.recommendedAmount || null,
    };
    this.recommendations.set(id, recommendation);
    return recommendation;
  }

  async getRecommendationsByPortfolio(portfolioId: string): Promise<Recommendation[]> {
    return Array.from(this.recommendations.values()).filter(
      (rec) => rec.portfolioId === portfolioId,
    );
  }

  async deleteRecommendationsByPortfolio(portfolioId: string): Promise<void> {
    const toDelete = Array.from(this.recommendations.entries())
      .filter(([_, rec]) => rec.portfolioId === portfolioId)
      .map(([id]) => id);
    
    toDelete.forEach(id => this.recommendations.delete(id));
  }

  async upsertMarketData(insertMarketData: InsertMarketData): Promise<MarketData> {
    const existing = this.marketData.get(insertMarketData.symbol);
    const id = existing?.id || randomUUID();
    
    const marketEntry: MarketData = {
      ...insertMarketData,
      id,
      updatedAt: new Date(),
    };
    this.marketData.set(insertMarketData.symbol, marketEntry);
    return marketEntry;
  }

  async getMarketData(symbol: string): Promise<MarketData | undefined> {
    return this.marketData.get(symbol);
  }

  async getAllMarketData(): Promise<MarketData[]> {
    return Array.from(this.marketData.values());
  }

  // Transaction methods
  async createTransaction(insertTransaction: InsertTransaction): Promise<Transaction> {
    const id = randomUUID();
    const transaction: Transaction = {
      ...insertTransaction,
      id,
      createdAt: new Date(),
      fees: insertTransaction.fees || null,
      notes: insertTransaction.notes || null,
    };
    this.transactions.set(id, transaction);
    return transaction;
  }

  async getTransactionsByPortfolio(portfolioId: string): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).filter(
      (transaction) => transaction.portfolioId === portfolioId,
    ).sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
  }

  async getTransactionsByUser(userId: string): Promise<Transaction[]> {
    return Array.from(this.transactions.values()).filter(
      (transaction) => transaction.userId === userId,
    ).sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime());
  }
}

export const storage = new MemStorage();
