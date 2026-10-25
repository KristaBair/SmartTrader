// App entry point. Sets up providers, handles auth gating, and wires up routes.
// Trading signal polling also lives here so alerts work on every page.

import { useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserProvider, useUser } from "@/context/UserContext";
import { getOnboarding, hasAcceptedCurrentTerms } from "@/lib/userData";
import SignIn from "@/pages/sign-in";
import Dashboard from "@/pages/dashboard";
import FinancesPage from "@/pages/finances";
import PoolsPage from "@/pages/pools";
import GoalsPage from "@/pages/goals";
import AppShell from "@/components/app-shell";
import { Onboarding } from "@/pages/onboarding";
import MarketIntelligence from "@/pages/market-intelligence";
import Invest from "@/pages/invest";
import Patterns from "@/pages/patterns";
import Analytics from "@/pages/analytics";
import NotFound from "@/pages/not-found";
import TermsPage, { TermsAcceptanceGate } from "@/pages/terms";

function Router() {
  const { isSignedIn, isLoading } = useUser();
  const [location] = useLocation();
  // Bumped after the user accepts the Terms so the gate below re-reads the cache.
  const [, setTermsAccepted] = useState(0);

  // App-wide "BUY/SELL now" pop-ups (useSignalPolling + TradingAlerts) are turned
  // off: unsolicited trade calls are outside the planning-and-education scope and
  // need investment-adviser/legal review before they could be offered. Market
  // Intelligence remains available as a research page.

  // Wait for the stored Cognito session check before deciding what to show
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center">
        <p className="text-slate-300 text-sm">Loading your account...</p>
      </div>
    );
  }

  // The Terms are readable without an account so people can review them before signing up
  if (location === "/terms") {
    return <TermsPage />;
  }

  // If no one is signed in, the whole app collapses to the sign-in screen
  if (!isSignedIn) {
    return <SignIn />;
  }

  // New users and anyone who accepted an older version must agree before continuing
  if (!hasAcceptedCurrentTerms()) {
    return <TermsAcceptanceGate onAccepted={() => setTermsAccepted((n) => n + 1)} />;
  }

  // Check if this user has finished the one-time setup flow
  const onboarding = getOnboarding();
  const hasOnboarded = onboarding?.completed === true;

  return (
    <AppShell>
      <Switch>
        {/* Root path lands on My Finances once onboarding is done, otherwise setup first */}
        <Route path="/" component={hasOnboarded ? FinancesPage : Onboarding} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/finances" component={FinancesPage} />
        <Route path="/pools" component={PoolsPage} />
        <Route path="/goals" component={GoalsPage} />
        <Route path="/investments" component={Dashboard} />
        {/* Older links and bookmarks */}
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/market-intelligence" component={MarketIntelligence} />
        <Route path="/invest" component={Invest} />
        <Route path="/patterns" component={Patterns} />
        <Route path="/analytics" component={Analytics} />
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    // QueryClientProvider handles all the data fetching and caching
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {/* UserProvider makes the signed-in user available anywhere in the tree */}
        <UserProvider>
          <Toaster />
          <Router />
        </UserProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
