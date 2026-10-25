// DynamoDB storage. Single-table layout:
//
//   PK                 SK                 data
//   USER#<cognitoSub>  PORTFOLIO          SavedPortfolio
//   USER#<cognitoSub>  ONBOARDING         SavedOnboarding
//   USER#<cognitoSub>  RECOMMENDATIONS    Recommendation[]
//   USER#<cognitoSub>  TERMS              TermsAcceptance
//   USER#<cognitoSub>  PLAID#<itemId>     StoredPlaidItem
//   USER#<cognitoSub>  RECONCILIATION     ReconciliationDecisions (manual vs. linked)
//   USER#<cognitoSub>  LIABILITY#<id>     ManualLiability
//   USER#<cognitoSub>  POOL#<id>          Pool (savings pool definition)
//   USER#<cognitoSub>  POOL_LEDGER        AllocationLedger: every allocation + a version
//   USER#<cognitoSub>  POOLHIST#<poolId>#<iso time>#<id>   AllocationHistoryEntry
//   USER#<cognitoSub>  GOAL#<id>          Goal
//   USER#<cognitoSub>  SPENDING_PREFS     SpendingPrefs (classification choices, added expenses)
//   USER#<cognitoSub>  ADVISOR_PREFS      AdvisorPrefs (which data the AI Advisor may use)
//   MARKET#<symbol>    QUOTE              Legacy placeholder quotes; no longer read or written
//
// Every user item is keyed by the Cognito `sub` taken from a verified token, so one
// user can never read or write another user's partition.

import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { awsConfig, dynamo } from "./aws";
import type {
  Recommendation,
  SavedOnboarding,
  SavedPortfolio,
  TermsAcceptance,
  UserData,
} from "@shared/schema";
import { reconciliationSchema, type ManualLiability, type ReconciliationDecisions } from "@shared/finance";
import type { AllocationHistoryEntry, AllocationLedger, Pool } from "@shared/pools";
import type { Goal } from "@shared/goals";
import { spendingPrefsSchema, type SpendingPrefs } from "@shared/cashflow";
import { advisorPrefsSchema, type AdvisorPrefs } from "@shared/advisor";

const TableName = awsConfig.tableName;

type UserItemKind = "PORTFOLIO" | "ONBOARDING" | "RECOMMENDATIONS" | "TERMS" | "RECONCILIATION" | "SPENDING_PREFS" | "ADVISOR_PREFS";

const userPk = (userId: string) => `USER#${userId}`;

export interface StoredPlaidItem {
  itemId: string;
  encryptedAccessToken: string;
  products?: string[];
  institutionId?: string;
  institutionName?: string;
  connectedAt: string;
  lastSyncedAt?: string;
}

async function putUserItem(userId: string, sk: UserItemKind, data: unknown) {
  await dynamo.send(
    new PutCommand({
      TableName,
      Item: { PK: userPk(userId), SK: sk, data, updatedAt: new Date().toISOString() },
    })
  );
}

// Items whose sort key starts with `prefix`, e.g. every LIABILITY#<id>.
async function queryUserPrefix(userId: string, prefix: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await dynamo.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": userPk(userId), ":prefix": prefix },
        ExclusiveStartKey,
      })
    );
    items.push(...(result.Items ?? []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// Thrown when the pool ledger changed between read and write (another tab or
// request got there first). The caller reloads and retries or reports a conflict.
export class LedgerConflictError extends Error {
  constructor() {
    super("Your savings pools changed in another window. Reload and try again.");
  }
}

export interface PoolChange {
  // Ledger version read before the change; the write fails if it has moved on.
  expectedVersion: number;
  allocations: AllocationLedger["allocations"];
  putPools?: Pool[];
  deletePoolIds?: string[];
  history: AllocationHistoryEntry[];
}

export class DynamoStorage {
  // ── User data ──────────────────────────────────────────────────────────────

  // Loads portfolio, onboarding, and recommendations in a single query.
  async getUserData(userId: string): Promise<UserData> {
    const result = await dynamo.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": userPk(userId) },
      })
    );

    const bySk = Object.fromEntries((result.Items ?? []).map((item) => [item.SK, item.data]));
    return {
      portfolio: (bySk.PORTFOLIO as SavedPortfolio | undefined) ?? null,
      onboarding: (bySk.ONBOARDING as SavedOnboarding | undefined) ?? null,
      recommendations: (bySk.RECOMMENDATIONS as Recommendation[] | undefined) ?? [],
      termsAcceptance: (bySk.TERMS as TermsAcceptance | undefined) ?? null,
    };
  }

  async savePortfolio(userId: string, portfolio: SavedPortfolio): Promise<void> {
    await putUserItem(userId, "PORTFOLIO", portfolio);
  }

  async saveOnboarding(userId: string, onboarding: SavedOnboarding): Promise<void> {
    await putUserItem(userId, "ONBOARDING", onboarding);
  }

  async saveRecommendations(userId: string, recommendations: Recommendation[]): Promise<void> {
    await putUserItem(userId, "RECOMMENDATIONS", recommendations);
  }

  async getTermsAcceptance(userId: string): Promise<TermsAcceptance | null> {
    const result = await dynamo.send(
      new GetCommand({ TableName, Key: { PK: userPk(userId), SK: "TERMS" } })
    );
    return (result.Item?.data as TermsAcceptance | undefined) ?? null;
  }

  // Kept separately from the "reset" data so a reset never erases the consent record.
  async saveTermsAcceptance(userId: string, acceptance: TermsAcceptance): Promise<void> {
    await putUserItem(userId, "TERMS", acceptance);
  }

  async getPlaidItems(userId: string): Promise<StoredPlaidItem[]> {
    const result = await dynamo.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: {
          ":pk": userPk(userId),
          ":prefix": "PLAID#",
        },
      })
    );
    return (result.Items ?? [])
      .map((item) => item.data as StoredPlaidItem | undefined)
      .filter((item): item is StoredPlaidItem => Boolean(item?.itemId));
  }

  async savePlaidItem(userId: string, item: StoredPlaidItem): Promise<void> {
    await dynamo.send(
      new PutCommand({
        TableName,
        Item: {
          PK: userPk(userId),
          SK: `PLAID#${item.itemId}`,
          data: item,
          updatedAt: new Date().toISOString(),
        },
      })
    );
  }

  async deletePlaidItem(userId: string, itemId: string): Promise<void> {
    await dynamo.send(
      new DeleteCommand({
        TableName,
        Key: { PK: userPk(userId), SK: `PLAID#${itemId}` },
      })
    );
  }

  // ── Reconciliation and manual liabilities ────────────────────────────────

  async getReconciliation(userId: string): Promise<ReconciliationDecisions> {
    const result = await dynamo.send(
      new GetCommand({ TableName, Key: { PK: userPk(userId), SK: "RECONCILIATION" } })
    );
    const parsed = reconciliationSchema.safeParse(result.Item?.data ?? {});
    return parsed.success ? parsed.data : { holdings: {} };
  }

  async saveReconciliation(userId: string, decisions: ReconciliationDecisions): Promise<void> {
    await putUserItem(userId, "RECONCILIATION", decisions);
  }

  async getManualLiabilities(userId: string): Promise<ManualLiability[]> {
    const items = await queryUserPrefix(userId, "LIABILITY#");
    return items
      .map((item) => item.data as ManualLiability)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveManualLiability(userId: string, liability: ManualLiability): Promise<void> {
    await dynamo.send(
      new PutCommand({
        TableName,
        Item: { PK: userPk(userId), SK: `LIABILITY#${liability.id}`, data: liability, updatedAt: liability.updatedAt },
      })
    );
  }

  // Returns false when there was nothing to delete.
  async deleteManualLiability(userId: string, id: string): Promise<boolean> {
    const result = await dynamo.send(
      new DeleteCommand({ TableName, Key: { PK: userPk(userId), SK: `LIABILITY#${id}` }, ReturnValues: "ALL_OLD" })
    );
    return Boolean(result.Attributes);
  }

  // ── Savings pools ────────────────────────────────────────────────────────

  async getPools(userId: string): Promise<Pool[]> {
    const items = await queryUserPrefix(userId, "POOL#");
    return items.map((item) => item.data as Pool).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getLedger(userId: string): Promise<AllocationLedger> {
    const result = await dynamo.send(
      new GetCommand({ TableName, Key: { PK: userPk(userId), SK: "POOL_LEDGER" }, ConsistentRead: true })
    );
    if (!result.Item) return { version: 0, allocations: [] };
    return { version: Number(result.Item.version) || 0, allocations: (result.Item.data as AllocationLedger["allocations"]) ?? [] };
  }

  // Writes a pool change atomically: the ledger (guarded by its version), any
  // pool definitions, and history entries all succeed or none do.
  async commitPoolChange(userId: string, change: PoolChange): Promise<number> {
    const nextVersion = change.expectedVersion + 1;
    const now = new Date().toISOString();
    const transactItems: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]> = [
      {
        Put: {
          TableName,
          Item: { PK: userPk(userId), SK: "POOL_LEDGER", version: nextVersion, data: change.allocations, updatedAt: now },
          ConditionExpression: change.expectedVersion === 0 ? "attribute_not_exists(PK) OR version = :v" : "version = :v",
          ExpressionAttributeValues: { ":v": change.expectedVersion },
        },
      },
      ...(change.putPools ?? []).map((pool) => ({
        Put: { TableName, Item: { PK: userPk(userId), SK: `POOL#${pool.id}`, data: pool, updatedAt: pool.updatedAt } },
      })),
      ...(change.deletePoolIds ?? []).map((id) => ({
        Delete: { TableName, Key: { PK: userPk(userId), SK: `POOL#${id}` } },
      })),
      ...change.history.map((entry) => ({
        Put: {
          TableName,
          Item: { PK: userPk(userId), SK: `POOLHIST#${entry.poolId}#${entry.at}#${entry.id}`, data: entry, updatedAt: entry.at },
        },
      })),
    ];
    if (transactItems.length > 100) throw new Error("Too many changes in one request.");
    try {
      await dynamo.send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (error) {
      const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
      if ((error as Error).name === "TransactionCanceledException" && reasons?.[0]?.Code === "ConditionalCheckFailed") {
        throw new LedgerConflictError();
      }
      throw error;
    }
    return nextVersion;
  }

  async getPoolHistory(userId: string, poolId: string, limit = 100): Promise<AllocationHistoryEntry[]> {
    const result = await dynamo.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": userPk(userId), ":prefix": `POOLHIST#${poolId}#` },
        ScanIndexForward: false,
        Limit: limit,
      })
    );
    return (result.Items ?? []).map((item) => item.data as AllocationHistoryEntry);
  }

  // Used when a pool is deleted outright. Best effort, in batches of 25.
  async deletePoolHistory(userId: string, poolId: string): Promise<void> {
    const items = await queryUserPrefix(userId, `POOLHIST#${poolId}#`);
    for (let i = 0; i < items.length; i += 25) {
      await dynamo.send(
        new BatchWriteCommand({
          RequestItems: {
            [TableName]: items.slice(i, i + 25).map((item) => ({ DeleteRequest: { Key: { PK: item.PK, SK: item.SK } } })),
          },
        })
      );
    }
  }

  // ── Financial goals ──────────────────────────────────────────────────────

  async getGoals(userId: string): Promise<Goal[]> {
    const items = await queryUserPrefix(userId, "GOAL#");
    return items.map((item) => item.data as Goal).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async saveGoal(userId: string, goal: Goal): Promise<void> {
    await dynamo.send(
      new PutCommand({ TableName, Item: { PK: userPk(userId), SK: `GOAL#${goal.id}`, data: goal, updatedAt: goal.updatedAt } })
    );
  }

  async deleteGoal(userId: string, id: string): Promise<void> {
    await dynamo.send(new DeleteCommand({ TableName, Key: { PK: userPk(userId), SK: `GOAL#${id}` } }));
  }

  // ── Spending preferences ─────────────────────────────────────────────────

  async getSpendingPrefs(userId: string): Promise<SpendingPrefs> {
    const result = await dynamo.send(new GetCommand({ TableName, Key: { PK: userPk(userId), SK: "SPENDING_PREFS" } }));
    const parsed = spendingPrefsSchema.safeParse(result.Item?.data ?? {});
    return parsed.success ? parsed.data : spendingPrefsSchema.parse({});
  }

  async saveSpendingPrefs(userId: string, prefs: SpendingPrefs): Promise<void> {
    await putUserItem(userId, "SPENDING_PREFS", prefs);
  }

  async getAdvisorPrefs(userId: string): Promise<AdvisorPrefs> {
    const result = await dynamo.send(new GetCommand({ TableName, Key: { PK: userPk(userId), SK: "ADVISOR_PREFS" } }));
    const parsed = advisorPrefsSchema.safeParse(result.Item?.data ?? {});
    return parsed.success ? parsed.data : advisorPrefsSchema.parse({});
  }

  async saveAdvisorPrefs(userId: string, prefs: AdvisorPrefs): Promise<void> {
    await putUserItem(userId, "ADVISOR_PREFS", prefs);
  }

  // Removes portfolio, onboarding, and recommendations (the "reset" button).
  async clearUserData(userId: string): Promise<void> {
    const kinds: UserItemKind[] = ["PORTFOLIO", "ONBOARDING", "RECOMMENDATIONS"];
    await dynamo.send(
      new BatchWriteCommand({
        RequestItems: {
          [TableName]: kinds.map((SK) => ({ DeleteRequest: { Key: { PK: userPk(userId), SK } } })),
        },
      })
    );
  }
}

export const storage = new DynamoStorage();
