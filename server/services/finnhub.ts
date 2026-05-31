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
// Finnhub's free tier does not include the /stock/candle endpoint, so daily
// history comes from Yahoo Finance's public chart API, which needs no API key.
// "compact" = ~6 months, "full" = ~2 years.

export async function getHistoricalPrices(
  symbol: string,
  outputsize: "compact" | "full" = "compact"
): Promise<DailyPricePoint[]> {
  try {
    const range = outputsize === "compact" ? "6mo" : "2y";
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=${range}&interval=1d`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return [];

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const timestamps: number[] | undefined = result?.timestamp;
    const quote = result?.indicators?.quote?.[0];

    if (!Array.isArray(timestamps) || !quote) return [];

    // Yahoo returns parallel arrays; some entries can be null on non-trading
    // gaps. Keep only rows with a valid close, then coerce the remaining
    // optional fields so every returned point matches DailyPricePoint exactly.
    return timestamps
      .map((timestamp: number, i: number) => ({
        date: new Date(timestamp * 1000).toISOString().split("T")[0],
        open: quote.open?.[i],
        high: quote.high?.[i],
        low: quote.low?.[i],
        close: quote.close?.[i],
        volume: quote.volume?.[i],
      }))
      .filter((p) => typeof p.close === "number")
      .map((p) => ({
        date: p.date,
        open: typeof p.open === "number" ? p.open : p.close,
        high: typeof p.high === "number" ? p.high : p.close,
        low: typeof p.low === "number" ? p.low : p.close,
        close: p.close,
        volume: typeof p.volume === "number" ? p.volume : 0,
      }));
  } catch (err) {
    console.error(`Yahoo history failed for ${symbol}:`, err);
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
