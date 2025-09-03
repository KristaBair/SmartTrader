import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { portfolioFormSchema, type PortfolioFormData, type Portfolio } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, Brain } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";

interface PortfolioInputProps {
  onSubmit: (data: PortfolioFormData) => Promise<void>;
  isLoading: boolean;
  portfolio?: Portfolio;
}

export default function PortfolioInput({ onSubmit, isLoading, portfolio }: PortfolioInputProps) {
  const { toast } = useToast();
  const [riskAssessment, setRiskAssessment] = useState<{
    level: string;
    score: number;
    explanation: string;
  } | null>(null);

  const form = useForm<PortfolioFormData>({
    resolver: zodResolver(portfolioFormSchema),
    defaultValues: {
      cash: "",
      investments: "",
      riskTolerance: "Moderate",
      timeline: "Medium-term (1-5 years)",
    },
  });

  // Update form when portfolio data is loaded
  useEffect(() => {
    if (portfolio) {
      const investmentsText = portfolio.investments
        .map(inv => `${inv.symbol}: $${inv.amount}`)
        .join(', ');
      
      form.reset({
        cash: portfolio.cash,
        investments: investmentsText,
        riskTolerance: portfolio.riskTolerance as any,
        timeline: portfolio.timeline as any,
      });
    }
  }, [portfolio, form]);

  // Risk assessment mutation
  const riskAssessmentMutation = useMutation({
    mutationFn: async ({ investments, riskTolerance }: { investments: string; riskTolerance: string }) => {
      const response = await apiRequest("POST", "/api/risk-assessment", { investments, riskTolerance });
      return response.json();
    },
    onSuccess: (data) => {
      setRiskAssessment(data);
    },
    onError: (error) => {
      toast({
        title: "Risk Assessment Failed",
        description: "Unable to assess risk at this time.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (data: PortfolioFormData) => {
    await onSubmit(data);
    
    // Trigger risk assessment
    riskAssessmentMutation.mutate({
      investments: data.investments,
      riskTolerance: data.riskTolerance,
    });
  };

  const watchedInvestments = form.watch("investments");
  const watchedRiskTolerance = form.watch("riskTolerance");

  // Auto-trigger risk assessment when investments or risk tolerance changes
  useEffect(() => {
    if (watchedInvestments && watchedRiskTolerance) {
      const timeoutId = setTimeout(() => {
        riskAssessmentMutation.mutate({
          investments: watchedInvestments,
          riskTolerance: watchedRiskTolerance,
        });
      }, 1000);

      return () => clearTimeout(timeoutId);
    }
  }, [watchedInvestments, watchedRiskTolerance]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <PlusCircle className="text-primary mr-3" />
          Portfolio Input
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="cash"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Cash Available</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                      <Input
                        {...field}
                        type="number"
                        placeholder="10,000"
                        className="pl-8"
                        data-testid="input-cash"
                      />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="investments"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current Investments</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="AAPL: $5000, GOOGL: $3000, BTC: $2000..."
                      rows={4}
                      className="resize-none"
                      data-testid="input-investments"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="riskTolerance"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Risk Tolerance</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-risk-tolerance">
                        <SelectValue placeholder="Select risk tolerance" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Conservative">Conservative</SelectItem>
                      <SelectItem value="Moderate">Moderate</SelectItem>
                      <SelectItem value="Aggressive">Aggressive</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="timeline"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Investment Timeline</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-timeline">
                        <SelectValue placeholder="Select timeline" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="Short-term (< 1 year)">Short-term (&lt; 1 year)</SelectItem>
                      <SelectItem value="Medium-term (1-5 years)">Medium-term (1-5 years)</SelectItem>
                      <SelectItem value="Long-term (5+ years)">Long-term (5+ years)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button 
              type="submit" 
              className="w-full" 
              disabled={isLoading}
              data-testid="button-analyze"
            >
              <Brain className="mr-2 h-4 w-4" />
              {isLoading ? "Analyzing..." : "Analyze with AI"}
            </Button>
          </form>
        </Form>

        {/* Risk Assessment Display */}
        {riskAssessment && (
          <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200" data-testid="risk-assessment-display">
            <h4 className="font-medium text-blue-900 mb-2">Risk Assessment</h4>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-blue-700">Current Risk Level</span>
              <span className="text-sm font-medium text-blue-900" data-testid="text-risk-level">
                {riskAssessment.level}
              </span>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2 mb-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${riskAssessment.score}%` }}
                data-testid="progress-risk-score"
              ></div>
            </div>
            <p className="text-xs text-blue-700" data-testid="text-risk-explanation">
              {riskAssessment.explanation}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
