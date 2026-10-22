# SmartTrader

SmartTrader is an AI-powered investment analysis platform. It combines real
quantitative finance math with live market data and AI commentary to help you
understand a portfolio, plan new investments, and spot patterns in individual
stocks.

## What it does

- **Analytics Lab** (`/analytics`) — Quantitative portfolio analysis with real
  math: Monte Carlo simulation, Value at Risk (VaR) and Expected Shortfall
  (CVaR), Markowitz portfolio variance, Sharpe ratios, concentration (HHI), and
  momentum signals. Produces a 0–100 recommendation score with plain-English
  reasoning, and discloses every assumption in the UI.
- **Smart Invest** (`/invest`) — Enter how much you want to invest and get a
  specific allocation plan across stocks and ETFs, with exact dollar amounts and
  the reasoning behind each pick.
- **Pattern Analyzer** (`/patterns`) — Look up any ticker, pull recent price
  history, find major dips and peaks, gather news from around those events, and
  let AI surface repeating patterns.
- **Market Intelligence** (`/market-intelligence`) — Live financial news with
  AI-generated trading-signal analysis.

## Tech stack

- **Frontend**: React 18 + TypeScript, Vite, Wouter (routing), TanStack Query,
  Tailwind CSS, shadcn/ui (Radix primitives)
- **Backend**: Express.js + TypeScript, serving both the API and the built
  frontend on a single port
- **Database**: PostgreSQL via Drizzle ORM
- **AI**: OpenAI (GPT) for analysis and recommendations
- **Market data**: Finnhub for live quotes, Yahoo Finance (keyless) for
  historical price candles, News API for headlines

## Project structure

```
client/    React single-page app (pages, components, hooks, lib)
server/    Express API, services (finnhub, openai, news, quant analytics), storage
shared/    Drizzle schema and shared TypeScript types
```

## Getting started

The app runs through the preconfigured **Start application** workflow, which runs
`npm run dev` to start the Express server and Vite dev server together.

### Using Claude Code

Claude Code is a terminal-based coding assistant. From the project directory,
run `~/.local/bin/claude`, then follow its prompts to sign in with a Claude
account. The project-specific guidance is in `CLAUDE.md`.

### Environment variables

These are managed as Replit Secrets:

- `DATABASE_URL` (and `PG*` connection vars) — PostgreSQL
- `OPENAI_API_KEY` — AI analysis
- `FINNHUB_API_KEY` — live stock quotes
- `NEWS_API_KEY` — financial news headlines

## How data is stored

User profiles and portfolios live in the browser's `localStorage`, namespaced by
a unique user ID so several people can share one device. The backend keeps API
keys secure and makes all external calls (market data, news, AI) on the client's
behalf.

## Accounts

- The sign-in screen lists existing profiles; pick yours and enter a 4-digit
  passcode.
- New accounts need a first name, last name, and a 4-digit passcode (entered
  twice). No email or server account required.
