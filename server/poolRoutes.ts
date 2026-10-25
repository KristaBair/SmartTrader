// API for savings pools. Pools are virtual earmarks: nothing here moves money,
// places trades, or contacts an institution except to read balances.
// Registered after requireAuth and the Terms check.

import type { Express, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { storage, LedgerConflictError } from "./storage";
import { getUserId } from "./auth";
import { getMultipleQuotes } from "./services/finnhub";
import { loadLinkedFinancialData, type LinkedFinancialData } from "./services/finance/plaidData";
import {
  buildFundingSources,
  unallocatedByClass,
  validateAllocations,
  valuePools,
  type PriceQuote,
} from "./services/finance/pools";
import {
  allocationInputSchema,
  poolInputSchema,
  type Allocation,
  type AllocationHistoryEntry,
  type FundingSource,
  type Pool,
  type PoolsResponse,
} from "@shared/pools";
import type { DataNotice } from "@shared/finance";

const MAX_POOLS = 200;
const MAX_ALLOCATIONS = 500;

const versionSchema = z.object({ expectedVersion: z.number().int().min(0) });

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function describeAllocation(a: Allocation) {
  return a.kind === "amount"
    ? `${usd(a.amount)} from ${a.accountLabel}`
    : `${a.shares} shares of ${a.symbol ?? a.securityName ?? "a holding"} from ${a.accountLabel}`;
}

function historyEntry(poolId: string, action: AllocationHistoryEntry["action"], description: string): AllocationHistoryEntry {
  return { id: randomUUID().slice(0, 8), poolId, at: new Date().toISOString(), action, description };
}

// Verified quotes only for securities that are actually earmarked, to stay
// well inside the market-data provider's free-tier rate limit.
async function quotesForAllocations(allocations: Allocation[]): Promise<Record<string, PriceQuote>> {
  const symbols = Array.from(new Set(
    allocations.filter((a) => a.kind === "shares" && a.symbol).map((a) => a.symbol!.toUpperCase())
  )).filter((s) => /^[A-Z.\-]{1,10}$/.test(s));
  if (symbols.length === 0) return {};
  const quotes = await getMultipleQuotes(symbols);
  return Object.fromEntries(
    Object.entries(quotes).map(([symbol, q]) => [symbol, { price: q.price, asOf: q.provenance.asOf, source: q.provenance.source }])
  );
}

function linkedNotices(linked: LinkedFinancialData): DataNotice[] {
  const notices: DataNotice[] = [
    { level: "info", code: "POOLS_ARE_VIRTUAL", message: "Savings pools are labels on money you already have. Creating or changing one never moves money, sells investments, or changes your net worth." },
  ];
  if (!linked.plaidConfigured) {
    notices.push({ level: "warning", code: "PLAID_UNAVAILABLE", message: "Account linking isn't configured, so pools can't be funded right now." });
  } else if (linked.institutions.length === 0) {
    notices.push({ level: "info", code: "NO_LINKED_ACCOUNTS", message: "Link an account on My Finances to start assigning money to pools." });
  }
  for (const inst of linked.institutions) {
    if (inst.status !== "connected") {
      notices.push({ level: "warning", code: "INSTITUTION_UNAVAILABLE", message: `${inst.institutionName} couldn't be refreshed. Allocations from it are kept but not verified until it's reconnected.` });
    }
  }
  return notices;
}

async function buildPoolsResponse(userId: string): Promise<PoolsResponse> {
  const [linked, pools, ledger] = await Promise.all([
    loadLinkedFinancialData(userId),
    storage.getPools(userId),
    storage.getLedger(userId),
  ]);
  const quotes = await quotesForAllocations(ledger.allocations);
  const baseSources = buildFundingSources(linked.accounts, linked.holdings, quotes);
  const valued = valuePools({ now: new Date(), pools, allocations: ledger.allocations, baseSources, institutions: linked.institutions });
  return {
    generatedAt: new Date().toISOString(),
    pools: valued.pools,
    sources: valued.sources,
    unallocated: unallocatedByClass(valued.sources),
    ledgerVersion: ledger.version,
    notices: linkedNotices(linked),
  };
}

function sendConflict(res: Response) {
  return res.status(409).json({ code: "LEDGER_CONFLICT", message: new LedgerConflictError().message });
}

export function registerPoolRoutes(app: Express) {
  app.get("/api/pools", async (_req, res) => {
    try {
      res.json(await buildPoolsResponse(getUserId(res)));
    } catch (error) {
      console.error("Load pools error:", error);
      res.status(500).json({ message: "Could not load your savings pools." });
    }
  });

  app.get("/api/pools/:id/history", async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Invalid pool" });
    try {
      res.json(await storage.getPoolHistory(getUserId(res), id.data));
    } catch (error) {
      console.error("Pool history error:", error);
      res.status(500).json({ message: "Could not load this pool's history." });
    }
  });

  app.post("/api/pools", async (req, res) => {
    const body = poolInputSchema.and(versionSchema).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: body.error.issues[0]?.message ?? "Invalid pool" });
    try {
      const userId = getUserId(res);
      const [pools, ledger] = await Promise.all([storage.getPools(userId), storage.getLedger(userId)]);
      if (ledger.version !== body.data.expectedVersion) return sendConflict(res);
      if (pools.length >= MAX_POOLS) return res.status(409).json({ message: `You can have up to ${MAX_POOLS} pools.` });
      const { expectedVersion, ...input } = body.data;
      const now = new Date().toISOString();
      const pool: Pool = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
      await storage.commitPoolChange(userId, {
        expectedVersion,
        allocations: ledger.allocations,
        putPools: [pool],
        history: [historyEntry(pool.id, "pool-created", `Created with a target of ${usd(pool.targetAmount)}`)],
      });
      res.status(201).json(pool);
    } catch (error) {
      if (error instanceof LedgerConflictError) return sendConflict(res);
      console.error("Create pool error:", error);
      res.status(500).json({ message: "Could not create the pool." });
    }
  });

  app.put("/api/pools/:id", async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = poolInputSchema.and(versionSchema).safeParse(req.body);
    if (!id.success || !body.success) return res.status(400).json({ message: body.success ? "Invalid pool" : body.error.issues[0]?.message ?? "Invalid pool" });
    try {
      const userId = getUserId(res);
      const [pools, ledger] = await Promise.all([storage.getPools(userId), storage.getLedger(userId)]);
      if (ledger.version !== body.data.expectedVersion) return sendConflict(res);
      const existing = pools.find((p) => p.id === id.data);
      if (!existing) return res.status(404).json({ message: "Pool not found" });
      const { expectedVersion, ...input } = body.data;
      const pool: Pool = { ...existing, ...input, updatedAt: new Date().toISOString() };
      const action = existing.archived !== pool.archived ? (pool.archived ? "pool-archived" : "pool-restored") : "pool-updated";
      const changes: string[] = [];
      if (existing.targetAmount !== pool.targetAmount) changes.push(`target ${usd(existing.targetAmount)} → ${usd(pool.targetAmount)}`);
      if (existing.targetDate !== pool.targetDate) changes.push(`target date ${existing.targetDate ?? "none"} → ${pool.targetDate ?? "none"}`);
      if (existing.monthlyContributionGoal !== pool.monthlyContributionGoal) {
        changes.push(`monthly goal ${existing.monthlyContributionGoal === null ? "none" : usd(existing.monthlyContributionGoal)} → ${pool.monthlyContributionGoal === null ? "none" : usd(pool.monthlyContributionGoal)}`);
      }
      if (existing.name !== pool.name) changes.push(`renamed to "${pool.name}"`);
      await storage.commitPoolChange(userId, {
        expectedVersion,
        allocations: ledger.allocations,
        putPools: [pool],
        history: [historyEntry(pool.id, action, action === "pool-updated" ? (changes.join("; ") || "Details updated") : action === "pool-archived" ? "Archived" : "Restored")],
      });
      res.json(pool);
    } catch (error) {
      if (error instanceof LedgerConflictError) return sendConflict(res);
      console.error("Update pool error:", error);
      res.status(500).json({ message: "Could not update the pool." });
    }
  });

  // Deletes the pool, releases its allocations, and removes its history.
  app.delete("/api/pools/:id", async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const version = z.coerce.number().int().min(0).safeParse(req.query.expectedVersion);
    if (!id.success || !version.success) return res.status(400).json({ message: "Invalid request" });
    try {
      const userId = getUserId(res);
      const [pools, ledger] = await Promise.all([storage.getPools(userId), storage.getLedger(userId)]);
      if (ledger.version !== version.data) return sendConflict(res);
      if (!pools.some((p) => p.id === id.data)) return res.status(404).json({ message: "Pool not found" });
      await storage.commitPoolChange(userId, {
        expectedVersion: version.data,
        allocations: ledger.allocations.filter((a) => a.poolId !== id.data),
        deletePoolIds: [id.data],
        history: [],
      });
      await storage.deletePoolHistory(userId, id.data);
      res.status(204).end();
    } catch (error) {
      if (error instanceof LedgerConflictError) return sendConflict(res);
      console.error("Delete pool error:", error);
      res.status(500).json({ message: "Could not delete the pool." });
    }
  });

  // ── Allocations ────────────────────────────────────────────────────────

  app.post("/api/pools/allocations", async (req, res) => {
    const body = z.object({ allocation: allocationInputSchema }).and(versionSchema).safeParse(req.body);
    if (!body.success) return res.status(400).json({ message: "Invalid allocation" });
    try {
      const userId = getUserId(res);
      const [pools, ledger, linked] = await Promise.all([
        storage.getPools(userId), storage.getLedger(userId), loadLinkedFinancialData(userId),
      ]);
      if (ledger.version !== body.data.expectedVersion) return sendConflict(res);
      const input = body.data.allocation;
      const pool = pools.find((p) => p.id === input.poolId);
      if (!pool) return res.status(404).json({ message: "Pool not found" });
      if (pool.archived) return res.status(409).json({ message: "Restore this pool before adding money to it." });
      if (ledger.allocations.length >= MAX_ALLOCATIONS) return res.status(409).json({ message: "Too many allocations. Combine or release some first." });

      const baseSources = buildFundingSources(linked.accounts, linked.holdings, {});
      const source = findSource(baseSources, input);
      if (!source) return res.status(422).json({ message: "That account or holding isn't available right now. Refresh and try again." });

      // Adding to an existing allocation from the same source merges into it.
      const existing = ledger.allocations.find((a) => a.poolId === input.poolId && sameSource(a, input));
      const now = new Date().toISOString();
      let after: Allocation[];
      let saved: Allocation;
      if (existing) {
        saved = existing.kind === "amount" && input.kind === "amount"
          ? { ...existing, amount: round2(existing.amount + input.amount), updatedAt: now }
          : existing.kind === "shares" && input.kind === "shares"
            ? { ...existing, shares: round6(existing.shares + input.shares), updatedAt: now }
            : existing;
        after = ledger.allocations.map((a) => (a.id === existing.id ? saved : a));
      } else {
        saved = {
          ...input,
          id: randomUUID(),
          itemId: source.itemId,
          accountLabel: accountLabelFor(linked, source.accountKey),
          assetClass: source.assetClass,
          symbol: source.symbol,
          securityName: source.kind === "shares" ? linked.holdings.find((h) => h.accountKey === source.accountKey && h.securityKey === source.securityKey)?.name ?? null : null,
          createdAt: now,
          updatedAt: now,
        };
        after = [...ledger.allocations, saved];
      }
      const errors = validateAllocations(baseSources, ledger.allocations, after);
      if (errors.length > 0) return res.status(422).json({ code: "ALLOCATION_EXCEEDS_AVAILABLE", message: errors.join(" ") });

      await storage.commitPoolChange(userId, {
        expectedVersion: ledger.version,
        allocations: after,
        history: [historyEntry(pool.id, existing ? "changed" : "allocated", existing
          ? `Added ${input.kind === "amount" ? usd(input.amount) : `${input.shares} shares`} to ${describeAllocation(existing)} (now ${describeAllocation(saved)})`
          : `Allocated ${describeAllocation(saved)}`)],
      });
      res.status(201).json(saved);
    } catch (error) {
      if (error instanceof LedgerConflictError) return sendConflict(res);
      console.error("Create allocation error:", error);
      res.status(500).json({ message: "Could not save the allocation." });
    }
  });

  app.put("/api/pools/allocations/:id", async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const body = z.object({ value: z.number().finite().positive().max(1_000_000_000) }).and(versionSchema).safeParse(req.body);
    if (!id.success || !body.success) return res.status(400).json({ message: "Invalid allocation change" });
    try {
      const userId = getUserId(res);
      const [ledger, linked] = await Promise.all([storage.getLedger(userId), loadLinkedFinancialData(userId)]);
      if (ledger.version !== body.data.expectedVersion) return sendConflict(res);
      const existing = ledger.allocations.find((a) => a.id === id.data);
      if (!existing) return res.status(404).json({ message: "Allocation not found" });
      const updated: Allocation = existing.kind === "amount"
        ? { ...existing, amount: round2(body.data.value), updatedAt: new Date().toISOString() }
        : { ...existing, shares: round6(body.data.value), updatedAt: new Date().toISOString() };
      const after = ledger.allocations.map((a) => (a.id === existing.id ? updated : a));
      const errors = validateAllocations(buildFundingSources(linked.accounts, linked.holdings, {}), ledger.allocations, after);
      if (errors.length > 0) return res.status(422).json({ code: "ALLOCATION_EXCEEDS_AVAILABLE", message: errors.join(" ") });
      await storage.commitPoolChange(userId, {
        expectedVersion: ledger.version,
        allocations: after,
        history: [historyEntry(existing.poolId, "changed", `Changed ${describeAllocation(existing)} to ${existing.kind === "amount" ? usd(round2(body.data.value)) : `${round6(body.data.value)} shares`}`)],
      });
      res.json(updated);
    } catch (error) {
      if (error instanceof LedgerConflictError) return sendConflict(res);
      console.error("Update allocation error:", error);
      res.status(500).json({ message: "Could not update the allocation." });
    }
  });

  // Releasing never needs live data: removing an earmark is always allowed.
  app.delete("/api/pools/allocations/:id", async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const version = z.coerce.number().int().min(0).safeParse(req.query.expectedVersion);
    if (!id.success || !version.success) return res.status(400).json({ message: "Invalid request" });
    try {
      const userId = getUserId(res);
      const ledger = await storage.getLedger(userId);
      if (ledger.version !== version.data) return sendConflict(res);
      const existing = ledger.allocations.find((a) => a.id === id.data);
      if (!existing) return res.status(404).json({ message: "Allocation not found" });
      await storage.commitPoolChange(userId, {
        expectedVersion: ledger.version,
        allocations: ledger.allocations.filter((a) => a.id !== id.data),
        history: [historyEntry(existing.poolId, "released", `Released ${describeAllocation(existing)}`)],
      });
      res.status(204).end();
    } catch (error) {
      if (error instanceof LedgerConflictError) return sendConflict(res);
      console.error("Release allocation error:", error);
      res.status(500).json({ message: "Could not release the allocation." });
    }
  });
}

function accountLabelFor(linked: LinkedFinancialData, accountKey: string) {
  const account = linked.accounts.find((a) => a.key === accountKey);
  return account ? `${account.name}${account.mask ? ` ••${account.mask}` : ""}` : "Linked account";
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

function sameSource(a: Allocation, input: z.infer<typeof allocationInputSchema>) {
  if (a.kind !== input.kind || a.accountKey !== input.accountKey) return false;
  return a.kind === "amount" || (input.kind === "shares" && a.securityKey === input.securityKey);
}

function findSource(sources: FundingSource[], input: z.infer<typeof allocationInputSchema>) {
  return sources.find((s) =>
    s.kind === input.kind
    && s.accountKey === input.accountKey
    && (input.kind === "amount" || s.securityKey === input.securityKey)
  );
}
