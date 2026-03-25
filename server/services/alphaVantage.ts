const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const BASE_URL = "https://www.alphavantage.co/query";

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

export interface StockSearchResult {
  symbol: string;
  name: string;
  type: string;
  region: string;
  currency: string;
}

export async function getStockQuote(symbol: string): Promise<StockQuote | null> {
  try {
    const url = `${BASE_URL}?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    const quote = data["Global Quote"];
    if (!quote || !quote["05. price"]) return null;

    return {
      symbol: quote["01. symbol"],
      name: symbol,
      price: parseFloat(quote["05. price"]),
      change: parseFloat(quote["09. change"]),
      changePercent: parseFloat(quote["10. change percent"]?.replace("%", "") || "0"),
      volume: parseInt(quote["06. volume"]),
      high: parseFloat(quote["03. high"]),
      low: parseFloat(quote["04. low"]),
      open: parseFloat(quote["02. open"]),
      previousClose: parseFloat(quote["08. previous close"]),
    };
  } catch (error) {
    console.error(`Failed to fetch quote for ${symbol}:`, error);
    return null;
  }
}

export interface DailyPricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function getHistoricalPrices(
  symbol: string,
  outputsize: "compact" | "full" = "compact"
): Promise<DailyPricePoint[]> {
  try {
    const url = `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=${outputsize}&apikey=${ALPHA_VANTAGE_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    const timeSeries = data["Time Series (Daily)"];
    if (!timeSeries) {
      console.error("No time series data for", symbol, data);
      return [];
    }

    return Object.entries(timeSeries)
      .map(([date, values]: [string, any]) => ({
        date,
        open: parseFloat(values["1. open"]),
        high: parseFloat(values["2. high"]),
        low: parseFloat(values["3. low"]),
        close: parseFloat(values["4. close"]),
        volume: parseInt(values["5. volume"]),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    console.error(`Failed to fetch historical prices for ${symbol}:`, error);
    return [];
  }
}

export async function getMultipleQuotes(symbols: string[]): Promise<Record<string, StockQuote>> {
  const results: Record<string, StockQuote> = {};
  // Alpha Vantage free tier has rate limits - fetch sequentially with small delay
  for (const symbol of symbols) {
    const quote = await getStockQuote(symbol);
    if (quote) results[symbol] = quote;
    // Small delay to avoid hitting rate limits
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return results;
}

export async function searchSymbol(keywords: string): Promise<StockSearchResult[]> {
  try {
    const url = `${BASE_URL}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(keywords)}&apikey=${ALPHA_VANTAGE_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    const matches = data["bestMatches"] || [];
    return matches.map((match: any) => ({
      symbol: match["1. symbol"],
      name: match["2. name"],
      type: match["3. type"],
      region: match["4. region"],
      currency: match["8. currency"],
    }));
  } catch (error) {
    console.error("Failed to search symbols:", error);
    return [];
  }
}
