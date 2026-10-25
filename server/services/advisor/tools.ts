// Tools the AI Advisor can call. Each returns results of the app's own
// deterministic calculations, reduced to what the question needs. Per the
// Terms, nothing here includes Plaid credentials, account numbers, institution
// names, merchant names, or individual transactions.

import { loadFinancialOverview } from "../../financeRoutes";
import { buildPoolsResponse } from "../../poolRoutes";
import { loadGoals } from "../../goalRoutes";
import { loadCashflow, loadPlannerDefaults } from "../../planningRoutes";
import { calculateRent, calculateRetirement } from "../finance/planners";
import { addMonths, monthsToReach, monthsUntil, requiredMonthly, roundMoney } from "../finance/projections";
import { rentInputSchema, retirementInputSchema } from "@shared/planners";
import type { AdvisorPrefs } from "@shared/advisor";
import type { AssetClass } from "@shared/finance";

export interface ToolContext {
  userId: string;
  prefs: AdvisorPrefs;
  now: Date;
  // Results already loaded for this question, so each source is read once.
  memo: Map<string, Promise<unknown>>;
}

type Permission = "accounts" | "spending" | "poolsGoals";

export interface AdvisorTool {
  name: string;
  description: string;
  // Plain-language label shown to the user under "Based on".
  source: string;
  needs: Permission[];
  inputSchema: Record<string, unknown>;
  run: (ctx: ToolContext, input: Record<string, unknown>) => Promise<unknown>;
}

const once = <T>(ctx: ToolContext, key: string, load: () => Promise<T>): Promise<T> => {
  if (!ctx.memo.has(key)) ctx.memo.set(key, load());
  return ctx.memo.get(key) as Promise<T>;
};
const overview = (ctx: ToolContext) => once(ctx, "overview", () => loadFinancialOverview(ctx.userId));
const cashflow = (ctx: ToolContext) => once(ctx, "cashflow", () => loadCashflow(ctx.userId));
const pools = (ctx: ToolContext) => once(ctx, "pools", () => buildPoolsResponse(ctx.userId));
const goals = (ctx: ToolContext) => once(ctx, "goals", () => loadGoals(ctx.userId));
const defaults = (ctx: ToolContext) => once(ctx, "defaults", () => loadPlannerDefaults(ctx.userId));

function summarizePoolAllocation(
  a: Awaited<ReturnType<typeof pools>>["pools"][number]["allocations"][number],
  includeInvestmentDetails: boolean
) {
  return {
    kind: a.kind,
    assetClass: a.assetClass,
    symbol: includeInvestmentDetails && a.kind === "shares" ? a.symbol : null,
    securityName: includeInvestmentDetails && a.kind === "shares" ? a.securityName : null,
    shares: includeInvestmentDetails && a.kind === "shares" ? a.shares : null,
    amountAllocated: includeInvestmentDetails && a.kind === "amount" ? a.amount : null,
    verifiedValue: a.verifiedValue,
    state: a.state,
    priceAsOf: a.priceAsOf,
    securityDetailsAvailable: includeInvestmentDetails,
  };
}

const allowed = (ctx: ToolContext, needs: Permission) =>
  needs === "accounts" ? ctx.prefs.useAccounts : needs === "spending" ? ctx.prefs.useSpending : ctx.prefs.usePoolsAndGoals;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// Data-quality flags without institution names.
function qualityFlags(codes: string[]) {
  const map: Record<string, string> = {
    REAUTH_REQUIRED: "At least one institution needs to be reconnected; its accounts are not included.",
    INSTITUTION_UNAVAILABLE: "At least one institution couldn't be refreshed; its accounts are not included.",
    RECONCILIATION_NEEDED: "Some manual entries are left out until the user confirms they aren't duplicates of linked accounts.",
    UNPRICED_HOLDINGS: "Some manually entered holdings have no verified price and aren't valued.",
    NON_USD_EXCLUDED: "Non-USD accounts are excluded.",
    NO_LINKED_ACCOUNTS: "No accounts are linked; totals include only manual entries.",
    CASH_FLOW_NOT_LINKED: "No bank account is linked for spending, so income and spending are unknown.",
    CASH_FLOW_UNAVAILABLE: "Income and spending couldn't be loaded right now.",
    LIABILITIES_PARTIAL: "Debts include linked cards and loans plus debts the user entered; unlinked loans may be missing.",
  };
  return Array.from(new Set(codes.map((c) => map[c]).filter(Boolean)));
}

export const ADVISOR_TOOLS: AdvisorTool[] = [
  {
    name: "get_financial_overview",
    description: "Net worth, assets by type (cash, savings, CDs, taxable investments, retirement, restricted), debts, and data-quality flags from linked accounts and manual entries.",
    source: "Your reconciled financial overview",
    needs: ["accounts"],
    inputSchema: { type: "object", properties: {} },
    run: async (ctx) => {
      const o = await overview(ctx);
      const byClass = new Map<AssetClass, { count: number; total: number }>();
      for (const a of o.accounts) {
        const row = byClass.get(a.assetClass) ?? { count: 0, total: 0 };
        row.count += 1;
        row.total = roundMoney(row.total + (a.currentBalance ?? 0));
        byClass.set(a.assetClass, row);
      }
      return {
        asOf: o.generatedAt,
        totals: o.totals,
        linkedAccountsByType: Object.fromEntries(byClass),
        manualDebts: o.manualLiabilities.map((d) => ({ kind: d.kind, balance: d.balance, monthlyPayment: d.monthlyPayment, interestRate: d.interestRate })),
        dataQuality: qualityFlags(o.notices.map((n) => n.code)),
      };
    },
  },
  {
    name: "get_investment_holdings",
    description: "The user's linked investment positions and manually entered holdings, grouped by stable security identity, with account type association, shares, institution-reported values, available cost basis, and data-quality status. Use for portfolio composition, concentration, and diversification questions.",
    source: "Your linked investment holdings",
    needs: ["accounts"],
    inputSchema: { type: "object", properties: {} },
    run: async (ctx) => {
      const o = await overview(ctx);
      const positions = o.investmentPositions;
      const linkedInvestmentPositions = positions.filter((p) => !p.isCashEquivalent && p.linkedPositions.length > 0);
      const linkedPositionRows = linkedInvestmentPositions.flatMap((position) =>
        position.linkedPositions.map((linked) => ({ position, linked }))
      );
      const knownUsdValue = roundMoney(linkedPositionRows.reduce(
        (sum, row) => sum + (row.linked.currency === "USD" ? row.linked.marketValue ?? 0 : 0),
        0
      ));
      const valueCoverageComplete = linkedPositionRows.length > 0
        && linkedPositionRows.every((row) => row.linked.currency === "USD" && row.linked.marketValue !== null)
        && !o.notices.some((n) => n.code === "REAUTH_REQUIRED" || n.code === "INSTITUTION_UNAVAILABLE");

      const concentration = new Map<string, { symbol: string | null; name: string; value: number }>();
      for (const { position, linked } of linkedPositionRows) {
        if (linked.currency !== "USD" || linked.marketValue === null) continue;
        const key = position.symbol?.toUpperCase() || position.name.toLowerCase();
        const existing = concentration.get(key) ?? { symbol: position.symbol, name: position.name, value: 0 };
        existing.value = roundMoney(existing.value + linked.marketValue);
        concentration.set(key, existing);
      }
      const concentrationBySecurity = Array.from(concentration.values())
        .map((entry) => ({
          ...entry,
          percentOfKnownUsdHoldings: knownUsdValue > 0 ? roundMoney((entry.value / knownUsdValue) * 100) : null,
        }))
        .sort((a, b) => b.value - a.value);

      return {
        asOf: o.generatedAt,
        knownUsdValue,
        valueCoverageComplete,
        concentrationDenominator: "Known USD values from linked non-cash-equivalent positions only",
        concentrationBySecurity,
        positions: positions.map((p) => ({
          symbol: p.symbol,
          name: p.name,
          securityType: p.securityType,
          securityCategory: p.securityCategory,
          cashEquivalent: p.isCashEquivalent,
          currency: p.currency,
          consolidatedSource: p.source,
          linkedAccounts: p.linkedPositions.map((account) => ({
            accountClass: account.accountClass,
            accountType: account.accountType,
            accountSubtype: account.accountSubtype,
            shares: account.shares,
            marketValue: account.marketValue,
            costBasis: account.costBasis,
            currency: account.currency,
            reportedPrice: account.reportedPrice,
            priceAsOf: account.priceAsOf,
            retrievedAt: account.retrievedAt,
            stalePrice: account.stalePrice,
          })),
          manualEntries: p.manualEntries.map((entry) => ({
            shares: entry.shares,
            marketValue: entry.marketValue,
            status: entry.status,
            priceAsOf: entry.priceAsOf,
          })),
        })),
        dataQuality: {
          flags: qualityFlags(o.notices.map((n) => n.code)),
          unpricedPositionCount: linkedPositionRows.filter((row) => row.linked.marketValue === null).length,
          incompleteValueCount: linkedPositionRows.filter((row) => row.linked.marketValue === null || row.linked.currency !== "USD").length,
          stalePriceCount: linkedPositionRows.filter((row) => row.linked.stalePrice).length,
          costBasisMissingCount: linkedPositionRows.filter((row) => row.linked.costBasis === null).length,
          feesAvailable: false,
          fundLookThroughAvailable: false,
          sectorClassificationAvailable: false,
          limitations: [
            "Plaid does not provide expense ratios or fees in this holdings response.",
            "ETF and mutual-fund underlying company holdings are not included.",
            "Security sector classifications are not available, so sector exposure must not be inferred.",
            "Position market values come from the institution and can be missing or stale.",
          ],
        },
      };
    },
  },
  {
    name: "get_spending_summary",
    description: "Monthly income, spending by type (essential, discretionary, unclassified, debt payments, fees), surplus, top spending categories, recurring charges totals, and pre-calculated savings scenarios.",
    source: "Your spending analysis",
    needs: ["spending"],
    inputSchema: { type: "object", properties: {} },
    run: async (ctx) => {
      const s = (await cashflow(ctx)).spending;
      if (!s) return { available: false, reason: "No completed bank transactions are available from a spending connection." };
      const subs = s.recurring.filter((r) => r.likelySubscription);
      return {
        available: true,
        period: { start: s.periodStart, end: s.periodEnd, days: s.daysCovered },
        income: s.income,
        monthly: s.monthly,
        topCategories: s.categories.slice(0, 10).map((c) => ({ category: c.label, type: c.class, monthlyAverage: c.monthlyAverage, changePercentLast30Days: c.changePercent })),
        recurring: {
          count: s.recurring.length,
          monthlyTotal: roundMoney(s.recurring.reduce((t, r) => t + r.monthlyEquivalent, 0)),
          likelySubscriptions: subs.length,
          subscriptionsMonthlyTotal: roundMoney(subs.reduce((t, r) => t + r.monthlyEquivalent, 0)),
        },
        // Subscription scenario descriptions name merchants, so only the math is shared.
        savingsScenarios: s.scenarios.map((x) => ({ title: x.id === "review-subscriptions" ? "Review recurring subscriptions" : x.title, monthlySavings: x.monthlySavings, annualSavings: x.annualSavings })),
      };
    },
  },
  {
    name: "get_savings_pools",
    description: "The user's savings pools (e.g. ring fund, house fund): target, verified amount set aside, progress, monthly goal, estimated completion, and which types of money fund them.",
    source: "Your savings pools",
    needs: ["poolsGoals"],
    inputSchema: { type: "object", properties: {} },
    run: async (ctx) => {
      const p = await pools(ctx);
      return {
        note: "Pools are earmarks on existing money, not extra money; they are not added to net worth.",
        pools: p.pools.filter((x) => !x.archived).map((x) => ({
          name: x.name, category: x.category, target: x.targetAmount, verifiedAmount: x.verifiedTotal, unverifiedAmount: x.unverifiedAmount,
          progressPercent: x.progressPercent, remaining: x.remaining, monthlyGoal: x.monthlyContributionGoal, targetDate: x.targetDate,
          estimatedCompletion: x.estimatedCompletion, requiredMonthlyForTargetDate: x.requiredMonthly,
          fundedFrom: Array.from(new Set(x.allocations.map((a) => a.assetClass))), warningCount: x.warnings.length,
          investmentDetailsAvailable: ctx.prefs.useAccounts,
          allocations: ctx.prefs.useAccounts ? x.allocations.map((a) => summarizePoolAllocation(a, true)) : null,
        })),
        unassignedByType: p.unallocated,
      };
    },
  },
  {
    name: "get_goals",
    description: "The user's financial goals with progress, deadline, monthly plan, projected completion, amount needed per month for the deadline, and stated assumptions.",
    source: "Your financial goals",
    needs: ["poolsGoals"],
    inputSchema: { type: "object", properties: {} },
    run: async (ctx) => {
      const [g, p] = await Promise.all([goals(ctx), pools(ctx)]);
      return {
        goals: g.goals.filter((x) => x.status !== "archived").map((x) => ({
          name: x.name, type: x.type, status: x.status, deadline: x.deadline, monthlyContribution: x.monthlyContribution,
          assumedAnnualReturnPercent: x.annualReturnPercent, ...x.projection, assumptions: x.assumptions, warnings: x.warnings,
          linkedPools: x.linkedPools.map((linkedPool) => {
            const pool = p.pools.find((candidate) => candidate.id === linkedPool.id);
            return {
              name: linkedPool.name,
              verifiedAmount: linkedPool.verifiedTotal,
              investmentDetailsAvailable: ctx.prefs.useAccounts,
              allocations: ctx.prefs.useAccounts ? pool?.allocations.map((a) => summarizePoolAllocation(a, true)) ?? [] : null,
            };
          }),
        })),
      };
    },
  },
  {
    name: "get_emergency_fund_plan",
    description: "Essential monthly expenses, money accessible in an emergency (cash and savings only), money set aside in emergency pools, and 3/6/9-month targets with gaps and monthly amounts to close them.",
    source: "Your Emergency Fund Planner",
    needs: ["accounts", "spending"],
    inputSchema: { type: "object", properties: {} },
    run: async (ctx) => {
      const e = (await cashflow(ctx)).emergency;
      return { ...e, notices: e.notices.filter((n) => !/couldn't be refreshed/.test(n)) };
    },
  },
  {
    name: "calculate_rent_affordability",
    description: "Compares rent limits under several budgeting methods and returns conservative, moderate, and higher-cost rent scenarios with tradeoffs. Uses the user's data for any input not given. Ask the user for gross income if it matters and isn't known.",
    source: "The Rent Affordability Planner",
    needs: ["spending"],
    inputSchema: {
      type: "object",
      properties: {
        monthlyTakeHome: { type: "number", description: "Override detected take-home pay" },
        grossMonthlyIncome: { type: "number", description: "Monthly pre-tax income, if the user stated it" },
        bufferPercent: { type: "number" },
      },
    },
    run: async (ctx, input) => {
      const d = (await defaults(ctx)).rent;
      const { sources, currentRent, ...base } = d;
      void sources;
      const parsed = rentInputSchema.safeParse({
        ...base,
        ...(num(input.monthlyTakeHome) !== undefined ? { monthlyTakeHome: num(input.monthlyTakeHome) } : {}),
        ...(num(input.grossMonthlyIncome) !== undefined ? { grossMonthlyIncome: num(input.grossMonthlyIncome) } : {}),
        ...(num(input.bufferPercent) !== undefined ? { bufferPercent: num(input.bufferPercent) } : {}),
      });
      if (!parsed.success) return { error: parsed.error.issues[0]?.message };
      if (parsed.data.monthlyTakeHome === 0) return { error: "Take-home pay is unknown. Ask the user for their monthly take-home pay." };
      return { currentRentInData: currentRent, ...calculateRent(parsed.data) };
    },
  },
  {
    name: "calculate_retirement_projection",
    description: "Projects retirement savings under cautious, middle, and optimistic return/inflation scenarios. Requires the user's current age, retirement age, and expected monthly retirement spending; never guess these, ask the user. Current savings defaults to linked retirement account balances.",
    source: "The Retirement Planner",
    needs: [],
    inputSchema: {
      type: "object",
      properties: {
        currentAge: { type: "integer" },
        retirementAge: { type: "integer" },
        retirementSpendingMonthly: { type: "number", description: "In today's dollars" },
        currentSavings: { type: "number" },
        monthlyContribution: { type: "number" },
        employerMonthlyContribution: { type: "number" },
        otherIncomeMonthly: { type: "number", description: "e.g. Social Security estimate, today's dollars" },
      },
      required: ["currentAge", "retirementAge", "retirementSpendingMonthly"],
    },
    run: async (ctx, input) => {
      const missing = ["currentAge", "retirementAge", "retirementSpendingMonthly"].filter((k) => num(input[k]) === undefined);
      if (missing.length > 0) return { error: `Missing required information: ${missing.join(", ")}. Ask the user.` };
      let currentSavings = num(input.currentSavings);
      let savingsSource = "stated by the user";
      if (currentSavings === undefined) {
        if (!ctx.prefs.useAccounts) return { error: "Current retirement savings are unknown and account access is turned off. Ask the user." };
        currentSavings = (await defaults(ctx)).retirement.retirementAccountsTotal;
        savingsSource = "linked retirement account balances";
      }
      const parsed = retirementInputSchema.safeParse({
        currentAge: num(input.currentAge), retirementAge: num(input.retirementAge), retirementSpendingMonthly: num(input.retirementSpendingMonthly),
        currentSavings, monthlyContribution: num(input.monthlyContribution) ?? 0, employerMonthlyContribution: num(input.employerMonthlyContribution) ?? 0,
        otherIncomeMonthly: num(input.otherIncomeMonthly) ?? 0,
      });
      if (!parsed.success) return { error: parsed.error.issues[0]?.message };
      const assumed = ["monthlyContribution", "employerMonthlyContribution", "otherIncomeMonthly"].filter((k) => num(input[k]) === undefined);
      return { currentSavingsSource: savingsSource, assumedZero: assumed, ...calculateRetirement(parsed.data) };
    },
  },
  {
    name: "project_savings_goal",
    description: "How long it takes to reach a savings target at a monthly amount, or the monthly amount needed by a date. Starting amount can come from one of the user's pools by name.",
    source: "Savings projection",
    needs: [],
    inputSchema: {
      type: "object",
      properties: {
        targetAmount: { type: "number" },
        monthlyAmount: { type: "number" },
        startingAmount: { type: "number" },
        poolName: { type: "string", description: "Use this pool's verified amount as the starting amount" },
        targetDate: { type: "string", description: "YYYY-MM-DD" },
        annualReturnPercent: { type: "number", description: "Defaults to 0 (no growth assumed)" },
      },
      required: ["targetAmount"],
    },
    run: async (ctx, input) => {
      const target = num(input.targetAmount);
      if (target === undefined || target <= 0) return { error: "A target amount is required. Ask the user." };
      let start = num(input.startingAmount) ?? 0;
      let startSource = num(input.startingAmount) !== undefined ? "stated by the user" : "assumed $0";
      const poolName = str(input.poolName);
      if (poolName) {
        if (!ctx.prefs.usePoolsAndGoals) return { error: "Pool access is turned off. Ask the user how much they have saved." };
        const match = (await pools(ctx)).pools.find((p) => p.name.toLowerCase() === poolName.toLowerCase());
        if (!match) return { error: `No pool named "${poolName}".` };
        start = match.verifiedTotal;
        startSource = `verified amount in the "${match.name}" pool`;
      }
      const rate = num(input.annualReturnPercent) ?? 0;
      const monthly = num(input.monthlyAmount);
      const date = str(input.targetDate);
      const months = monthly !== undefined ? monthsToReach(start, monthly, rate, target) : null;
      const monthsLeft = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? monthsUntil(ctx.now, date) : null;
      return {
        startingAmount: start, startingAmountSource: startSource, targetAmount: target, monthlyAmount: monthly ?? null, annualReturnPercent: rate,
        monthsToTarget: months, reachedBy: months === null ? null : addMonths(ctx.now, months),
        requiredMonthlyForDate: monthsLeft && monthsLeft > 0 ? roundMoney(requiredMonthly(start, target, rate, monthsLeft)) : null,
        assumptions: [`${rate}% annual return${rate === 0 ? " (no growth)" : ", compounded monthly; returns vary and can be negative"}.`, "The monthly amount is added every month."],
      };
    },
  },
  {
    name: "evaluate_purchase",
    description: "Checks how a purchase (down payment and/or new monthly payment) would affect monthly surplus, emergency cash coverage, and the monthly amounts the user's active goals need.",
    source: "Purchase impact check",
    needs: ["accounts", "spending"],
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        upfrontCost: { type: "number", description: "Down payment or cash price paid now" },
        monthlyPayment: { type: "number", description: "New monthly cost (loan payment, insurance, etc.)" },
      },
    },
    run: async (ctx, input) => {
      const upfront = num(input.upfrontCost) ?? 0;
      const monthly = num(input.monthlyPayment) ?? 0;
      if (upfront === 0 && monthly === 0) return { error: "Ask the user for the upfront cost and/or monthly payment." };
      const c = await cashflow(ctx);
      const surplus = c.spending?.monthly.surplus ?? null;
      const essentials = c.emergency.essentialMonthly;
      const accessible = c.emergency.accessible.total;
      const goalNeeds = ctx.prefs.usePoolsAndGoals
        ? (await goals(ctx)).goals.filter((g) => g.status === "active").map((g) => ({ name: g.name, neededMonthly: g.projection.requiredMonthly ?? g.monthlyContribution ?? 0 }))
        : [];
      const goalMonthlyTotal = roundMoney(goalNeeds.reduce((t, g) => t + g.neededMonthly, 0));
      return {
        purchase: str(input.description) ?? "purchase",
        upfrontCost: upfront,
        monthlyPayment: monthly,
        monthlySurplusBefore: surplus,
        monthlySurplusAfter: surplus === null ? null : roundMoney(surplus - monthly),
        accessibleCashBefore: accessible,
        accessibleCashAfter: roundMoney(accessible - upfront),
        monthsOfEssentialsCoveredBefore: essentials > 0 ? roundMoney(accessible / essentials) : null,
        monthsOfEssentialsCoveredAfter: essentials > 0 ? roundMoney((accessible - upfront) / (essentials + monthly)) : null,
        activeGoalsMonthlyNeeds: goalNeeds,
        activeGoalsMonthlyTotal: goalMonthlyTotal,
        surplusLeftForGoalsAfter: surplus === null ? null : roundMoney(surplus - monthly - goalMonthlyTotal),
        notes: ["Accessible cash counts only checking and savings.", "Goal needs use each goal's required monthly amount for its deadline, or its monthly plan."],
      };
    },
  },
];

export async function runTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = ADVISOR_TOOLS.find((t) => t.name === name);
  if (!tool) return { error: `Unknown tool ${name}` };
  const blocked = tool.needs.filter((n) => !allowed(ctx, n));
  if (blocked.length > 0) {
    return { error: `The user has turned off advisor access to: ${blocked.map((b) => (b === "poolsGoals" ? "pools and goals" : b)).join(", ")}. Don't guess this information; ask the user or explain it isn't available.` };
  }
  try {
    return await tool.run(ctx, input);
  } catch (error) {
    console.error(`Advisor tool ${name} failed:`, error);
    return { error: "This data couldn't be loaded right now." };
  }
}
