import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table.
// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const users = pgTable("users", {
  id: varchar("id").primaryKey(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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

export const onboardingData = pgTable("onboarding_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  onboardingType: text("onboarding_type").notNull(), // 'portfolio' or 'savings'
  savingsAmount: decimal("savings_amount", { precision: 12, scale: 2 }),
  contributionFrequency: text("contribution_frequency"), // 'weekly', 'biweekly', 'monthly'
  contributionAmount: decimal("contribution_amount", { precision: 12, scale: 2 }),
  chatHistory: jsonb("chat_history").$type<Array<{
    role: string;
    content: string;
  }>>(),
  investmentSuggestions: jsonb("investment_suggestions").$type<{
    recommendations: Array<{
      category: string;
      suggestedAmount: number;
      percentage: number;
      explanation: string;
    }>;
    overallStrategy?: string;
    nextSteps?: string[];
  }>(),
  completed: timestamp("completed"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const marketEvents = pgTable("market_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  eventType: text("event_type").notNull(), // 'regulatory', 'earnings', 'merger', 'lawsuit', etc.
  affectedSymbol: text("affected_symbol"), // Stock symbol if specific to one company
  tone: text("tone").notNull(), // 'positive', 'negative', 'neutral'
  impactLevel: text("impact_level").notNull(), // 'low', 'medium', 'high'
  confidence: integer("confidence").notNull(), // AI confidence score 1-100
  sourceUrl: text("source_url"),
  publishedAt: timestamp("published_at").notNull(),
  analyzedAt: timestamp("analyzed_at").defaultNow(),
  aiAnalysis: jsonb("ai_analysis").$type<{
    reasoning: string;
    priceImpactPrediction: string;
    tradingRecommendation: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
    keyFactors: string[];
    riskLevel: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userAlerts = pgTable("user_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  marketEventId: varchar("market_event_id").notNull(),
  alertType: text("alert_type").notNull(), // 'buy_opportunity', 'sell_opportunity', 'watch'
  message: text("message").notNull(),
  isRead: integer("is_read").default(0), // 0 = unread, 1 = read
  sentAt: timestamp("sent_at").defaultNow(),
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

export const insertOnboardingDataSchema = createInsertSchema(onboardingData).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMarketEventSchema = createInsertSchema(marketEvents).omit({
  id: true,
  analyzedAt: true,
  createdAt: true,
});

export const insertUserAlertSchema = createInsertSchema(userAlerts).omit({
  id: true,
  sentAt: true,
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
export type OnboardingData = typeof onboardingData.$inferSelect;
export type InsertOnboardingData = z.infer<typeof insertOnboardingDataSchema>;
export type MarketEvent = typeof marketEvents.$inferSelect;
export type InsertMarketEvent = z.infer<typeof insertMarketEventSchema>;
export type UserAlert = typeof userAlerts.$inferSelect;
export type InsertUserAlert = z.infer<typeof insertUserAlertSchema>;
export type User = typeof users.$inferSelect;
export type UpsertUser = typeof users.$inferInsert;

// Additional types for frontend
export type RiskTolerance = "Conservative" | "Moderate" | "Aggressive";
export type Timeline = "Short-term (< 1 year)" | "Medium-term (1-5 years)" | "Long-term (5+ years)";
export type Action = "BUY" | "SELL";
export type ContributionFrequency = "weekly" | "biweekly" | "monthly" | "irregular";

export const portfolioFormSchema = insertPortfolioSchema.extend({
  cash: z.string().min(1, "Cash amount is required"),
  investments: z.string().min(1, "Current investments are required"),
  initialInvestment: z.string().optional(),
  monthlyContribution: z.string().optional(),
  riskTolerance: z.enum(["Conservative", "Moderate", "Aggressive"]),
  timeline: z.enum(["Short-term (< 1 year)", "Medium-term (1-5 years)", "Long-term (5+ years)"]),
});

export type PortfolioFormData = z.infer<typeof portfolioFormSchema>;
