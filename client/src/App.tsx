import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import Dashboard from "@/pages/dashboard";
import Landing from "@/pages/landing";
import { Onboarding } from "@/pages/onboarding";
import NotFound from "@/pages/not-found";

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  
  // Check for onboarding data for authenticated users
  const { data: onboardingData, isLoading: isLoadingOnboarding } = useQuery<any>({
    queryKey: ["/api/onboarding/user"],
    enabled: isAuthenticated,
    retry: false,
  });

  if (isLoading) {
    return <Landing />; // Show landing while auth is loading
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/onboarding" component={Onboarding} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  // Authenticated users
  if (isLoadingOnboarding) {
    return <Landing />; // Show loading state while checking onboarding
  }

  // If user hasn't completed onboarding, redirect to onboarding
  if (!onboardingData?.completed) {
    return (
      <Switch>
        <Route path="/" component={Onboarding} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/dashboard" component={Dashboard} />
        <Route component={NotFound} />
      </Switch>
    );
  }

  // User has completed onboarding, show full app
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/onboarding" component={Onboarding} />
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
