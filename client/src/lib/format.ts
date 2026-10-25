import type { AssetClass } from "@shared/finance";

// Display helpers shared by the finance pages.

export const CLASS_LABELS: Record<AssetClass, string> = {
  cash: "Cash",
  savings: "Savings",
  "term-deposit": "CD / term deposit",
  "taxable-investment": "Taxable investment",
  retirement: "Retirement",
  restricted: "Restricted (HSA, 529…)",
  credit: "Credit",
  loan: "Loan",
  other: "Other",
};

export function usd(value: number | null | undefined, options: { cents?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const cents = options.cents ?? true;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Plain YYYY-MM-DD dates are calendar days, not instants; don't shift them by time zone.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// apiRequest throws "403: {json}". Pull out the server's message for display.
export function errorMessage(error: unknown, fallback = "Something went wrong. Try again."): string {
  const raw = error instanceof Error ? error.message : "";
  const json = raw.slice(raw.indexOf("{"));
  try {
    const parsed = JSON.parse(json) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // Not JSON; fall through.
  }
  return fallback;
}
