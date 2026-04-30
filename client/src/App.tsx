// App entry point. Sets up providers, handles auth gating, and wires up routes.
// Trading signal polling also lives here so alerts work on every page.

import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UserProvider, useUser } from "@/context/UserContext";
import { getOnboarding } from "@/lib/localStore";
import { useSignalPolling } from "@/hooks/useSignalPolling";
import TradingAlerts from "@/components/TradingAlerts";
import SignIn from "@/pages/sign-in";
import Dashboard from "@/pages/dashboard";
import { Onboarding } from "@/pages/onboarding";
import MarketIntelligence from "@/pages/market-intelligence";
import Invest from "@/pages/invest";
import Patterns from "@/pages/patterns";
import Analytics from "@/pages/analytics";
import NotFound from "@/pages/not-found";

function Router() {
  const { user, isSignedIn } = useUser();

  // Only poll for signals when someone is actually signed in. No point hitting
  // the API on the sign-in screen
  const { newSignals } = useSignalPolling(isSignedIn);

  // If no one is signed in, the whole app collapses to the sign-in screen
  if (!isSignedIn) {
    return <SignIn />;
  }

  // Check if this user has finished the one-time setup flow
  const onboarding = getOnboarding(user!.id);
  const hasOnboarded = onboarding?.completed === true;

  return (
    <>
      {/* Alert pop-ups float above everything else on every page */}
      <TradingAlerts signals={newSignals} />

      <Switch>
        {/* Root path lands on dashboard if done with onboarding, otherwise setup first */}
        <Route path="/" component={hasOnboarded ? Dashboard : Onboarding} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/market-intelligence" component={MarketIntelligence} />
        <Route path="/invest" component={Invest} />
        <Route path="/patterns" component={Patterns} />
        <Route path="/analytics" component={Analytics} />
        <Route component={NotFound} />
      </Switch>
    </>
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
