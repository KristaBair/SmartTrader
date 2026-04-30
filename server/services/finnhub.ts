// Finnhub stock data service.
// Replaces Alpha Vantage with the same exported functions and return shapes,
// so nothing else in the codebase needed to change except the import line.
// Finnhub free tier allows 60 calls per minute, much better than Alpha Vantage's 5.

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const BASE_URL = "https://finnhub.io/api/v1";

// Shared fetch helper that adds the API token to every request.
async function fhFetch(path: string): Promise<any> {
  const url = `${BASE_URL}${path}&token=${FINNHUB_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Finnhub ${res.status}: ${path}`);
  return res.json();
}

// ── Types (same interface as the old alphaVantage service) ─────────────────

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
}

export interface DailyPricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StockSearchResult {
  symbol: string;
  name: string;
  type: string;
  region: string;
  currency: string;
}

// ── Quote ─────────────────────────────────────────────────────────────────
// Finnhub /quote returns: c (current), d (change), dp (% change),
// h (high), l (low), o (open), pc (prev close). Volume isn't in /quote
// so we default to 0 (it is only used for display purposes).

export async function getStockQuote(symbol: string): Promise<StockQuote | null> {
  try {
    const data = await fhFetch(`/quote?symbol=${encodeURIComponent(symbol)}`);

    // Finnhub returns c=0 when the symbol isn't found
    if (!data || data.c === 0) return null;

    return {
      symbol,
      name: symbol, // Finnhub /quote doesn't return the company name
      price: data.c,
      change: data.d ?? 0,
      changePercent: data.dp ?? 0,
      volume: 0,
      high: data.h ?? 0,
      low: data.l ?? 0,
      open: data.o ?? 0,
      previousClose: data.pc ?? 0,
    };
  } catch (err) {
    console.error(`Finnhub quote failed for ${symbol}:`, err);
    return null;
  }
}

// ── Historical prices ──────────────────────────────────────────────────────
// Finnhub /stock/candle uses Unix timestamps.
// "compact" = last ~100 trading days, "full" = last year.
// Returns arrays indexed in parallel: c[], h[], l[], o[], v[], t[].

export async function getHistoricalPrices(
  symbol: string,
  outputsize: "compact" | "full" = "compact"
): Promise<DailyPricePoint[]> {
  try {
    const now = Math.floor(Date.now() / 1000);
    // compact = 6 months back, full = 2 years back
    const daysBack = outputsize === "compact" ? 180 : 730;
    const from = now - daysBack * 24 * 60 * 60;

    const data = await fhFetch(
      `/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}`
    );

    if (!data || data.s !== "ok" || !Array.isArray(data.t)) return [];

    // Zip the parallel arrays into our familiar DailyPricePoint shape
    return data.t.map((timestamp: number, i: number) => ({
      date: new Date(timestamp * 1000).toISOString().split("T")[0],
      open: data.o[i],
      high: data.h[i],
      low: data.l[i],
      close: data.c[i],
      volume: data.v[i],
    }));
  } catch (err) {
    console.error(`Finnhub candles failed for ${symbol}:`, err);
    return [];
  }
}

// ── Multiple quotes ────────────────────────────────────────────────────────
// Finnhub's rate limit is generous so we can fire requests in parallel
// rather than waiting 200ms between each one.

export async function getMultipleQuotes(
  symbols: string[]
): Promise<Record<string, StockQuote>> {
  const results = await Promise.all(
    symbols.map(async (sym) => {
      const quote = await getStockQuote(sym);
      return { sym, quote };
    })
  );

  const out: Record<string, StockQuote> = {};
  for (const { sym, quote } of results) {
    if (quote) out[sym] = quote;
  }
  return out;
}

// ── Symbol search ──────────────────────────────────────────────────────────
// Finnhub /search returns: description (company name), displaySymbol, symbol, type.

export async function searchSymbol(keywords: string): Promise<StockSearchResult[]> {
  try {
    const data = await fhFetch(`/search?q=${encodeURIComponent(keywords)}`);
    const matches = data?.result ?? [];

    return matches.slice(0, 10).map((m: any) => ({
      symbol: m.symbol,
      name: m.description,
      type: m.type,
      region: "US",
      currency: "USD",
    }));
  } catch (err) {
    console.error("Finnhub symbol search failed:", err);
    return [];
  }
}
