# Investment Portfolio Analyzer

## Overview

SmartTrader is an AI-powered quantitative investment analysis platform with four core tools:

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

All user data stored in localStorage. Each user profile is namespaced by a unique ID so multiple people can share one device. Backend secures API keys and handles all external calls (Alpha Vantage, News API, OpenAI).

## User Profiles and Authentication
- Sign-in screen lists existing profiles; users pick theirs and enter a 4-digit passcode
- New accounts: first name, last name, 4-digit passcode (confirmed twice)
- All profile data namespaced in localStorage by user ID: `smarttrader_onboarding_{id}`, `smarttrader_portfolio_{id}`, `smarttrader_recommendations_{id}`
- Session persisted via `smarttrader_current_user` key; cleared on sign-out
- React context (`UserContext`) provides `user`, `signIn`, `signOut` to all pages
- No backend changes required; fully client-side

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
- **Database**: PostgreSQL configured for production use via Drizzle ORM
- **ORM**: Drizzle ORM with PostgreSQL dialect for type-safe database operations
- **Schema Management**: Centralized schema definitions with automatic migrations
- **Development Storage**: In-memory storage implementation for development/testing
- **Session Management**: PostgreSQL-backed sessions using connect-pg-simple

### Database Schema Design
- **Portfolios**: Stores user portfolio data with JSONB for flexible investment structures
- **Recommendations**: AI-generated investment recommendations with confidence scores and reasoning
- **Market Data**: Real-time market indicators (prices, changes, percentages)
- **Type Safety**: Full TypeScript integration with runtime validation using Zod

### Authentication and Authorization
- **Session-based**: Traditional session management with PostgreSQL storage
- **User Identification**: Simple user ID system (currently defaulted for demo purposes)
- **Security**: CORS configured, secure session cookies in production

### AI Integration Architecture
- **Provider**: OpenAI GPT-5 integration for portfolio analysis
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
- **@neondatabase/serverless**: Neon PostgreSQL serverless driver for database connections
- **drizzle-orm**: Type-safe ORM for PostgreSQL with migration support
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
- **openai**: Official OpenAI API client for GPT integration
- **date-fns**: Date manipulation utilities for financial calculations

### Session and Security
- **connect-pg-simple**: PostgreSQL session store for Express sessions
- **express-session**: Session middleware for user state management