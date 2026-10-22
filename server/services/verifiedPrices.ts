// Keeps AI output honest about prices. The model is told the verified quotes,
// but whatever it writes as "currentPrice" is replaced with the actual quote
// (with its source and timestamp), or removed if we couldn't verify one.

import type { Recommendation } from "@shared/schema";
import type { StockQuote } from "./finnhub";
import { describeFreshness } from "./dataProvenance";

export type QuoteMap = Record<string, StockQuote | null>;

export function applyVerifiedPrices<T extends Recommendation>(recommendations: T[], quotes: QuoteMap): T[] {
  return recommendations.map((rec) => {
    const quote = quotes[rec.symbol.toUpperCase()];
    if (!quote) {
      return { ...rec, currentPrice: undefined, priceSource: undefined, priceAsOf: undefined, priceFreshness: undefined };
    }
    return {
      ...rec,
      currentPrice: quote.price,
      priceSource: quote.provenance.source,
      priceAsOf: quote.provenance.asOf,
      priceFreshness: quote.provenance.freshness,
    };
  });
}

// One line per verified quote, for inclusion in a prompt.
export function formatQuotesForPrompt(quotes: QuoteMap): string {
  const lines = Object.entries(quotes)
    .filter((entry): entry is [string, StockQuote] => entry[1] !== null)
    .map(([symbol, q]) =>
      `- ${symbol}: $${q.price.toFixed(2)} (${q.changePercent.toFixed(2)}% today; ${q.provenance.source}, ` +
      `as of ${q.provenance.asOf}, ${describeFreshness(q.provenance.freshness)})`
    );
  return lines.length > 0 ? lines.join("\n") : "- (no verified quotes available)";
}
