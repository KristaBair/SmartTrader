// Deterministic time-value-of-money helpers used by pools, goals, planners, and
// the AI Advisor. Annual rates are converted to an equivalent monthly rate,
// (1 + annual)^(1/12) - 1, and money is added at the end of each month.

const MAX_MONTHS = 1200; // 100 years: beyond this a target is treated as unreachable.

export const monthlyRate = (annualPercent: number) => Math.pow(1 + annualPercent / 100, 1 / 12) - 1;

export function addMonths(from: Date, months: number): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(from.getUTCDate(), lastDay));
  return d.toISOString().slice(0, 10);
}

// Whole months from `now` until `date` (YYYY-MM-DD), never negative.
export function monthsUntil(now: Date, date: string): number {
  const target = new Date(`${date}T00:00:00Z`);
  let months = (target.getUTCFullYear() - now.getUTCFullYear()) * 12 + (target.getUTCMonth() - now.getUTCMonth());
  if (target.getUTCDate() < now.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

// Value after `months` of growth at `annualPercent` with `monthly` added each month.
export function futureValue(presentValue: number, monthly: number, annualPercent: number, months: number): number {
  const i = monthlyRate(annualPercent);
  if (Math.abs(i) < 1e-12) return presentValue + monthly * months;
  const growth = Math.pow(1 + i, months);
  return presentValue * growth + monthly * ((growth - 1) / i);
}

// Months until `target` is reached, or null if it never is within 100 years.
export function monthsToReach(presentValue: number, monthly: number, annualPercent: number, target: number): number | null {
  if (presentValue >= target - 0.005) return 0;
  const i = monthlyRate(annualPercent);
  if (Math.abs(i) < 1e-12) {
    if (monthly <= 0) return null;
    const months = Math.ceil((target - presentValue) / monthly - 1e-9);
    return months <= MAX_MONTHS ? months : null;
  }
  let value = presentValue;
  for (let m = 1; m <= MAX_MONTHS; m++) {
    value = value * (1 + i) + monthly;
    if (value >= target - 0.005) return m;
  }
  return null;
}

// Monthly amount needed to grow `presentValue` to `target` in `months`.
export function requiredMonthly(presentValue: number, target: number, annualPercent: number, months: number): number {
  if (months <= 0) return Math.max(0, target - presentValue);
  const i = monthlyRate(annualPercent);
  if (Math.abs(i) < 1e-12) return Math.max(0, (target - presentValue) / months);
  const growth = Math.pow(1 + i, months);
  return Math.max(0, ((target - presentValue * growth) * i) / (growth - 1));
}

// Months to pay off `balance` at `payment` per month and `apr` percent, or null
// if the payment doesn't cover the interest.
export function debtPayoffMonths(balance: number, payment: number, aprPercent: number): number | null {
  if (balance <= 0.005) return 0;
  if (payment <= 0) return null;
  const r = aprPercent / 100 / 12;
  if (r <= 0) return Math.ceil(balance / payment - 1e-9);
  if (payment <= balance * r) return null;
  const months = Math.ceil(-Math.log(1 - (r * balance) / payment) / Math.log(1 + r) - 1e-9);
  return months <= MAX_MONTHS ? months : null;
}

// Fixed monthly payment that pays off `balance` in `months` at `apr` percent.
export function amortizedPayment(balance: number, aprPercent: number, months: number): number {
  if (balance <= 0) return 0;
  if (months <= 0) return balance;
  const r = aprPercent / 100 / 12;
  if (r <= 0) return balance / months;
  return (balance * r) / (1 - Math.pow(1 + r, -months));
}

export const roundMoney = (value: number) => Math.round(value * 100) / 100;
