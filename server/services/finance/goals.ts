// Turns stored goals into views with progress and projections. Pure: pool
// values and debt balances are passed in.

import type { LinkedAccount, ManualLiability } from "@shared/finance";
import type { Goal, GoalProjection, GoalView } from "@shared/goals";
import type { PoolView } from "@shared/pools";
import {
  addMonths,
  amortizedPayment,
  debtPayoffMonths,
  monthsToReach,
  monthsUntil,
  requiredMonthly,
  roundMoney,
} from "./projections";

export interface GoalInputs {
  now: Date;
  goals: Goal[];
  pools: PoolView[];
  // Linked credit and loan accounts.
  debtAccounts: LinkedAccount[];
  manualDebts: ManualLiability[];
}

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (a: LinkedAccount) => `${a.name}${a.mask ? ` ••${a.mask}` : ""}`;

export function currentDebtFor(goal: Pick<Goal, "debtAccountKeys" | "manualDebtIds">, debtAccounts: LinkedAccount[], manualDebts: ManualLiability[]) {
  const linked = goal.debtAccountKeys.map((key) => ({ key, account: debtAccounts.find((a) => a.key === key) }));
  const manual = goal.manualDebtIds.map((id) => ({ id, debt: manualDebts.find((d) => d.id === id) }));
  const total = roundMoney(
    linked.reduce((s, l) => s + Math.max(0, l.account?.currentBalance ?? 0), 0)
    + manual.reduce((s, m) => s + (m.debt?.balance ?? 0), 0)
  );
  return { linked, manual, total };
}

export function buildGoalViews(input: GoalInputs): GoalView[] {
  const activeGoalsByPool = new Map<string, string[]>();
  for (const g of input.goals) {
    if (g.status === "archived" || g.status === "completed") continue;
    for (const id of g.poolIds) activeGoalsByPool.set(id, [...(activeGoalsByPool.get(id) ?? []), g.name]);
  }

  return input.goals.map((goal) => {
    const warnings: string[] = [];
    const assumptions: string[] = [];
    const deadlineMonths = goal.deadline ? monthsUntil(input.now, goal.deadline) : null;
    const linkedPools = goal.poolIds.flatMap((id) => {
      const pool = input.pools.find((p) => p.id === id);
      if (!pool) {
        warnings.push("A linked savings pool no longer exists.");
        return [];
      }
      const sharedWith = (activeGoalsByPool.get(id) ?? []).filter((name) => name !== goal.name);
      if (sharedWith.length > 0) warnings.push(`"${pool.name}" also counts toward ${sharedWith.join(", ")}, so the same money appears in more than one goal.`);
      if (pool.warnings.length > 0) warnings.push(`"${pool.name}" has data warnings; see Savings Pools.`);
      return [{ id: pool.id, name: pool.name, verifiedTotal: pool.verifiedTotal, monthly: pool.monthlyContributionGoal }];
    });

    let projection: GoalProjection;
    const linkedDebts: GoalView["linkedDebts"] = [];

    if (goal.type === "debt-payoff") {
      const debt = currentDebtFor(goal, input.debtAccounts, input.manualDebts);
      for (const l of debt.linked) {
        if (l.account) linkedDebts.push({ key: l.key, label: label(l.account), balance: l.account.currentBalance, source: "linked" });
        else warnings.push("A linked debt account isn't available right now, so its balance isn't included.");
      }
      for (const m of debt.manual) {
        if (m.debt) linkedDebts.push({ key: m.id, label: m.debt.name, balance: m.debt.balance, source: "manual" });
        else warnings.push("A debt you entered was removed, so it isn't included.");
      }
      const starting = goal.startingDebt ?? debt.total;
      const paid = roundMoney(Math.max(0, starting - debt.total));
      // A rate is only known for debts the user entered with one.
      const manualWithRates = debt.manual.filter((m) => m.debt && m.debt.interestRate !== null);
      const allRatesKnown = debt.linked.length === 0 && debt.manual.length > 0 && manualWithRates.length === debt.manual.filter((m) => m.debt).length;
      const weightedApr = allRatesKnown && debt.total > 0
        ? manualWithRates.reduce((s, m) => s + m.debt!.balance * (m.debt!.interestRate ?? 0), 0) / debt.total
        : 0;
      const payment = goal.monthlyContribution ?? 0;
      const months = debtPayoffMonths(debt.total, payment, weightedApr);
      const required = deadlineMonths && deadlineMonths > 0 && debt.total > 0 ? roundMoney(amortizedPayment(debt.total, weightedApr, deadlineMonths)) : null;
      projection = {
        currentAmount: paid,
        targetAmount: roundMoney(starting),
        remaining: debt.total,
        progressPercent: starting > 0 ? Math.min(100, roundMoney((paid / starting) * 100)) : debt.total === 0 ? 100 : 0,
        monthsToTarget: months,
        estimatedCompletion: months === null ? null : addMonths(input.now, months),
        requiredMonthly: required,
        onTrack: required !== null && goal.monthlyContribution !== null ? goal.monthlyContribution + 0.005 >= required : null,
        currentDebt: debt.total,
        interestIncluded: allRatesKnown,
      };
      assumptions.push(`Starts from ${usd(starting)} owed when this goal was set.`);
      assumptions.push(payment > 0 ? `Assumes ${usd(payment)} paid every month and no new borrowing.` : "No monthly payment set, so no payoff date can be estimated.");
      if (allRatesKnown) {
        assumptions.push(`Uses a balance-weighted interest rate of ${weightedApr.toFixed(2)}% APR, treated as one loan.`);
      } else {
        assumptions.push("Interest is not included because at least one rate is unknown, so payoff will likely take longer than shown.");
      }
      if (payment > 0 && months === null) warnings.push("At this payment the balance never reaches $0; the payment doesn't cover the interest.");
    } else {
      const current = roundMoney(linkedPools.reduce((s, p) => s + p.verifiedTotal, 0));
      const poolMonthly = linkedPools.reduce((s, p) => s + (p.monthly ?? 0), 0);
      const monthly = goal.monthlyContribution ?? (poolMonthly > 0 ? poolMonthly : null);
      const months = monthly !== null ? monthsToReach(current, monthly, goal.annualReturnPercent, goal.targetAmount) : current >= goal.targetAmount ? 0 : null;
      const required = deadlineMonths && deadlineMonths > 0 && current < goal.targetAmount
        ? roundMoney(requiredMonthly(current, goal.targetAmount, goal.annualReturnPercent, deadlineMonths))
        : null;
      projection = {
        currentAmount: current,
        targetAmount: goal.targetAmount,
        remaining: roundMoney(Math.max(0, goal.targetAmount - current)),
        progressPercent: goal.targetAmount > 0 ? Math.min(100, roundMoney((current / goal.targetAmount) * 100)) : 0,
        monthsToTarget: months,
        estimatedCompletion: months === null ? null : addMonths(input.now, months),
        requiredMonthly: required,
        onTrack: deadlineMonths !== null && months !== null ? months <= deadlineMonths : deadlineMonths !== null && monthly !== null ? false : null,
        currentDebt: null,
        interestIncluded: null,
      };
      if (linkedPools.length === 0) warnings.push("No savings pools are linked, so progress is $0. Link a pool to track money toward this goal.");
      assumptions.push("Progress is the verified value of the linked savings pools.");
      if (goal.monthlyContribution !== null) assumptions.push(`Assumes ${usd(goal.monthlyContribution)} added every month.`);
      else if (monthly !== null) assumptions.push(`Uses the linked pools' combined monthly goals: ${usd(monthly)} a month.`);
      else assumptions.push("No monthly contribution set, so no completion date can be estimated.");
      assumptions.push(goal.annualReturnPercent === 0
        ? "Assumes no investment growth or loss (0% return)."
        : `Assumes a ${goal.annualReturnPercent}% average annual return, compounded monthly. Actual returns vary year to year and can be negative.`);
      if (monthly !== null && months === null) warnings.push("At this contribution the target isn't reached within 100 years.");
    }

    if (goal.deadline && deadlineMonths === 0 && projection.remaining > 0.005) warnings.push("The deadline has arrived or passed.");
    if (projection.onTrack === false && projection.requiredMonthly !== null) {
      warnings.push(`Not on track for the deadline. Reaching it would take about ${usd(projection.requiredMonthly)} a month under these assumptions.`);
    }

    return {
      ...goal,
      projection,
      assumptions,
      warnings: Array.from(new Set(warnings)),
      linkedPools: linkedPools.map(({ id, name, verifiedTotal }) => ({ id, name, verifiedTotal })),
      linkedDebts,
    };
  });
}
