// Rent affordability and retirement projections. Pure, deterministic, and
// explicit about every assumption so results can be shown with their math.

import type { RentInput, RentMethod, RentResult, RentScenario, RetirementInput, RetirementResult, RetirementScenario } from "@shared/planners";
import { futureValue, monthlyRate, requiredMonthly, roundMoney } from "./projections";

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const floor10 = (v: number) => Math.max(0, Math.floor(v / 10) * 10);
const pct = (part: number, whole: number) => (whole > 0 ? roundMoney((part / whole) * 100) : 0);

// ── Rent ────────────────────────────────────────────────────────────────────

export function calculateRent(input: RentInput): RentResult {
  const takeHome = input.monthlyTakeHome;
  const gross = input.grossMonthlyIncome;
  const nonRentNeeds = roundMoney(input.debtPayments + input.utilities + input.transportation + input.insurance + input.groceries + input.otherEssentials);
  const savingsCommitments = roundMoney(input.emergencyFundContribution + input.otherSavings);
  const buffer = roundMoney(takeHome * input.bufferPercent / 100);
  const conservativeBufferPercent = Math.max(input.bufferPercent, 10);
  const conservativeBuffer = roundMoney(takeHome * conservativeBufferPercent / 100);
  const residual = (bufferAmount: number, savings: number) => roundMoney(takeHome - nonRentNeeds - input.discretionary - savings - bufferAmount);

  const methods: RentMethod[] = [
    {
      id: "gross-30",
      name: "30% of gross income",
      maxRent: gross !== null ? roundMoney(gross * 0.3) : null,
      explanation: "A common rule of thumb, and the same as the landlord screening rule of earning 40× the monthly rent. It ignores your debts, other costs, and savings, so it can overstate what's comfortable.",
      calculation: gross !== null ? `${usd(gross)} × 30% = ${usd(roundMoney(gross * 0.3))}` : "Enter your gross (pre-tax) income to see this.",
      referenceOnly: true,
    },
    {
      id: "fifty-thirty-twenty",
      name: "50/30/20 budget",
      maxRent: roundMoney(Math.max(0, takeHome * 0.5 - nonRentNeeds)),
      explanation: "Half of take-home pay covers all needs. Rent is what's left of that half after your other needs (utilities, transportation, insurance, groceries, debt payments).",
      calculation: `${usd(takeHome)} × 50% − ${usd(nonRentNeeds)} other needs = ${usd(roundMoney(Math.max(0, takeHome * 0.5 - nonRentNeeds)))}`,
      referenceOnly: false,
    },
    {
      id: "dti-36",
      name: "Debt-to-income limit (36%)",
      maxRent: gross !== null ? roundMoney(Math.max(0, gross * 0.36 - input.debtPayments)) : null,
      explanation: "Keeps housing plus debt payments at or below 36% of gross income, a limit lenders commonly use.",
      calculation: gross !== null ? `${usd(gross)} × 36% − ${usd(input.debtPayments)} debt payments = ${usd(roundMoney(Math.max(0, gross * 0.36 - input.debtPayments)))}` : "Enter your gross (pre-tax) income to see this.",
      referenceOnly: false,
    },
    {
      id: "residual",
      name: "Your actual budget",
      maxRent: Math.max(0, residual(buffer, savingsCommitments)),
      explanation: `Take-home pay minus every other cost, your savings commitments, and a ${input.bufferPercent}% buffer for irregular expenses.`,
      calculation: `${usd(takeHome)} − ${usd(nonRentNeeds)} needs − ${usd(input.discretionary)} discretionary − ${usd(savingsCommitments)} savings − ${usd(buffer)} buffer = ${usd(residual(buffer, savingsCommitments))}`,
      referenceOnly: false,
    },
  ];

  const usable = methods.filter((m) => !m.referenceOnly && m.maxRent !== null && m.id !== "residual").map((m) => m.maxRent!);
  const conservativeRent = floor10(Math.min(...usable, residual(conservativeBuffer, savingsCommitments)));
  const moderateRent = floor10(residual(buffer, savingsCommitments));
  const higherRent = floor10(residual(0, savingsCommitments / 2));

  const scenario = (level: RentScenario["level"], rent: number, savingsKept: number, bufferAmount: number, extra: string[]): RentScenario => {
    const flexibility = roundMoney(takeHome - rent - nonRentNeeds - input.discretionary - savingsKept);
    const tradeoffs = [...extra];
    if (gross !== null && rent > gross * 0.3 + 0.005) tradeoffs.push("Above 30% of gross income; some landlords may ask for a co-signer or larger deposit.");
    if (gross !== null && rent + input.debtPayments > gross * 0.36 + 0.005) tradeoffs.push("Rent plus debt payments is above 36% of gross income, which leaves little room if income drops.");
    if (bufferAmount === 0) tradeoffs.push("Leaves no buffer for irregular costs like repairs, medical bills, or gifts.");
    return {
      level,
      rent,
      percentOfTakeHome: pct(rent, takeHome),
      percentOfGross: gross !== null ? pct(rent, gross) : null,
      monthlyFlexibility: flexibility,
      savingsKept: roundMoney(savingsKept),
      savingsReduction: roundMoney(savingsCommitments - savingsKept),
      tradeoffs,
    };
  };

  const scenarios: RentScenario[] = [
    scenario("conservative", conservativeRent, savingsCommitments, conservativeBuffer, [
      `${savingsCommitments > 0 ? `Keeps all ${usd(savingsCommitments)}/month of savings` : "Keeps"} at least a ${conservativeBufferPercent}% buffer and stays within the 50/30/20${gross !== null ? " and 36% debt-to-income" : ""} limits.`,
    ]),
    scenario("moderate", moderateRent, savingsCommitments, buffer, [
      `${savingsCommitments > 0 ? "Keeps all savings commitments" : "Keeps"} a ${input.bufferPercent}% buffer (${usd(buffer)}/month) for irregular costs.`,
    ]),
    scenario("higher-cost", higherRent, savingsCommitments / 2, 0, savingsCommitments > 0
      ? [`Cuts savings by ${usd(roundMoney(savingsCommitments / 2))}/month (${usd(roundMoney(savingsCommitments * 6))}/year), which pushes back your goals.`]
      : ["You have no savings commitments to cut, so this only removes the buffer."]),
  ];

  const warnings: string[] = [];
  if (residual(0, 0) <= 0) warnings.push("Your current expenses already use all of your take-home pay before rent. Review spending before choosing a rent level.");
  else if (moderateRent === 0) warnings.push("After your expenses and savings, there's no room for rent at your chosen buffer. Consider lowering other costs or savings temporarily.");
  if (gross === null) warnings.push("Gross income wasn't provided, so the 30% and debt-to-income checks aren't applied.");
  if (takeHome === 0) warnings.push("Enter your monthly take-home pay to calculate rent.");
  if (savingsCommitments === 0) warnings.push("No savings commitments are entered. Add your emergency fund and goal savings to see how each rent level affects them.");

  return {
    inputs: input,
    nonRentNeeds,
    savingsCommitments,
    methods,
    scenarios,
    warnings,
    disclaimer: "These are planning estimates from the numbers shown, not a guarantee that any rent is affordable. Consider renters insurance, deposits, moving costs, and how stable your income is.",
  };
}

// ── Retirement ──────────────────────────────────────────────────────────────

const STANDARD_SCENARIOS: { id: RetirementScenario["id"]; name: string; r: number; i: number }[] = [
  { id: "cautious", name: "Cautious", r: 4, i: 3 },
  { id: "middle", name: "Middle", r: 6, i: 2.5 },
  { id: "optimistic", name: "Optimistic", r: 8, i: 2 },
];

// Age at which savings run out, drawing the spending gap monthly in today's
// dollars with an after-inflation return; null if it lasts past the planning age.
export function depletionAge(balanceToday: number, gapMonthlyToday: number, annualReturn: number, inflation: number, retirementAge: number, planningAge: number): number | null {
  if (gapMonthlyToday <= 0) return null;
  const realAnnual = ((1 + annualReturn / 100) / (1 + inflation / 100) - 1) * 100;
  const rm = monthlyRate(realAnnual);
  let balance = balanceToday;
  const months = (planningAge - retirementAge) * 12;
  for (let m = 1; m <= months; m++) {
    balance = balance * (1 + rm) - gapMonthlyToday;
    if (balance < 0) return retirementAge + Math.floor((m - 1) / 12);
  }
  return null;
}

export function calculateRetirement(input: RetirementInput): RetirementResult {
  const years = input.retirementAge - input.currentAge;
  const months = years * 12;
  const contribution = input.monthlyContribution + input.employerMonthlyContribution;
  const gapMonthly = roundMoney(Math.max(0, input.retirementSpendingMonthly - input.otherIncomeMonthly));
  const neededToday = roundMoney((gapMonthly * 12) / (input.withdrawalRatePercent / 100));

  const configs = [...STANDARD_SCENARIOS];
  if (input.customReturnPercent !== null && input.customInflationPercent !== null) {
    configs.push({ id: "custom", name: "Your assumptions", r: input.customReturnPercent, i: input.customInflationPercent });
  }

  const scenarios: RetirementScenario[] = configs.map(({ id, name, r, i }) => {
    const inflationFactor = Math.pow(1 + i / 100, years);
    const projectedNominal = futureValue(input.currentSavings, contribution, r, months);
    const projectedToday = projectedNominal / inflationFactor;
    const neededNominal = neededToday * inflationFactor;
    const gapToday = Math.max(0, neededToday - projectedToday);
    return {
      id,
      name,
      annualReturnPercent: r,
      inflationPercent: i,
      projectedNominal: roundMoney(projectedNominal),
      projectedToday: roundMoney(projectedToday),
      neededToday,
      neededNominal: roundMoney(neededNominal),
      sustainableMonthlyToday: roundMoney(projectedToday * (input.withdrawalRatePercent / 100) / 12),
      gapToday: roundMoney(gapToday),
      // Rounded up to the cent so the amount shown is enough to close the gap.
      additionalMonthlyNeeded: gapToday > 0 ? Math.ceil(requiredMonthly(0, neededNominal - projectedNominal, r, months) * 100 - 1e-6) / 100 : 0,
      depletionAge: depletionAge(projectedToday, gapMonthly, r, i, input.retirementAge, input.lifeExpectancy),
    };
  });

  const explanations = [
    `Projects ${years} years of growth with ${usd(contribution)}/month added (yours plus employer), compounded monthly. Contributions are assumed to stay the same dollar amount rather than rise with pay.`,
    "\"Today's dollars\" divides future amounts by inflation over the years until retirement, so you can compare them with prices now.",
    `The savings needed uses a ${input.withdrawalRatePercent}% withdrawal rate: ${usd(gapMonthly)}/month (spending minus other income) × 12 ÷ ${input.withdrawalRatePercent}% = ${usd(neededToday)} in today's dollars.`,
    "Real returns vary from year to year and can be negative. A market drop early in retirement can shorten how long savings last even when the average return is the same (sequence-of-returns risk).",
    "Taxes, fees, required minimum distributions, and changes in Social Security or pension benefits are not modeled. Other income is the estimate you entered.",
    "The run-out age assumes spending stays level in today's dollars and investments earn the scenario's return after inflation.",
  ];

  return {
    inputs: input,
    yearsToRetirement: years,
    spendingGapMonthlyToday: gapMonthly,
    scenarios,
    explanations,
    disclaimer: "Educational projection based on the assumptions shown. Not a prediction or a recommendation to buy or sell any investment.",
  };
}
