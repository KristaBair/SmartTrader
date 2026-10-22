# Investment Portfolio Analyzer

## Overview

InvestSmart is an AI-powered quantitative investment analysis platform with four core tools:

1. **Analytics Lab** (`/analytics`) - Quantitative portfolio analysis with real math:
   - Monte Carlo simulation (1,000 paths, GBM model, monthly time steps, drift-corrected via Itô's lemma)
   - Parametric VaR (95% confidence, 1-day horizon) and CVaR / Expected Shortfall
   - Markowitz portfolio variance with uniform pairwise correlation (ρ=0.5)
   - Sharpe ratios, HHI concentration index, annualized momentum signals
   - 5-component recommendation scoring system (0-100) with reasoning
   - Target allocation comparison with deviation analysis
   - Methodology and assumptions fully disclosed in the UI

2. **Smart Invest** (`/invest`) - User enters how much they want to invest; AI returns a specific allocation plan across stocks/ETFs with exact dollar amounts and reasoning.

3. **Pattern Analyzer** (`/patterns`) - Look up any stock ticker; fetches 100 days of price history, finds major dips/peaks (>4% single-day moves), pulls news from around each event, runs AI analysis to surface repeating patterns.

4. **Market Intelligence** (`/market-intelligence`) - Live financial news with AI trading signal analysis.

User data is stored in Amazon DynamoDB per Cognito user. Backend secures API keys and handles all external calls (Finnhub, Yahoo Finance, News API, Amazon Bedrock).

## User Profiles and Authentication
- Amazon Cognito user pool: email + password sign-up with email verification, password reset by email
- Client uses Amplify Auth (`client/src/lib/auth.ts`); tokens kept in cookies, not localStorage
- Server verifies the Cognito access token on every `/api` route except `/api/auth/config` (`server/auth.ts`)
- Portfolio, onboarding, and recommendations stored in DynamoDB under `USER#<cognito sub>` (`server/storage.ts`), loaded once at sign-in and written through on every change (`client/src/lib/userData.ts`)
- React context (`UserContext`) provides `user`, `refreshUser`, `signOut` to all pages
- AWS resources are defined in `infra/smarttrader.yaml`

The system is built as a modern React SPA with an Express.js backend, featuring a clean separation between client and server code with shared type definitions.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript using Vite as the build tool
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS custom properties for theming
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Form Handling**: React Hook Form with Zod validation

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful API with JSON responses
- **Error Handling**: Centralized error middleware with structured error responses
- **Development Tools**: Hot reload with Vite integration for full-stack development

### Data Storage Solutions
- **Database**: Amazon DynamoDB, single table (`PK`/`SK`), on-demand billing, point-in-time recovery
- **Files**: Amazon S3 for uploaded brokerage screenshots (private, encrypted, expire after 30 days)
- **Validation**: zod schemas in `shared/schema.ts` validate every write

### Database Schema Design
- `USER#<sub>` / `PORTFOLIO`, `ONBOARDING`, `RECOMMENDATIONS`: per-user saved data
- `MARKET#<symbol>` / `QUOTE`: fallback market values when Finnhub has no price

### Authentication and Authorization
- **Amazon Cognito**: user pool + public app client (no secret, SRP sign-in, token revocation)
- **API**: Bearer access token verified with `aws-jwt-verify`

### AI Integration Architecture
- **Provider**: Anthropic Claude on Amazon Bedrock via the Converse API (`server/services/bedrock.ts`), model set by `BEDROCK_MODEL_ID`
- **Analysis Engine**: Structured AI prompts for consistent recommendation formatting
- **Risk Assessment**: Multi-dimensional risk analysis with scoring and explanations
- **Market Sentiment**: Integration of market data with AI analysis for contextual recommendations

### Component Architecture
- **Modular Design**: Reusable components for portfolio input, recommendations display, and market trends
- **Loading States**: Skeleton components for improved UX during data fetching
- **Error Boundaries**: Graceful error handling with user-friendly messages
- **Responsive Design**: Mobile-first approach with adaptive layouts

## External Dependencies

### Core Framework Dependencies
- **@aws-sdk/client-dynamodb**, **@aws-sdk/lib-dynamodb**: DynamoDB access
- **@aws-sdk/client-s3**: screenshot uploads
- **express**: Node.js web framework for API server
- **@tanstack/react-query**: Server state management and caching

### UI and Styling Dependencies
- **@radix-ui/react-***: Comprehensive UI primitive components for accessibility
- **tailwindcss**: Utility-first CSS framework
- **class-variance-authority**: Type-safe component variants
- **lucide-react**: Icon library

### Development and Build Tools
- **vite**: Fast build tool and dev server
- **tsx**: TypeScript execution engine for development
- **esbuild**: Fast JavaScript bundler for production builds
- **@replit/vite-plugin-***: Replit-specific development enhancements

### Validation and Forms
- **zod**: Runtime type validation and schema definition
- **react-hook-form**: Performant form library with minimal re-renders
- **@hookform/resolvers**: Zod integration for React Hook Form

### AI and External Services
- **@aws-sdk/client-bedrock-runtime**: Amazon Bedrock Converse API
- **date-fns**: Date manipulation utilities for financial calculations

### Authentication
- **aws-amplify**: Cognito sign-up / sign-in in the browser
- **aws-jwt-verify**: Cognito token verification on the server