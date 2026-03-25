# Investment Portfolio Analyzer

## Overview

SmartTrader is an AI-powered investment tool with three core features:
1. **Smart Invest** — User enters how much they want to invest right now; AI returns a specific allocation plan across stocks/ETFs with exact dollar amounts.
2. **Pattern Analyzer** — User looks up any stock ticker; the app fetches 100 days of price history, finds major dips/peaks (>4% single-day moves), pulls news from around each event, and runs AI analysis to surface repeating patterns and what causes them.
3. **Market Intelligence** — Live financial news with AI trading signal analysis.

All user data is stored in localStorage — no accounts or database required for the user-facing features. The backend keeps API keys secure and handles all external API calls.

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