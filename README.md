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
- **Sign-in**: Amazon Cognito (email + password, via Amplify Auth)
- **Database**: Amazon DynamoDB (one partition per signed-in user)
- **File storage**: Amazon S3 (uploaded brokerage screenshots, auto-expiring)
- **AI**: Anthropic Claude on Amazon Bedrock (Converse API) for analysis and recommendations
- **Market data**: Finnhub for live quotes, Yahoo Finance (keyless) for
  historical price candles, News API for headlines

## Project structure

```
client/    React single-page app (pages, components, hooks, lib)
server/    Express API, Cognito auth, DynamoDB storage, services (bedrock, finnhub, news, quant analytics, S3 uploads)
shared/    Shared TypeScript types and zod validation schemas
infra/     CloudFormation template for the AWS resources (see infra/README.md)
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

- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — AWS access for the server
- `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` — sign-in
- `DYNAMODB_TABLE` — user data
- `S3_BUCKET` — screenshot uploads
- `BEDROCK_MODEL_ID` (optional) — defaults to `us.anthropic.claude-sonnet-4-6`
- `FINNHUB_API_KEY` — live stock quotes
- `NEWS_API_KEY` — financial news headlines

## How data is stored

Each user's portfolio, onboarding answers, and latest AI recommendations are
stored in DynamoDB under their Cognito user ID. Every `/api` route except
`/api/auth/config` requires a valid Cognito access token, and the server only
ever reads or writes the caller's own partition. The backend keeps API keys
secure and makes all external calls (market data, news, AI) on the client's
behalf.

## Accounts

- Accounts are Cognito users: first name, last name, email, and a password
  (8+ characters with upper case, lower case, and a number).
- New accounts verify their email with a 6-digit code. Forgotten passwords are
  reset by email.
