---
name: Market data sources
description: Which external API serves which kind of market data, and free-tier limits that force fallbacks
---

# Market data sources

- **Live quotes** (current price/change): Finnhub `/quote`. Works on free tier for US stocks/ETFs (SPY, QQQ, AAPL, etc.).
- **Historical daily candles**: Yahoo Finance public chart API (`query1.finance.yahoo.com/v8/finance/chart/<SYMBOL>?range=&interval=1d`), no API key. Used by Pattern Analyzer.
- **News**: News API.
- **AI**: Claude on Amazon Bedrock (Converse API) for text and vision, via `server/services/bedrock.ts`. Always pass `maxTokens` explicitly.

**Why Yahoo for history:** Finnhub's free tier returns `{"error":"You don't have access to this resource."}` for `/stock/candle`. This silently broke Pattern Analyzer ("No price data found"). Yahoo is the keyless replacement.

**How to apply:** Don't route historical-price needs through Finnhub. For any symbol Finnhub `/quote` returns `c:0` (e.g. VIX index is not covered on free tier), fall back to stored/seed values rather than showing 0.
