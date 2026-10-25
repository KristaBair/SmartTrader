// All API routes live here.
// Everything except /api/auth/config requires a Cognito access token. User data
// (portfolio, onboarding, recommendations) is stored in DynamoDB per Cognito user.

import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { storage, type StoredPlaidItem } from "./storage";
import { requireAuth, getUserId, getAuthClientConfig } from "./auth";
import { analyzePortfolio, suggestInvestment, analyzeStockPatterns, type StockEvent } from "./services/aiAnalysis";
import { converseJson, converseText, toImageFormat, type ChatTurn } from "./services/bedrock";
import { saveScreenshot } from "./services/uploads";
import { runQuantAnalysis, InsufficientDataError } from "./services/quantAnalytics";
import { analyzeNewsEvent } from "./services/marketIntelligence";
import { getStockQuote, getMultipleQuotes, searchSymbol, getHistoricalPrices } from "./services/finnhub";
import { getFinancialNews, getStockNews, getTopHeadlines, getNewsByDateRange } from "./services/newsApi";
import {
  recommendationSchema,
  savedOnboardingSchema,
  savedPortfolioSchema,
  type MarketData,
} from "@shared/schema";
import multer from "multer";
import { z } from "zod";
import {
  CountryCode,
  Products,
  type LinkTokenCreateRequest,
  type PlaidApi,
} from "plaid";
import {
  createPlaidClient,
  decryptPlaidAccessToken,
  encryptPlaidAccessToken,
  getPlaidSetupStatus,
} from "./services/plaid";
import type { SpendingAnalysisSummary } from "./services/spendingAnalysis";
import {
  loadSpendingAnalysis,
  logPlaidFailure,
  SpendingAnalysisError,
} from "./services/finance/plaidData";
import { TERMS_VERSION } from "@shared/terms";
import { findOverlappingSymbols } from "./services/holdingsReconciliation";
import { registerFinanceRoutes } from "./financeRoutes";

interface TradingSignal {
  ticker: string;
  action: "BUY" | "SELL";
  reason: string;
  confidence: number;
  urgency: string;
  newsHeadline: string;
}

interface PlaidAccountView {
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  currency: string | null;
}

interface PlaidHoldingView {
  accountName: string;
  symbol: string | null;
  securityName: string;
  quantity: number;
  marketValue: number | null;
  institutionPrice: number | null;
  costBasis: number | null;
  currency: string | null;
}

interface PlaidTransactionView {
  date: string;
  name: string;
  symbol: string | null;
  type: string;
  subtype: string | null;
  amount: number;
  quantity: number | null;
  price: number | null;
}

interface PlaidItemView {
  itemId: string;
  institutionName: string;
  products: string[];
  connectedAt: string;
  lastSyncedAt: string | null;
  retrievedAt: string | null;
  status: "connected" | "error";
  requiresReauth: boolean;
  errorMessage?: string;
  accounts: PlaidAccountView[];
  holdings: PlaidHoldingView[];
  transactions: PlaidTransactionView[];
  transactionsAvailable: boolean;
}

async function fetchPlaidItemSnapshot(
  client: PlaidApi,
  userId: string,
  item: StoredPlaidItem,
  includeTransactions = true
): Promise<PlaidItemView> {
  const itemProducts = item.products?.length ? item.products : ["investments"];
  const hasInvestments = itemProducts.includes("investments");
  const base = {
    itemId: item.itemId,
    institutionName: item.institutionName || "Investment institution",
    products: itemProducts,
    connectedAt: item.connectedAt,
    lastSyncedAt: item.lastSyncedAt || null,
    retrievedAt: null,
    accounts: [] as PlaidAccountView[],
    holdings: [] as PlaidHoldingView[],
    transactions: [] as PlaidTransactionView[],
    transactionsAvailable: false,
    requiresReauth: false,
  };

  try {
    const accessToken = decryptPlaidAccessToken(
      item.encryptedAccessToken,
      `${userId}:${item.itemId}`
    );
    const accountsResponse = await client.accountsGet({ access_token: accessToken });
    const holdingsResponse = hasInvestments
      ? await client.investmentsHoldingsGet({ access_token: accessToken })
      : null;
    const accountById = new Map(
      accountsResponse.data.accounts.map((account) => [account.account_id, account])
    );
    const securityById = new Map(
      holdingsResponse?.data.securities.map((security) => [security.security_id, security]) ?? []
    );

    const accounts: PlaidAccountView[] = accountsResponse.data.accounts.map((account) => ({
      name: account.name,
      officialName: account.official_name || null,
      type: account.type,
      subtype: account.subtype || null,
      mask: account.mask || null,
      currentBalance: account.balances.current,
      availableBalance: account.balances.available,
      currency: account.balances.iso_currency_code || account.balances.unofficial_currency_code || null,
    }));

    const holdings: PlaidHoldingView[] = (holdingsResponse?.data.holdings ?? []).map((holding) => {
      const security = securityById.get(holding.security_id);
      const account = accountById.get(holding.account_id);
      const institutionPrice = holding.institution_price ?? null;
      return {
        accountName: account?.name || "Investment account",
        symbol: security?.ticker_symbol || null,
        securityName: security?.name || "Investment security",
        quantity: holding.quantity,
        marketValue: holding.institution_value
          ?? (institutionPrice === null ? null : holding.quantity * institutionPrice),
        institutionPrice,
        costBasis: holding.cost_basis ?? null,
        currency: holding.iso_currency_code || security?.iso_currency_code || null,
      };
    });

    let transactions: PlaidTransactionView[] = [];
    let transactionsAvailable = false;
    let requiresReauth = false;
    if (includeTransactions && hasInvestments) {
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      try {
        const transactionResponse = await client.investmentsTransactionsGet({
          access_token: accessToken,
          start_date: startDate,
          end_date: endDate,
          options: { count: 100, offset: 0 },
        });
        const transactionSecurityById = new Map(
          transactionResponse.data.securities.map((security) => [security.security_id, security])
        );
        transactions = transactionResponse.data.investment_transactions.map((transaction) => ({
          date: transaction.date,
          name: transaction.name,
          symbol: transaction.security_id
            ? transactionSecurityById.get(transaction.security_id)?.ticker_symbol || null
            : null,
          type: transaction.type,
          subtype: transaction.subtype || null,
          amount: transaction.amount,
          quantity: transaction.quantity ?? null,
          price: transaction.price ?? null,
        }));
        transactionsAvailable = true;
      } catch (error) {
        const details = logPlaidFailure("investment-transactions", error);
        requiresReauth = details.code === "ITEM_LOGIN_REQUIRED";
      }
    }

    const retrievedAt = new Date().toISOString();
    await storage.savePlaidItem(userId, { ...item, lastSyncedAt: retrievedAt });
    return {
      ...base,
      status: "connected",
      retrievedAt,
      accounts,
      holdings,
      transactions,
      transactionsAvailable,
      requiresReauth,
      ...(requiresReauth
        ? { errorMessage: "Reconnect this account to refresh all available data." }
        : {}),
    };
  } catch (error) {
    const details = logPlaidFailure("account-refresh", error);
    const requiresReauth = details.code === "ITEM_LOGIN_REQUIRED";
    return {
      ...base,
      status: "error",
      requiresReauth,
      errorMessage: requiresReauth
        ? "Reconnect this account to refresh its data."
        : "Account data could not be refreshed. Try again later.",
    };
  }
}

async function getPlaidAnalysisContext(userId: string): Promise<{
  summary: string;
  symbols: string[];
}> {
  const items = (await storage.getPlaidItems(userId)).filter((item) =>
    (item.products?.length ? item.products : ["investments"]).includes("investments")
  );
  if (items.length === 0) throw new Error("No connected investment accounts were found.");

  const client = createPlaidClient();
  const positions = new Map<string, { quantity: number; marketValue: number; hasValue: boolean }>();

  for (const item of items) {
    const accessToken = decryptPlaidAccessToken(
      item.encryptedAccessToken,
      `${userId}:${item.itemId}`
    );
    const response = await client.investmentsHoldingsGet({ access_token: accessToken });
    const securityById = new Map(
      response.data.securities.map((security) => [security.security_id, security])
    );
    for (const holding of response.data.holdings) {
      const symbol = securityById.get(holding.security_id)?.ticker_symbol?.trim().toUpperCase();
      if (!symbol || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) continue;

      const institutionPrice = holding.institution_price ?? null;
      const marketValue = holding.institution_value
        ?? (institutionPrice === null ? null : holding.quantity * institutionPrice);
      const existing = positions.get(symbol) || { quantity: 0, marketValue: 0, hasValue: false };
      existing.quantity += holding.quantity;
      if (marketValue !== null && Number.isFinite(marketValue)) {
        existing.marketValue += marketValue;
        existing.hasValue = true;
      }
      positions.set(symbol, existing);
    }
  }

  const symbols = Array.from(positions.keys()).sort();
  const summary = symbols.length > 0
    ? symbols.map((symbol) => {
        const position = positions.get(symbol)!;
        const valueText = position.hasValue
          ? `, institution-reported value $${position.marketValue.toFixed(2)}`
          : "";
        return `- ${symbol}: ${position.quantity} shares${valueText}`;
      }).join("\n")
    : "- No tickered holdings were returned by the connected investment accounts.";

  return {
    symbols,
    summary: `Linked holdings reported by the user's investment institutions:\n${summary}`,
  };
}

function formatSpendingForPrompt(analysis: SpendingAnalysisSummary): string {
  const categories = analysis.categories
    .map((category) => `  - ${category.category}: $${category.monthlyAverage.toFixed(2)}/month`)
    .join("\n");
  return [
    `- Period: ${analysis.periodStart} to ${analysis.periodEnd} (${analysis.transactionsAnalyzed} completed USD transactions, transfers excluded)`,
    `- Average monthly income: $${analysis.monthlyIncome.toFixed(2)}`,
    `- Average monthly expenses: $${analysis.monthlyExpenses.toFixed(2)}`,
    `- Average monthly surplus: $${analysis.monthlySurplus.toFixed(2)}`,
    `- Suggested monthly contribution (50% of positive surplus): $${analysis.suggestedMonthlyContribution.toFixed(2)}`,
    ...(categories ? [`- Top spending categories:\n${categories}`] : []),
  ].join("\n");
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Multer holds the upload in memory; the route then stores it in S3 and passes
  // the same bytes to Bedrock, so nothing is written to local disk.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith("image/")) cb(null, true);
      else cb(new Error("Only image files are allowed"));
    },
  });

  // Public Cognito settings the browser needs before anyone has signed in.
  app.get("/api/auth/config", (_req, res) => {
    res.json(getAuthClientConfig());
  });

  // Every route registered below this line requires a valid Cognito access token.
  app.use("/api", requireAuth);

  // Connected-account data and the analysis that uses it are only available to
  // users who have accepted the current Terms, which is where that sharing is disclosed.
  const requireCurrentTerms: RequestHandler = async (_req, res, next) => {
    try {
      const acceptance = await storage.getTermsAcceptance(getUserId(res));
      if (acceptance?.version !== TERMS_VERSION) {
        return res.status(403).json({
          code: "TERMS_NOT_ACCEPTED",
          message: "Accept the current Terms and Conditions to continue.",
        });
      }
      next();
    } catch (error) {
      console.error("Terms check error:", error);
      res.status(500).json({ message: "Could not verify Terms acceptance" });
    }
  };
  app.use(["/api/plaid", "/api/spending", "/api/portfolios/analyze-direct", "/api/finances"], requireCurrentTerms);
  registerFinanceRoutes(app);

  app.put("/api/me/terms", async (req, res) => {
    const body = z.object({ version: z.literal(TERMS_VERSION) }).safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ message: "These Terms are out of date. Reload the page and review the current version." });
    }
    try {
      const acceptance = { version: TERMS_VERSION, acceptedAt: new Date().toISOString() };
      await storage.saveTermsAcceptance(getUserId(res), acceptance);
      res.json(acceptance);
    } catch (error) {
      console.error("Save terms acceptance error:", error);
      res.status(500).json({ message: "Failed to record your acceptance" });
    }
  });

  app.get("/api/plaid/status", (_req, res) => {
    res.json(getPlaidSetupStatus());
  });

  app.post("/api/plaid/link-token", async (req, res) => {
    const body = z.object({
      itemId: z.string().min(1).max(200).optional(),
      purpose: z.enum(["investments", "spending"]).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ message: "Invalid Link request" });

    const status = getPlaidSetupStatus();
    if (!status.configured) {
      return res.status(503).json({
        code: "PLAID_NOT_CONFIGURED",
        message: status.message || "Plaid is not configured.",
      });
    }

    const userId = getUserId(res);
    const product = body.data.purpose === "spending" ? "transactions" : "investments";
    if (!status.products.includes(product)) {
      return res.status(409).json({
        message: `Plaid ${product} is not enabled in this Sandbox configuration.`,
      });
    }

    try {
      const client = createPlaidClient();
      const linkRequest: LinkTokenCreateRequest = {
        user: { client_user_id: userId },
        client_name: "InvestSmart",
        country_codes: [CountryCode.Us],
        language: "en",
        products: [product === "transactions" ? Products.Transactions : Products.Investments],
        ...(process.env.PLAID_REDIRECT_URI
          ? { redirect_uri: process.env.PLAID_REDIRECT_URI }
          : {}),
      };

      if (body.data.itemId) {
        const item = (await storage.getPlaidItems(userId))
          .find((candidate) => candidate.itemId === body.data.itemId);
        if (!item) return res.status(404).json({ message: "Connected account was not found" });
        linkRequest.access_token = decryptPlaidAccessToken(
          item.encryptedAccessToken,
          `${userId}:${item.itemId}`
        );
        delete linkRequest.products;
      }

      const response = await client.linkTokenCreate(linkRequest);
      res.json({ linkToken: response.data.link_token });
    } catch (error) {
      logPlaidFailure("link-token", error);
      res.status(502).json({ message: "Could not start Plaid Link. Try again later." });
    }
  });

  app.post("/api/plaid/exchange-token", async (req, res) => {
    const body = z.object({
      publicToken: z.string().min(1).max(500),
      purpose: z.enum(["investments", "spending"]).optional(),
      institution: z.object({
        id: z.string().max(200).optional(),
        name: z.string().max(200).optional(),
      }).optional(),
    }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Invalid Plaid Link response" });

    const status = getPlaidSetupStatus();
    if (!status.configured) {
      return res.status(503).json({
        code: "PLAID_NOT_CONFIGURED",
        message: status.message || "Plaid is not configured.",
      });
    }

    const userId = getUserId(res);
    let accessTokenForCleanup: string | undefined;
    try {
      const client = createPlaidClient();
      const exchange = await client.itemPublicTokenExchange({
        public_token: body.data.publicToken,
      });
      accessTokenForCleanup = exchange.data.access_token;
      const itemId = exchange.data.item_id;
      const plaidItem = await client.itemGet({ access_token: exchange.data.access_token });
      const itemProducts = (plaidItem.data.item.products || []).map((product) => String(product));
      const connectedProducts = (itemProducts.length > 0
        ? itemProducts
        : [body.data.purpose === "spending" ? "transactions" : "investments"])
        .filter((product) => status.products.includes(product));
      if (connectedProducts.length === 0) {
        throw new Error("Plaid did not return an enabled product for this connection.");
      }
      const existing = (await storage.getPlaidItems(userId))
        .find((item) => item.itemId === itemId);
      const institutionId = plaidItem.data.item.institution_id
        || body.data.institution?.id
        || existing?.institutionId;
      const institutionName = plaidItem.data.item.institution_name
        || body.data.institution?.name
        || existing?.institutionName;

      await storage.savePlaidItem(userId, {
        itemId,
        encryptedAccessToken: encryptPlaidAccessToken(
          exchange.data.access_token,
          `${userId}:${itemId}`
        ),
        products: connectedProducts,
        ...(institutionId ? { institutionId } : {}),
        ...(institutionName ? { institutionName } : {}),
        connectedAt: existing?.connectedAt || new Date().toISOString(),
      });

      res.status(201).json({ connected: true });
    } catch (error) {
      if (accessTokenForCleanup) {
        try {
          await createPlaidClient().itemRemove({ access_token: accessTokenForCleanup });
        } catch {
          // Do not log or expose the access token or provider response.
        }
      }
      logPlaidFailure("public-token-exchange", error);
      res.status(502).json({ message: "Could not securely save the connected account." });
    }
  });

  app.get("/api/plaid/accounts", async (_req, res) => {
    const status = getPlaidSetupStatus();
    if (!status.configured) {
      return res.status(503).json({
        code: "PLAID_NOT_CONFIGURED",
        message: status.message || "Plaid is not configured.",
      });
    }

    try {
      const userId = getUserId(res);
      const items = await storage.getPlaidItems(userId);
      const client = createPlaidClient();
      const connectedItems = await Promise.all(
        items.map((item) => fetchPlaidItemSnapshot(client, userId, item))
      );
      res.json({
        environment: status.environment,
        retrievedAt: new Date().toISOString(),
        items: connectedItems,
      });
    } catch (error) {
      logPlaidFailure("load-accounts", error);
      res.status(502).json({ message: "Could not load linked investment accounts." });
    }
  });

  app.post("/api/spending/analyze", async (_req, res) => {
    const status = getPlaidSetupStatus();
    if (!status.configured || !status.products.includes("transactions")) {
      return res.status(503).json({
        code: "PLAID_TRANSACTIONS_NOT_CONFIGURED",
        message: "Plaid Transactions is not enabled in this Sandbox configuration.",
      });
    }

    try {
      const userId = getUserId(res);
      const { analysis, excludedCurrencyCount } = await loadSpendingAnalysis(userId);

      res.json({
        ...analysis,
        currency: "USD",
        retrievedAt: new Date().toISOString(),
        excludedCurrencyCount,
        notices: [
          "This estimate uses the last 90 days of completed USD transactions. Pending transactions and transfers are excluded to reduce double-counting.",
          "The suggested starting contribution is 50% of positive recent cash-flow surplus. It is an estimate, not financial advice, and does not account for unlinked accounts, upcoming bills, debt, or savings goals.",
          "This report is calculated on the server. Raw transactions and merchant names are not stored in InvestSmart or sent to Amazon Bedrock; under the Terms, only this summary is included in AI portfolio analysis.",
          ...(excludedCurrencyCount > 0
            ? [`${excludedCurrencyCount} non-USD or unclassified-currency transactions were excluded because no currency conversion is applied.`]
            : []),
        ],
      });
    } catch (error) {
      if (error instanceof SpendingAnalysisError) {
        return res.status(error.status).json({ code: error.code, message: error.message });
      }
      logPlaidFailure("spending-analysis", error);
      res.status(502).json({
        message: "Could not retrieve all connected spending transactions. Reconnect the bank account and try again.",
      });
    }
  });

  app.post("/api/plaid/disconnect", async (req, res) => {
    const body = z.object({ itemId: z.string().min(1).max(200) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Invalid account request" });

    try {
      const userId = getUserId(res);
      const item = (await storage.getPlaidItems(userId))
        .find((candidate) => candidate.itemId === body.data.itemId);
      if (!item) return res.status(404).json({ message: "Connected account was not found" });

      let providerRevocationConfirmed = false;
      if (getPlaidSetupStatus().configured) {
        try {
          const accessToken = decryptPlaidAccessToken(
            item.encryptedAccessToken,
            `${userId}:${item.itemId}`
          );
          await createPlaidClient().itemRemove({ access_token: accessToken });
          providerRevocationConfirmed = true;
        } catch (error) {
          logPlaidFailure("disconnect", error);
        }
      }

      // Always remove the local encrypted credential, even if Plaid cannot confirm revocation.
      await storage.deletePlaidItem(userId, item.itemId);
      res.json({
        disconnected: true,
        providerRevocationConfirmed,
        ...(providerRevocationConfirmed
          ? {}
          : { warning: "Access was removed from InvestSmart, but Plaid could not confirm revocation." }),
      });
    } catch (error) {
      logPlaidFailure("disconnect-storage", error);
      res.status(500).json({ message: "Could not remove the connected account from InvestSmart." });
    }
  });

  // ── Signed-in user's data (DynamoDB) ─────────────────────────────────────

  app.get("/api/me/data", async (_req, res) => {
    try {
      res.json(await storage.getUserData(getUserId(res)));
    } catch (error) {
      console.error("Load user data error:", error);
      res.status(500).json({ message: "Failed to load your data" });
    }
  });

  app.put("/api/me/portfolio", async (req, res) => {
    const parsed = savedPortfolioSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid portfolio" });
    try {
      await storage.savePortfolio(getUserId(res), parsed.data);
      res.status(204).end();
    } catch (error) {
      console.error("Save portfolio error:", error);
      res.status(500).json({ message: "Failed to save portfolio" });
    }
  });

  app.put("/api/me/onboarding", async (req, res) => {
    const parsed = savedOnboardingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid onboarding data" });
    try {
      await storage.saveOnboarding(getUserId(res), parsed.data);
      res.status(204).end();
    } catch (error) {
      console.error("Save onboarding error:", error);
      res.status(500).json({ message: "Failed to save onboarding" });
    }
  });

  app.put("/api/me/recommendations", async (req, res) => {
    const parsed = recommendationSchema.array().max(50).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid recommendations" });
    try {
      await storage.saveRecommendations(getUserId(res), parsed.data);
      res.status(204).end();
    } catch (error) {
      console.error("Save recommendations error:", error);
      res.status(500).json({ message: "Failed to save recommendations" });
    }
  });

  app.delete("/api/me/data", async (_req, res) => {
    try {
      await storage.clearUserData(getUserId(res));
      res.status(204).end();
    } catch (error) {
      console.error("Clear user data error:", error);
      res.status(500).json({ message: "Failed to reset your data" });
    }
  });

  // AI portfolio analysis: the main "analyze with AI" button on the dashboard.
  // Accepts the current holdings and returns ranked buy/sell recommendations.
  app.post("/api/portfolios/analyze-direct", async (req, res) => {
    try {
      const { cash, investments, riskTolerance, timeline, symbols } = req.body;
      const heldSymbols = Array.isArray(symbols)
        ? symbols.filter((s: unknown): s is string => typeof s === "string" && /^[A-Za-z.\-]{1,12}$/.test(s)).slice(0, 50)
        : [];
      // Connected-account data is included whenever it exists; users agree to this
      // in the Terms. A failed connection is reported but does not block the analysis.
      let linkedInvestmentSummary: string | undefined;
      let linkedSymbols: string[] = [];
      let spendingSummary: string | undefined;
      const linkedDataNotices: string[] = [];
      const userId = getUserId(res);
      const plaidStatus = getPlaidSetupStatus();
      const plaidItems = plaidStatus.configured ? await storage.getPlaidItems(userId) : [];
      const hasProduct = (product: string) => plaidItems.some((item) =>
        (item.products?.length ? item.products : ["investments"]).includes(product)
      );

      if (hasProduct("investments")) {
        try {
          const linkedContext = await getPlaidAnalysisContext(userId);
          linkedInvestmentSummary = linkedContext.summary;
          linkedSymbols = linkedContext.symbols;
        } catch (error) {
          logPlaidFailure("analysis-context", error);
          linkedDataNotices.push("Linked investment holdings could not be loaded, so they were left out. Reconnect the account and try again.");
        }
      }
      if (hasProduct("transactions") && plaidStatus.products.includes("transactions")) {
        try {
          const { analysis } = await loadSpendingAnalysis(userId);
          spendingSummary = formatSpendingForPrompt(analysis);
        } catch (error) {
          if (!(error instanceof SpendingAnalysisError)) logPlaidFailure("analysis-spending", error);
          linkedDataNotices.push("Bank spending data could not be summarized, so it was left out.");
        }
      }
      // The same position entered by hand and also linked would otherwise be counted twice.
      const overlappingSymbols = findOverlappingSymbols(heldSymbols, linkedSymbols);
      if (overlappingSymbols.length > 0) {
        linkedInvestmentSummary += `\nThese tickers appear in both the manual list and the linked accounts: ${overlappingSymbols.join(", ")}. Treat each as one position (use the linked quantity) unless the user says the manual entry is a separate, unlinked account.`;
        linkedDataNotices.push(`${overlappingSymbols.join(", ")} appear${overlappingSymbols.length === 1 ? "s" : ""} in both your manual holdings and a linked account. The analysis treated each as one position. Remove the manual entry if it's the same holding.`);
      }
      const analysis = await analyzePortfolio(
        parseFloat(cash) || 0,
        investments || "",
        (riskTolerance || "moderate") as any,
        (timeline || "long_term") as any,
        Array.from(new Set([...heldSymbols, ...linkedSymbols])),
        linkedInvestmentSummary,
        spendingSummary
      );
      res.json({ ...analysis, linkedDataNotices });
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
      if (error instanceof InsufficientDataError) {
        return res.status(422).json({ message: error.message });
      }
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
  // pulls news from around those dates, and asks the model to explain the patterns it sees.
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

  // Market overview shown on the dashboard (SPY, QQQ, VIX).
  // Fetches quotes from Finnhub on every request. A symbol Finnhub can't price
  // (the free tier doesn't cover VIX) is reported as unavailable, never filled in.
  app.get("/api/market-data", async (_req, res) => {
    try {
      const symbols = ["SPY", "QQQ", "VIX"];
      const quotes = await getMultipleQuotes(symbols);

      const result: MarketData[] = symbols.map((symbol) => {
        const q = quotes[symbol];
        if (!q || !(q.price > 0)) {
          return { symbol, available: false, price: null, change: null, changePercent: null, source: null, asOf: null, freshness: null };
        }
        return {
          symbol,
          available: true,
          price: q.price,
          change: q.change,
          changePercent: q.changePercent,
          source: q.provenance.source,
          asOf: q.provenance.asOf,
          freshness: q.provenance.freshness,
        };
      });

      res.json(result);
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
  // Takes the 10 latest headlines, asks the model to spot BUY or SELL opportunities,
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

      const parsed = await converseJson<{ signals?: TradingSignal[] }>({ prompt, maxTokens: 600 });

      // Add a unique ID to each signal so the frontend knows if it has already shown it.
      const signals = (parsed.signals || []).map((s, i) => ({
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

  // Analyzes the top 3 current headlines with the model and returns trading signals
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

  // Portfolio image scan that accepts a screenshot of any brokerage account, stores it
  // in S3, and uses Claude vision on Bedrock to read the positions off the screen.
  // Returns structured holdings that the portfolio editor merges into the user's list.
  app.post("/api/portfolio/extract-from-image", upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }

      const imageFormat = toImageFormat(req.file.mimetype);
      if (!imageFormat) {
        return res.status(400).json({ message: "Please upload a PNG, JPEG, GIF, or WebP image." });
      }

      await saveScreenshot(getUserId(res), req.file.buffer, req.file.mimetype);

      const extracted = await converseJson<{ cash?: unknown; holdings?: any[] }>({
        system: `You are a financial data extraction expert. Analyze the brokerage screenshot carefully and extract every visible position.

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
        prompt: "Extract all portfolio positions from this screenshot:",
        image: { bytes: req.file.buffer, format: imageFormat },
        maxTokens: 1200,
      });

      // Validate and sanitize each holding before sending it back.
      const holdings = (extracted.holdings || [])
        .filter((h: any) => h.symbol && typeof h.symbol === "string")
        .map((h: any) => ({
          symbol: String(h.symbol).toUpperCase().replace(/[^A-Z.]/g, ""),
          shares: Math.abs(parseFloat(h.shares) || 1),
          averagePrice: Math.abs(parseFloat(h.averagePrice) || parseFloat(h.totalValue) || 0),
        }))
        .filter((h: any) => h.symbol && h.averagePrice > 0);

      res.json({ cash: Math.abs(parseFloat(String(extracted.cash)) || 0), holdings });
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

      const aiReply = await converseText({
        system: systemPrompt,
        history: chatHistory as ChatTurn[],
        prompt: message,
        maxTokens: 300,
      });
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

      const suggestions = await converseJson<Record<string, unknown>>({
        system: "You are a professional financial advisor. Respond with valid JSON only.",
        prompt,
        maxTokens: 1000,
      });
      res.json(suggestions);
    } catch (error) {
      console.error("Investment suggestions error:", error);
      res.status(500).json({ message: "Failed to generate investment suggestions" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
