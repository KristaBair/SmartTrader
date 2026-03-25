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

export async function getFinancialNews(query?: string): Promise<NewsArticle[]> {
  try {
    const searchQuery = query || "stock market investing finance earnings";
    const url = `${BASE_URL}/everything?q=${encodeURIComponent(searchQuery)}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${NEWS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "ok") {
      console.error("News API error:", data.message);
      return [];
    }

    return (data.articles || []).map((article: any) => ({
      title: article.title || "",
      description: article.description || "",
      url: article.url || "",
      source: article.source?.name || "Unknown",
      publishedAt: article.publishedAt || new Date().toISOString(),
      content: article.content || article.description || "",
    }));
  } catch (error) {
    console.error("Failed to fetch financial news:", error);
    return [];
  }
}

export async function getStockNews(symbol: string): Promise<NewsArticle[]> {
  try {
    const url = `${BASE_URL}/everything?q=${encodeURIComponent(symbol)}&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "ok") return [];

    return (data.articles || []).map((article: any) => ({
      title: article.title || "",
      description: article.description || "",
      url: article.url || "",
      source: article.source?.name || "Unknown",
      publishedAt: article.publishedAt || new Date().toISOString(),
      content: article.content || article.description || "",
    }));
  } catch (error) {
    console.error(`Failed to fetch news for ${symbol}:`, error);
    return [];
  }
}

export async function getTopHeadlines(): Promise<NewsArticle[]> {
  try {
    const url = `${BASE_URL}/top-headlines?category=business&language=en&pageSize=10&apiKey=${NEWS_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "ok") return [];

    return (data.articles || []).map((article: any) => ({
      title: article.title || "",
      description: article.description || "",
      url: article.url || "",
      source: article.source?.name || "Unknown",
      publishedAt: article.publishedAt || new Date().toISOString(),
      content: article.content || article.description || "",
    }));
  } catch (error) {
    console.error("Failed to fetch top headlines:", error);
    return [];
  }
}
