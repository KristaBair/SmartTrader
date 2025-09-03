import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const portfolios = pgTable("portfolios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  cash: decimal("cash", { precision: 12, scale: 2 }).notNull(),
  investments: jsonb("investments").notNull().$type<Array<{
    symbol: string;
    name: string;
    amount: number;
    currentValue: number;
    quantity?: number;
  }>>(),
  initialInvestment: decimal("initial_investment", { precision: 12, scale: 2 }).default("0"),
  monthlyContribution: decimal("monthly_contribution", { precision: 12, scale: 2 }).default("0"),
  lastContributionDate: timestamp("last_contribution_date"),
  totalContributions: decimal("total_contributions", { precision: 12, scale: 2 }).default("0"),
  riskTolerance: text("risk_tolerance").notNull(),
  timeline: text("timeline").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const recommendations = pgTable("recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  action: text("action").notNull(), // 'BUY' or 'SELL'
  confidence: integer("confidence").notNull(),
  reasoning: text("reasoning").notNull(),
  targetPrice: decimal("target_price", { precision: 10, scale: 2 }),
  currentPrice: decimal("current_price", { precision: 10, scale: 2 }),
  expectedReturn: decimal("expected_return", { precision: 5, scale: 2 }),
  recommendedAmount: decimal("recommended_amount", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const marketData = pgTable("market_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  change: decimal("change", { precision: 10, scale: 2 }).notNull(),
  changePercent: decimal("change_percent", { precision: 5, scale: 2 }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  portfolioId: varchar("portfolio_id").notNull(),
  userId: varchar("user_id").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  action: text("action").notNull(), // 'BUY' or 'SELL'
  quantity: decimal("quantity", { precision: 12, scale: 4 }).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
  fees: decimal("fees", { precision: 10, scale: 2 }).default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPortfolioSchema = createInsertSchema(portfolios).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertRecommendationSchema = createInsertSchema(recommendations).omit({
  id: true,
  createdAt: true,
});

export const insertMarketDataSchema = createInsertSchema(marketData).omit({
  id: true,
  updatedAt: true,
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  createdAt: true,
});

export type Portfolio = typeof portfolios.$inferSelect;
export type InsertPortfolio = z.infer<typeof insertPortfolioSchema>;
export type Recommendation = typeof recommendations.$inferSelect;
export type InsertRecommendation = z.infer<typeof insertRecommendationSchema>;
export type MarketData = typeof marketData.$inferSelect;
export type InsertMarketData = z.infer<typeof insertMarketDataSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;

// Additional types for frontend
export type RiskTolerance = "Conservative" | "Moderate" | "Aggressive";
export type Timeline = "Short-term (< 1 year)" | "Medium-term (1-5 years)" | "Long-term (5+ years)";
export type Action = "BUY" | "SELL";

export const portfolioFormSchema = insertPortfolioSchema.extend({
  cash: z.string().min(1, "Cash amount is required"),
  investments: z.string().min(1, "Current investments are required"),
  initialInvestment: z.string().optional(),
  monthlyContribution: z.string().optional(),
  riskTolerance: z.enum(["Conservative", "Moderate", "Aggressive"]),
  timeline: z.enum(["Short-term (< 1 year)", "Medium-term (1-5 years)", "Long-term (5+ years)"]),
});

export type PortfolioFormData = z.infer<typeof portfolioFormSchema>;
