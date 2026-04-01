import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import { Onboarding } from "@/pages/onboarding";
import MarketIntelligence from "@/pages/market-intelligence";
import Invest from "@/pages/invest";
import Patterns from "@/pages/patterns";
import Analytics from "@/pages/analytics";
import NotFound from "@/pages/not-found";
import { getOnboarding } from "@/lib/localStore";

function Router() {
  const onboarding = getOnboarding();
  const hasCompletedOnboarding = onboarding?.completed === true;

  return (
    <Switch>
      <Route path="/" component={hasCompletedOnboarding ? Dashboard : Onboarding} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/market-intelligence" component={MarketIntelligence} />
      <Route path="/invest" component={Invest} />
      <Route path="/patterns" component={Patterns} />
      <Route path="/analytics" component={Analytics} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
