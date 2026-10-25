// Live Plaid data for the signed-in user, normalized for the finance features.
// Nothing returned here is written to the database: balances, holdings, and
// transactions are fetched on request and discarded afterwards.

import type { PlaidApi } from "plaid";
import type { InstitutionSummary, LinkedAccount, LinkedHolding } from "@shared/finance";
import { storage, type StoredPlaidItem } from "../../storage";
import {
  createPlaidClient,
  decryptPlaidAccessToken,
  getPlaidErrorDetails,
  getPlaidSetupStatus,
} from "../plaid";
import { calculateSpendingAnalysis, type SpendingAnalysisSummary } from "../spendingAnalysis";
import { accountKey, dedupeLinkedAccounts, normalizeItem, type NormalizedItem } from "./linkedAccounts";

export function logPlaidFailure(operation: string, error: unknown) {
  const details = getPlaidErrorDetails(error);
  console.warn("Plaid operation failed", {
    operation,
    errorCode: details.code,
    requestId: details.requestId,
  });
  return details;
}

const itemProducts = (item: StoredPlaidItem) => (item.products?.length ? item.products : ["investments"]);

export interface LinkedFinancialData {
  plaidConfigured: boolean;
  institutions: InstitutionSummary[];
  accounts: LinkedAccount[];
  holdings: LinkedHolding[];
  duplicateAccountCount: number;
}

async function loadItem(
  client: PlaidApi,
  userId: string,
  item: StoredPlaidItem
): Promise<{ summary: InstitutionSummary; data: NormalizedItem | null }> {
  const institutionName = item.institutionName || "Linked institution";
  try {
    const accessToken = decryptPlaidAccessToken(item.encryptedAccessToken, `${userId}:${item.itemId}`);
    const [accountsResponse, holdingsResponse] = await Promise.all([
      client.accountsGet({ access_token: accessToken }),
      itemProducts(item).includes("investments")
        ? client.investmentsHoldingsGet({ access_token: accessToken })
        : Promise.resolve(null),
    ]);
    const retrievedAt = new Date().toISOString();
    const data = normalizeItem({
      itemId: item.itemId,
      institutionId: item.institutionId ?? accountsResponse.data.item.institution_id ?? null,
      institutionName,
      retrievedAt,
      accounts: accountsResponse.data.accounts,
      holdings: holdingsResponse?.data.holdings ?? [],
      securities: holdingsResponse?.data.securities ?? [],
    });
    return {
      summary: { itemId: item.itemId, institutionName, status: "connected", retrievedAt, accountCount: data.accounts.length },
      data,
    };
  } catch (error) {
    const details = logPlaidFailure("finance-load-item", error);
    const reauth = details.code === "ITEM_LOGIN_REQUIRED";
    return {
      summary: {
        itemId: item.itemId,
        institutionName,
        status: reauth ? "reauth-required" : "error",
        retrievedAt: null,
        accountCount: 0,
        message: reauth ? "Reconnect this institution to refresh its data." : "This institution could not be refreshed.",
      },
      data: null,
    };
  }
}

// Every linked account and holding, de-duplicated across connections. A
// connection that fails is reported in `institutions` rather than thrown, so
// one broken bank never hides the others.
export async function loadLinkedFinancialData(userId: string): Promise<LinkedFinancialData> {
  const status = getPlaidSetupStatus();
  if (!status.configured) {
    return { plaidConfigured: false, institutions: [], accounts: [], holdings: [], duplicateAccountCount: 0 };
  }
  const items = await storage.getPlaidItems(userId);
  if (items.length === 0) {
    return { plaidConfigured: true, institutions: [], accounts: [], holdings: [], duplicateAccountCount: 0 };
  }
  const client = createPlaidClient();
  const results = await Promise.all(items.map((item) => loadItem(client, userId, item)));
  const deduped = dedupeLinkedAccounts(results.flatMap((r) => (r.data ? [r.data] : [])));
  return {
    plaidConfigured: true,
    institutions: results.map((r) => r.summary),
    accounts: deduped.accounts,
    holdings: deduped.holdings,
    duplicateAccountCount: deduped.duplicateAccountCount,
  };
}

// ── Bank transactions ───────────────────────────────────────────────────────

export class SpendingAnalysisError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// One completed or pending bank transaction, reduced to what the analyses use.
// Plaid convention: positive amounts are money leaving the account.
export interface BankTransaction {
  transactionId: string;
  accountId: string;
  date: string;
  amount: number;
  pending: boolean;
  primaryCategory: string;
  category: string;
  // Used only in memory for recurring-charge detection; never stored or sent to the AI.
  merchant: string;
}

export interface BankTransactionSet {
  periodStart: string;
  periodEnd: string;
  transactions: BankTransaction[];
  excludedCurrencyCount: number;
}

const MAX_TRANSACTIONS_PER_ITEM = 5_000;

// Pulls up to `days` of USD transactions from every connection linked for spending.
export async function loadBankTransactions(userId: string, days = 90): Promise<BankTransactionSet> {
  const items = (await storage.getPlaidItems(userId)).filter((item) =>
    (item.products || []).includes("transactions")
  );
  if (items.length === 0) {
    throw new SpendingAnalysisError(
      409,
      "NO_SPENDING_ACCOUNTS",
      "Connect a checking or savings account with the spending connection button first."
    );
  }

  const client = createPlaidClient();
  const periodEnd = new Date().toISOString().slice(0, 10);
  const endTime = Date.parse(`${periodEnd}T00:00:00.000Z`);
  const periodStart = new Date(endTime - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const transactions: BankTransaction[] = [];
  let excludedCurrencyCount = 0;
  // The same bank account can come through two connections. Each account's
  // transactions are taken from only one of them (lowest item ID wins).
  const claimedAccountKeys = new Set<string>();

  for (const item of [...items].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    const accessToken = decryptPlaidAccessToken(item.encryptedAccessToken, `${userId}:${item.itemId}`);
    const accountsResponse = await client.accountsGet({ access_token: accessToken });
    const institutionId = item.institutionId ?? accountsResponse.data.item.institution_id ?? null;
    const includedAccountIds = new Set<string>();
    for (const account of accountsResponse.data.accounts) {
      const key = accountKey({
        institutionId,
        persistentAccountId: account.persistent_account_id ?? null,
        accountId: account.account_id,
        type: account.type,
        subtype: account.subtype ?? null,
        mask: account.mask ?? null,
        name: account.name,
      });
      if (claimedAccountKeys.has(key)) continue;
      claimedAccountKeys.add(key);
      includedAccountIds.add(account.account_id);
    }
    if (includedAccountIds.size === 0) continue;

    let offset = 0;
    let totalTransactions = Number.POSITIVE_INFINITY;
    while (offset < totalTransactions && offset < MAX_TRANSACTIONS_PER_ITEM) {
      let response;
      try {
        response = await client.transactionsGet({
          access_token: accessToken,
          start_date: periodStart,
          end_date: periodEnd,
          options: { count: 500, offset, account_ids: Array.from(includedAccountIds), include_personal_finance_category: true },
        });
      } catch (error) {
        // Right after linking, the bank may not have sent any history yet.
        if (getPlaidErrorDetails(error).code === "PRODUCT_NOT_READY") {
          throw new SpendingAnalysisError(409, "TRANSACTIONS_NOT_READY", "Your bank is still sending your transaction history. Check back in a few minutes.");
        }
        throw error;
      }
      totalTransactions = response.data.total_transactions;
      for (const transaction of response.data.transactions) {
        if (transaction.iso_currency_code !== "USD") {
          excludedCurrencyCount += 1;
          continue;
        }
        const primaryCategory = transaction.personal_finance_category?.primary || transaction.category?.[0] || "OTHER";
        transactions.push({
          transactionId: transaction.transaction_id,
          accountId: transaction.account_id,
          date: transaction.date,
          amount: transaction.amount,
          pending: transaction.pending,
          primaryCategory,
          category: transaction.personal_finance_category?.detailed || primaryCategory,
          merchant: (transaction.merchant_name || transaction.name || "").trim(),
        });
      }
      const received = response.data.transactions.length;
      if (received === 0) break;
      offset += received;
    }

    if (offset < totalTransactions) {
      throw new SpendingAnalysisError(
        422,
        "SPENDING_TRANSACTION_LIMIT",
        "Too many transactions were returned for one account. Narrow the connected accounts and try again."
      );
    }
  }

  return { periodStart, periodEnd, transactions, excludedCurrencyCount };
}

// 90-day cash-flow summary. Raw transactions never leave this function.
export async function loadSpendingAnalysis(userId: string): Promise<{
  analysis: SpendingAnalysisSummary;
  excludedCurrencyCount: number;
}> {
  const { periodStart, periodEnd, transactions, excludedCurrencyCount } = await loadBankTransactions(userId);
  const analysis = calculateSpendingAnalysis(transactions, periodStart, periodEnd);
  if (analysis.transactionsAnalyzed === 0) {
    throw new SpendingAnalysisError(
      422,
      "NO_COMPLETED_TRANSACTIONS",
      "There are no completed USD transactions to analyze in the last 90 days."
    );
  }
  return { analysis, excludedCurrencyCount };
}
