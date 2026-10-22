// DynamoDB storage. Single-table layout:
//
//   PK                 SK                 data
//   USER#<cognitoSub>  PORTFOLIO          SavedPortfolio
//   USER#<cognitoSub>  ONBOARDING         SavedOnboarding
//   USER#<cognitoSub>  RECOMMENDATIONS    Recommendation[]
//   MARKET#<symbol>    QUOTE              MarketData (fallback when Finnhub has no price)
//
// Every user item is keyed by the Cognito `sub` taken from a verified token, so one
// user can never read or write another user's partition.

import {
  BatchGetCommand,
  BatchWriteCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { awsConfig, dynamo } from "./aws";
import type {
  MarketData,
  Recommendation,
  SavedOnboarding,
  SavedPortfolio,
  UserData,
} from "@shared/schema";

const TableName = awsConfig.tableName;

type UserItemKind = "PORTFOLIO" | "ONBOARDING" | "RECOMMENDATIONS";

const userPk = (userId: string) => `USER#${userId}`;

async function putUserItem(userId: string, sk: UserItemKind, data: unknown) {
  await dynamo.send(
    new PutCommand({
      TableName,
      Item: { PK: userPk(userId), SK: sk, data, updatedAt: new Date().toISOString() },
    })
  );
}

export class DynamoStorage {
  constructor() {
    // Seed fallback market data on startup
    this.initializeMarketData();
  }

  private async initializeMarketData() {
    const seed: MarketData[] = [
      { symbol: "SPY", price: "432.78", change: "5.12", changePercent: "1.2" },
      { symbol: "QQQ", price: "343.34", change: "7.68", changePercent: "2.1" },
      { symbol: "VIX", price: "16.82", change: "-0.13", changePercent: "-0.8" },
    ];

    for (const data of seed) {
      try {
        await dynamo.send(
          new PutCommand({
            TableName,
            Item: { PK: `MARKET#${data.symbol}`, SK: "QUOTE", ...data, updatedAt: new Date().toISOString() },
            // Never overwrite a value that is already there
            ConditionExpression: "attribute_not_exists(PK)",
          })
        );
      } catch (error) {
        if ((error as Error).name !== "ConditionalCheckFailedException") {
          console.log("Market data initialization skipped:", error);
        }
      }
    }
  }

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

  // ── Market data fallback ─────────────────────────────────────────────────

  // Looks up stored quotes by key. Missing symbols are simply left out.
  async getMarketDataBySymbols(symbols: string[]): Promise<MarketData[]> {
    const result = await dynamo.send(
      new BatchGetCommand({
        RequestItems: {
          [TableName]: { Keys: symbols.map((symbol) => ({ PK: `MARKET#${symbol}`, SK: "QUOTE" })) },
        },
      })
    );
    return (result.Responses?.[TableName] ?? []) as MarketData[];
  }
}

export const storage = new DynamoStorage();
