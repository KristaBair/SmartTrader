// Where a market value came from, when it was true, and how fresh it is.
// Every price the app shows or hands to the AI should carry one of these, so
// nobody mistakes yesterday's close or a delayed quote for a live price.

export type DataFreshness =
  | "real-time"       // last trade within a few minutes, market open
  | "delayed"         // market open, but the last trade is older than that
  | "previous-close"  // market closed; value is from the most recent session
  | "historical";     // a past daily bar, not a current price

export interface DataProvenance {
  source: string;
  // When the value was true (exchange time of the trade, or the bar's date).
  asOf: string;
  // When our server fetched it.
  retrievedAt: string;
  freshness: DataFreshness;
}

// A quote older than this during market hours is reported as delayed.
export const REAL_TIME_THRESHOLD_MS = 5 * 60 * 1000;

const nyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Regular US equity session: Monday to Friday, 9:30 to 16:00 New York time.
// Exchange holidays and early closes are not modelled, so on those days a quote
// may be labelled "delayed" when it is really the previous close.
export function isUsMarketOpen(at: Date): boolean {
  const parts = Object.fromEntries(nyFormatter.formatToParts(at).map((p) => [p.type, p.value]));
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

export function classifyQuoteFreshness(quoteTime: Date, now: Date): DataFreshness {
  if (!isUsMarketOpen(now)) return "previous-close";
  return now.getTime() - quoteTime.getTime() <= REAL_TIME_THRESHOLD_MS ? "real-time" : "delayed";
}

export function describeFreshness(freshness: DataFreshness): string {
  switch (freshness) {
    case "real-time":
      return "real-time";
    case "delayed":
      return "delayed";
    case "previous-close":
      return "last close (market closed)";
    case "historical":
      return "historical daily data";
  }
}
