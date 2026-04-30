// Wrapper around the NewsAPI.org REST API.
// Used by the Market Intelligence page, trading signal polling,
// and the Pattern Analyzer (to fetch news around specific dates).
// Free plan allows 100 requests/day with a 30-day article lookback window.

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const BASE_URL = "https://newsapi.org/v2";

export interface NewsArticle {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  content: string;
}

// Returns financial news articles matching an optional keyword query.
// Falls back to a broad finance/investing query when no keyword is given.
export async function getFinancialNews(query?: string): Promise<NewsArticle[]> {
  try {
    const q = query || "stock market investing finance earnings";
    const url = `${BASE_URL}/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${NEWS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "ok") {
      console.error("News API error:", data.message);
      return [];
    }

    return (data.articles || []).map((a: any) => ({
      title: a.title || "",
      description: a.description || "",
      url: a.url || "",
      source: a.source?.name || "Unknown",
      publishedAt: a.publishedAt || new Date().toISOString(),
      content: a.content || a.description || "",
    }));
  } catch (error) {
    console.error("Failed to fetch financial news:", error);
    return [];
  }
}

// Returns recent articles mentioning a specific stock ticker.
export async function getStockNews(symbol: string): Promise<NewsArticle[]> {
  try {
    const url = `${BASE_URL}/everything?q=${encodeURIComponent(symbol)}&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "ok") return [];

    return (data.articles || []).map((a: any) => ({
      title: a.title || "",
      description: a.description || "",
      url: a.url || "",
      source: a.source?.name || "Unknown",
      publishedAt: a.publishedAt || new Date().toISOString(),
      content: a.content || a.description || "",
    }));
  } catch (error) {
    console.error(`Failed to fetch news for ${symbol}:`, error);
    return [];
  }
}

// Searches for news about a query within a specific date window.
// Used by the Pattern Analyzer to find headlines around a big price move.
export async function getNewsByDateRange(
  query: string,
  from: string,
  to: string
): Promise<NewsArticle[]> {
  try {
    const url = `${BASE_URL}/everything?q=${encodeURIComponent(query)}&from=${from}&to=${to}&language=en&sortBy=relevancy&pageSize=5&apiKey=${NEWS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "ok") return [];

    return (data.articles || []).map((a: any) => ({
      title: a.title || "",
      description: a.description || "",
      url: a.url || "",
      source: a.source?.name || "Unknown",
      publishedAt: a.publishedAt || "",
      content: a.content || a.description || "",
    }));
  } catch (error) {
    console.error("Failed to fetch news by date range:", error);
    return [];
  }
}

// Returns the top business headlines. Used for trading signal generation
// and the "Analyze Now" button on the Market Intelligence page.
export async function getTopHeadlines(): Promise<NewsArticle[]> {
  try {
    const url = `${BASE_URL}/top-headlines?category=business&language=en&pageSize=10&apiKey=${NEWS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "ok") return [];

    return (data.articles || []).map((a: any) => ({
      title: a.title || "",
      description: a.description || "",
      url: a.url || "",
      source: a.source?.name || "Unknown",
      publishedAt: a.publishedAt || new Date().toISOString(),
      content: a.content || a.description || "",
    }));
  } catch (error) {
    console.error("Failed to fetch top headlines:", error);
    return [];
  }
}
