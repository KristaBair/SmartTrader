# Claude Code guidance

## Project

SmartTrader is a React 18 and TypeScript frontend with an Express and TypeScript
backend. Amazon Cognito handles sign-in, Amazon DynamoDB stores user data, and
Amazon S3 stores uploaded screenshots (resources in `infra/smarttrader.yaml`).
The app uses Finnhub for live quotes, Yahoo Finance for historical candles,
News API for headlines, and Claude on Amazon Bedrock for in-app AI analysis.

## Commands

- `npm run dev` starts the development app.
- `npm run check` runs the TypeScript check.
- `npm run build` builds the frontend and backend for production.

## Working rules

- Read the relevant code before editing and keep changes within the requested
  scope.
- Keep API keys and other credentials in Replit Secrets. Never put them in
  source files, logs, or client-side code.
- Preserve the financial methodology and its disclosed assumptions. Treat
  generated analysis as informational, not personalized financial advice.
- Use the existing project patterns and shared types; avoid `any` when a
  specific type can be used.
- After code changes, run `npm run check`. For build or runtime changes, also
  run `npm run build` or verify the development app as appropriate.
