import { useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, DollarSign, TrendingUp, Sparkles, AlertTriangle, CheckCircle2, Loader2
} from "lucide-react";

interface Suggestion {
  symbol: string;
  name: string;
  amount: number;
  allocationPercent: number;
  reasoning: string;
  confidence: number;
  assetType: string;
}

interface InvestPlan {
  totalAmount: number;
  suggestions: Suggestion[];
  summary: string;
  riskNote: string;
}

const assetTypeColors: Record<string, string> = {
  "Stock": "bg-blue-100 text-blue-800",
  "ETF": "bg-green-100 text-green-800",
  "Index Fund": "bg-purple-100 text-purple-800",
  "Bond ETF": "bg-yellow-100 text-yellow-800",
};

export default function Invest() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [riskTolerance, setRiskTolerance] = useState("moderate");
  const [goal, setGoal] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [plan, setPlan] = useState<InvestPlan | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(amount.replace(/,/g, ""));
    if (!parsed || parsed < 1) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }

    try {
      setIsLoading(true);
      setPlan(null);
      const response = await apiRequest("POST", "/api/invest/suggest", {
        amount: parsed,
        riskTolerance,
        goal: goal || undefined,
      });
      const data = await response.json();
      setPlan(data);
    } catch (err) {
      toast({ title: "Failed to generate plan", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
              </Button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                  <DollarSign className="text-white h-4 w-4" />
                </div>
                <h1 className="text-xl font-bold text-gray-900">Smart Invest</h1>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Input card */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-t-lg">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Tell the AI how much you want to invest
            </CardTitle>
            <p className="text-green-100 text-sm">
              Enter your amount and risk preference — the AI will create a specific, personalized allocation plan.
            </p>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="amount">Investment Amount ($)</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      id="amount"
                      type="text"
                      placeholder="e.g. 5000"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="pl-9 text-lg font-semibold"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Risk Tolerance</Label>
                  <Select value={riskTolerance} onValueChange={setRiskTolerance}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="conservative">Conservative — Safety first</SelectItem>
                      <SelectItem value="moderate">Moderate — Balanced growth</SelectItem>
                      <SelectItem value="aggressive">Aggressive — Maximum growth</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal">Investment Goal (optional)</Label>
                <Input
                  id="goal"
                  placeholder="e.g. retirement in 10 years, buy a house in 3 years, grow wealth long-term..."
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading || !amount}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 text-base"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    AI is building your plan...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Get My Investment Plan
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Results */}
        {plan && (
          <div className="space-y-6">
            {/* Summary */}
            <Card className="border-0 shadow-md border-l-4 border-l-green-500">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">
                      Plan for ${plan.totalAmount.toLocaleString()} — {riskTolerance} risk
                    </h3>
                    <p className="text-gray-700">{plan.summary}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Allocation breakdown */}
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
                Recommended Allocations
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {plan.suggestions.map((s) => (
                  <Card key={s.symbol} className="border shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xl font-bold text-gray-900">{s.symbol}</span>
                            <Badge className={assetTypeColors[s.assetType] || "bg-gray-100 text-gray-800"}>
                              {s.assetType}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-600">{s.name}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-green-700">${s.amount.toLocaleString()}</p>
                          <p className="text-sm text-gray-500">{s.allocationPercent.toFixed(1)}%</p>
                        </div>
                      </div>

                      {/* Allocation bar */}
                      <div className="mb-3">
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full"
                            style={{ width: `${s.allocationPercent}%` }}
                          />
                        </div>
                      </div>

                      <p className="text-sm text-gray-700 mb-3">{s.reasoning}</p>

                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">AI Confidence</span>
                        <div className="flex items-center gap-1">
                          <div className="h-1.5 w-16 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${s.confidence}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-gray-700">{s.confidence}%</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Risk warning */}
            <Card className="border-yellow-200 bg-yellow-50">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-yellow-900 mb-1">Risk Note</p>
                    <p className="text-sm text-yellow-800">{plan.riskNote}</p>
                    <p className="text-xs text-yellow-700 mt-2">
                      This is AI-generated information for educational purposes only — not financial advice.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
