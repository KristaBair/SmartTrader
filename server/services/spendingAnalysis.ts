export interface SpendingTransactionInput {
  amount: number;
  category: string;
  primaryCategory: string;
  pending: boolean;
}

export interface SpendingCutbackOption {
  cutPercent: number;
  monthlySavings: number;
  suggestedContributionAfterCut: number;
}

export interface SpendingCategorySummary {
  category: string;
  monthlyAverage: number;
  cutbackOptions: SpendingCutbackOption[];
}

export interface SpendingAnalysisSummary {
  periodStart: string;
  periodEnd: string;
  daysAnalyzed: number;
  transactionsAnalyzed: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlySurplus: number;
  suggestedMonthlyContribution: number;
  categories: SpendingCategorySummary[];
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateSpendingAnalysis(
  transactions: SpendingTransactionInput[],
  periodStart: string,
  periodEnd: string
): SpendingAnalysisSummary {
  const start = new Date(`${periodStart}T00:00:00.000Z`).getTime();
  const end = new Date(`${periodEnd}T00:00:00.000Z`).getTime();
  const daysAnalyzed = Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
  const monthsAnalyzed = daysAnalyzed / 30;
  let incomeTotal = 0;
  let expenseTotal = 0;
  let transactionsAnalyzed = 0;
  const categoryTotals = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.pending || !Number.isFinite(transaction.amount)) continue;

    const primary = transaction.primaryCategory.trim().toUpperCase();
    const category = transaction.category.trim() || "OTHER";
    if (primary.startsWith("TRANSFER") || category.toUpperCase().startsWith("TRANSFER")) {
      continue;
    }
    transactionsAnalyzed += 1;

    if (primary === "INCOME") {
      incomeTotal += Math.abs(transaction.amount);
      continue;
    }

    if (transaction.amount < 0) {
      const previous = categoryTotals.get(category) || 0;
      categoryTotals.set(category, previous + transaction.amount);
      expenseTotal += transaction.amount;
      continue;
    }

    const previous = categoryTotals.get(category) || 0;
    categoryTotals.set(category, previous + transaction.amount);
    expenseTotal += transaction.amount;
  }

  const monthlyIncome = roundMoney(incomeTotal / monthsAnalyzed);
  const monthlyExpenses = roundMoney(Math.max(0, expenseTotal / monthsAnalyzed));
  const monthlySurplus = roundMoney(monthlyIncome - monthlyExpenses);
  const suggestedMonthlyContribution = roundMoney(Math.max(0, monthlySurplus) * 0.5);
  const categories = Array.from(categoryTotals.entries())
    .map(([category, total]) => ({
      category,
      monthlyAverage: roundMoney(Math.max(0, total / monthsAnalyzed)),
    }))
    .filter((category) => category.monthlyAverage > 0)
    .sort((left, right) => right.monthlyAverage - left.monthlyAverage)
    .slice(0, 5)
    .map((category) => ({
      ...category,
      cutbackOptions: [10, 20, 30].map((cutPercent) => {
        const monthlySavings = roundMoney(category.monthlyAverage * cutPercent / 100);
        return {
          cutPercent,
          monthlySavings,
          suggestedContributionAfterCut: roundMoney(
            Math.max(0, monthlySurplus + monthlySavings) * 0.5
          ),
        };
      }),
    }));

  return {
    periodStart,
    periodEnd,
    daysAnalyzed,
    transactionsAnalyzed,
    monthlyIncome,
    monthlyExpenses,
    monthlySurplus,
    suggestedMonthlyContribution,
    categories,
  };
}
