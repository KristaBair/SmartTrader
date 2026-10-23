import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, Loader2, LockKeyhole } from "lucide-react";

interface SpendingCutbackOption {
  cutPercent: number;
  monthlySavings: number;
  suggestedContributionAfterCut: number;
}

interface SpendingCategory {
  category: string;
  monthlyAverage: number;
  cutbackOptions: SpendingCutbackOption[];
}

interface SpendingReport {
  periodStart: string;
  periodEnd: string;
  daysAnalyzed: number;
  transactionsAnalyzed: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlySurplus: number;
  suggestedMonthlyContribution: number;
  categories: SpendingCategory[];
  notices: string[];
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCategory(category: string) {
  return category
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function readErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as { message?: string };
      if (parsed.message) return parsed.message;
    } catch {
      // Use the safe fallback below.
    }
  }
  return "Could not analyze spending. Connect a bank account and try again.";
}

export default function SpendingAnalysisPanel() {
  const { toast } = useToast();
  const [report, setReport] = useState<SpendingReport | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const analyzeSpending = async () => {
    setIsAnalyzing(true);
    setErrorMessage("");
    try {
      const response = await apiRequest("POST", "/api/spending/analyze");
      const result = await response.json() as SpendingReport;
      setReport(result);
      toast({ title: "Spending analysis complete" });
    } catch (error) {
      setErrorMessage(readErrorMessage(error));
      toast({
        title: "Could not analyze spending",
        description: readErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BarChart3 className="h-5 w-5 text-emerald-600" />
          Analyze my spending
        </CardTitle>
        <p className="text-sm text-gray-500">
          Estimate a monthly investing amount from your recent bank activity and explore spending cutbacks.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs leading-5 text-emerald-950">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Uses the last 90 days of completed USD transactions. Transfers and pending items are excluded. The report is calculated on the server; raw transactions and merchant names are not stored or sent to Amazon Bedrock. Only this summary is included in AI portfolio analysis, as described in the Terms.
          </p>
        </div>

        <Button onClick={() => void analyzeSpending()} disabled={isAnalyzing}>
          {isAnalyzing
            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            : <BarChart3 className="mr-2 h-4 w-4" />}
          {isAnalyzing ? "Analyzing spending" : "Analyze my spending"}
        </Button>

        {errorMessage && (
          <p role="alert" className="text-sm text-red-700">{errorMessage}</p>
        )}

        {report && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              {report.periodStart} to {report.periodEnd}. {report.transactionsAnalyzed.toLocaleString()} completed transactions analyzed.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Average monthly income</p>
                <p className="mt-1 font-semibold text-gray-900">{formatMoney(report.monthlyIncome)}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">Average monthly spending</p>
                <p className="mt-1 font-semibold text-gray-900">{formatMoney(report.monthlyExpenses)}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">
                  {report.monthlySurplus >= 0 ? "Estimated monthly surplus" : "Estimated monthly shortfall"}
                </p>
                <p className={`mt-1 font-semibold ${report.monthlySurplus >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {formatMoney(Math.abs(report.monthlySurplus))}
                </p>
              </div>
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-xs text-indigo-800">Suggested starting investment</p>
                <p className="mt-1 font-semibold text-indigo-950">
                  {formatMoney(report.suggestedMonthlyContribution)}/month
                </p>
              </div>
            </div>

            {report.categories.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-900">
                  Possible cutbacks
                </h3>
                <p className="mb-3 text-xs text-gray-500">
                  Examples based on your largest spending categories. Choose only changes that fit your needs.
                </p>
                <div className="space-y-3">
                  {report.categories.map((category) => (
                    <details key={category.category} className="rounded-lg border border-gray-200 p-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-gray-900">
                          {formatCategory(category.category)}
                        </span>
                        <span className="text-gray-600">
                          {formatMoney(category.monthlyAverage)}/month
                        </span>
                      </summary>
                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {category.cutbackOptions.map((option) => (
                          <div
                            key={option.cutPercent}
                            className="rounded-md bg-gray-50 p-2 text-xs"
                          >
                            <p className="font-semibold text-gray-800">
                              Cut {option.cutPercent}%
                            </p>
                            <p className="mt-1 text-gray-600">
                              Frees {formatMoney(option.monthlySavings)}/month
                            </p>
                            <p className="mt-1 text-indigo-800">
                              Suggested amount: {formatMoney(option.suggestedContributionAfterCut)}/month
                            </p>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1 border-t border-gray-100 pt-3">
              {report.notices.map((notice) => (
                <p key={notice} className="text-xs leading-5 text-gray-500">{notice}</p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
