import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { 
  PiggyBank, 
  TrendingUp, 
  MessageCircle, 
  ArrowRight,
  Bot,
  DollarSign,
  Target,
  Sparkles
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { saveOnboarding, savePortfolio } from "@/lib/localStore";
import { useUser } from "@/context/UserContext";
import type { ContributionFrequency } from "@shared/schema";

type OnboardingStep = "choice" | "savings" | "chat" | "suggestions";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function Onboarding() {
  const [, navigate] = useLocation();
  const { user } = useUser();
  const [step, setStep] = useState<OnboardingStep>("choice");
  const [savingsAmount, setSavingsAmount] = useState("");
  const [contributionFrequency, setContributionFrequency] = useState<ContributionFrequency>("irregular");
  const [contributionAmount, setContributionAmount] = useState("");
  const [financialGoals, setFinancialGoals] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Hi! I'm your personal financial assistant. Tell me about your financial goals. What are you hoping to achieve with your money? Are you saving for retirement, a house, emergency fund, or something else?"
    }
  ]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [suggestions, setSuggestions] = useState<any>(null);
  const [stockPrices, setStockPrices] = useState<Record<string, any>>({});
  const { toast } = useToast();

  const handlePortfolioChoice = async () => {
    // Mark onboarding as complete for this user (they have a portfolio already)
    saveOnboarding({
      completed: true,
      savingsAmount: 0,
      contributionFrequency: "irregular",
      contributionAmount: 0,
      suggestions: null,
      completedAt: new Date().toISOString(),
    }, user?.id);
    navigate("/dashboard");
  };

  const handleSavingsChoice = () => {
    setStep("savings");
  };

  const handleSavingsSubmit = () => {
    if (!savingsAmount) {
      toast({
        title: "Please enter your savings amount",
        variant: "destructive"
      });
      return;
    }
    setStep("chat");
  };

  const sendChatMessage = async () => {
    if (!currentMessage.trim()) return;

    const userMessage = currentMessage;
    setCurrentMessage("");
    setChatMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsTyping(true);

    try {
      const response = await apiRequest("POST", "/api/financial-chat", {
        message: userMessage,
        chatHistory: chatMessages,
        savingsAmount: parseFloat(savingsAmount),
        contributionFrequency,
        contributionAmount: parseFloat(contributionAmount)
      });

      const responseData = await response.json();
      setChatMessages(prev => [...prev, { role: "assistant", content: responseData.reply }]);
      
      // If the AI thinks we have enough context, get investment suggestions
      if (responseData.readyForSuggestions) {
        getSuggestions();
      }
    } catch (error) {
      toast({
        title: "Failed to send message",
        description: "Please try again",
        variant: "destructive"
      });
      // Restore the message if API call failed
      setCurrentMessage(userMessage);
    } finally {
      setIsTyping(false);
    }
  };

  const getSuggestions = async () => {
    try {
      const response = await apiRequest("POST", "/api/generate-investment-suggestions", {
        savingsAmount: parseFloat(savingsAmount),
        contributionFrequency,
        contributionAmount: parseFloat(contributionAmount),
        chatHistory: chatMessages
      });
      const responseData = await response.json();
      setSuggestions(responseData);
      setStep("suggestions");

      // Fetch real stock prices for recommended tickers
      const tickers = responseData.recommendations
        ?.filter((r: any) => r.ticker && r.ticker !== "HYSA")
        .map((r: any) => r.ticker);

      if (tickers && tickers.length > 0) {
        try {
          const priceResponse = await apiRequest("POST", "/api/stocks/quotes", { symbols: tickers });
          const prices = await priceResponse.json();
          setStockPrices(prices);
        } catch {
          // Price fetching is optional; don't block the flow
        }
      }
    } catch (error) {
      toast({
        title: "Failed to generate suggestions",
        variant: "destructive"
      });
    }
  };

  const handleAddRecommendationsToPortfolio = () => {
    const portfolioEntries = suggestions.recommendations
      ?.filter((rec: any) => rec.action === 'BUY' && rec.ticker && rec.ticker !== 'HYSA')
      .map((rec: any) => ({
        symbol: rec.ticker,
        name: rec.name,
        shares: stockPrices[rec.ticker]
          ? Math.floor(rec.suggestedAmount / stockPrices[rec.ticker].price)
          : Math.floor(rec.suggestedAmount / 100),
        averagePrice: stockPrices[rec.ticker]?.price ?? 100,
      }));

    if (portfolioEntries && portfolioEntries.length > 0) {
      savePortfolio({
        cash: 0,
        investments: portfolioEntries,
        riskTolerance: "moderate",
        timeline: "long_term",
        lastUpdated: new Date().toISOString(),
      }, user?.id);

      saveOnboarding({
        completed: true,
        savingsAmount: parseFloat(savingsAmount),
        contributionFrequency,
        contributionAmount: parseFloat(contributionAmount),
        suggestions,
        completedAt: new Date().toISOString(),
      }, user?.id);

      toast({
        title: "Portfolio saved! 🎉",
        description: `Added ${portfolioEntries.length} investments to your portfolio`,
      });

      setTimeout(() => navigate("/dashboard"), 800);
    }
  };

  const proceedToDashboard = () => {
    saveOnboarding({
      completed: true,
      savingsAmount: parseFloat(savingsAmount) || 0,
      contributionFrequency,
      contributionAmount: parseFloat(contributionAmount) || 0,
      suggestions,
      completedAt: new Date().toISOString(),
    }, user?.id);
    navigate("/dashboard");
  };

  if (step === "choice") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Welcome{user ? `, ${user.firstName}` : ""}! 🚀
            </h1>
            <p className="text-xl text-gray-600">
              Let's get your investment journey started the right way
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={handlePortfolioChoice}>
              <CardHeader>
                <CardTitle className="flex items-center text-green-700">
                  <TrendingUp className="mr-3 h-8 w-8" />
                  I Have a Portfolio
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 mb-4">
                  I already have investments and want to analyze my existing portfolio for optimization and recommendations.
                </p>
                <div className="flex items-center text-green-600">
                  <span>Go to Portfolio Analysis</span>
                  <ArrowRight className="ml-2 h-4 w-4" />
                </div>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={handleSavingsChoice}>
              <CardHeader>
                <CardTitle className="flex items-center text-blue-700">
                  <PiggyBank className="mr-3 h-8 w-8" />
                  I'm Starting Fresh
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 mb-4">
                  I have savings but haven't started investing yet. I'd like guidance on how to begin my investment journey.
                </p>
                <div className="flex items-center text-blue-600">
                  <span>Get Started with AI Guidance</span>
                  <ArrowRight className="ml-2 h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (step === "savings") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center text-blue-700">
              <DollarSign className="mr-3 h-6 w-6" />
              Tell Us About Your Savings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="savings">How much do you have saved up?</Label>
              <div className="relative mt-2">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                <Input
                  id="savings"
                  type="number"
                  placeholder="10,000"
                  className="pl-8"
                  value={savingsAmount}
                  onChange={(e) => setSavingsAmount(e.target.value)}
                  data-testid="input-savings-amount"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="frequency">How often do you plan on adding money?</Label>
              <Select value={contributionFrequency} onValueChange={(value: ContributionFrequency) => setContributionFrequency(value)}>
                <SelectTrigger className="mt-2" data-testid="select-contribution-frequency">
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Biweekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="irregular">As needed / Irregular</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="contributionAmount">How much do you plan to add?</Label>
              <div className="relative mt-2">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                <Input
                  id="contributionAmount"
                  type="number"
                  placeholder="500"
                  className="pl-8"
                  value={contributionAmount}
                  onChange={(e) => setContributionAmount(e.target.value)}
                  data-testid="input-contribution-amount"
                />
              </div>
            </div>
            
            <p className="text-sm text-gray-600">
              This helps us understand your starting point and suggest appropriate investment strategies for your situation.
            </p>

            <Button 
              onClick={handleSavingsSubmit} 
              className="w-full"
              data-testid="button-continue-savings"
            >
              Continue to Financial Goals
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "chat") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900 flex items-center justify-center">
              <Bot className="mr-3 h-6 w-6 text-blue-600" />
              AI Financial Assistant
            </h2>
            <p className="text-gray-600">Let's discuss your financial goals</p>
          </div>

          <Card className="h-96 mb-4">
            <CardContent className="h-full flex flex-col p-0">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {chatMessages.map((message, index) => (
                  <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      message.role === 'user' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-100 text-gray-900'
                    }`}>
                      {message.content}
                    </div>
                  </div>
                ))}
                
                {isTyping && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 px-4 py-2 rounded-lg">
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t p-4">
                <div className="flex space-x-2">
                  <Input
                    value={currentMessage}
                    onChange={(e) => setCurrentMessage(e.target.value)}
                    placeholder="Tell me about your financial goals..."
                    onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                    data-testid="input-chat-message"
                  />
                  <Button onClick={sendChatMessage} data-testid="button-send-message">
                    <MessageCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="text-center">
            <Button variant="outline" onClick={getSuggestions} data-testid="button-get-suggestions">
              <Sparkles className="mr-2 h-4 w-4" />
              Get My Investment Suggestions
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "suggestions" && suggestions) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Your Personalized Investment Plan
            </h2>
            <p className="text-gray-600">Based on your ${savingsAmount} savings and financial goals</p>
          </div>

          <div className="grid gap-6">
            {suggestions.recommendations?.map((rec: any, index: number) => (
              <Card key={index} className={`border-l-4 ${rec.action === 'BUY' ? 'border-l-green-500' : 'border-l-blue-500'}`}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div>
                      <span className="text-lg">{rec.name || rec.category}</span>
                      {rec.ticker && rec.ticker !== 'HYSA' && (
                        <div className="text-sm text-gray-500 font-mono mt-1">{rec.ticker}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-green-600 font-bold text-xl">
                        ${rec.suggestedAmount.toLocaleString()}
                      </span>
                      <div className={`text-xs px-2 py-1 rounded mt-1 ${
                        rec.action === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {rec.action || 'INVEST'}
                      </div>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {rec.ticker && rec.action === 'BUY' && (
                    <div className="bg-green-50 border border-green-200 p-3 rounded mb-3">
                      <p className="text-sm font-medium text-green-800">🚀 Ready to Buy:</p>
                      <p className="font-mono text-green-700 font-bold">BUY {rec.ticker}: ${rec.suggestedAmount.toLocaleString()}</p>
                      {stockPrices[rec.ticker] && (
                        <div className="mt-2 pt-2 border-t border-green-200 flex justify-between text-sm">
                          <span className="text-gray-600">
                            Live Price: <span className="font-bold text-gray-800">${stockPrices[rec.ticker].price.toFixed(2)}</span>
                          </span>
                          <span className={stockPrices[rec.ticker].change >= 0 ? "text-green-700 font-medium" : "text-red-600 font-medium"}>
                            {stockPrices[rec.ticker].change >= 0 ? "▲" : "▼"} {Math.abs(stockPrices[rec.ticker].changePercent).toFixed(2)}% today
                          </span>
                        </div>
                      )}
                      {stockPrices[rec.ticker] && (
                        <p className="text-xs text-gray-500 mt-1">
                          ≈ {Math.floor(rec.suggestedAmount / stockPrices[rec.ticker].price)} shares at current price
                        </p>
                      )}
                    </div>
                  )}
                  <p className="text-gray-600 mb-2">{rec.explanation}</p>
                  <div className="text-sm text-blue-600 font-medium">
                    {rec.percentage}% of your total savings
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center mt-8 space-y-4">
            <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
              <p className="text-blue-800 font-medium mb-3">Ready to start investing? Update your portfolio with your actual purchases!</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button 
                  onClick={handleAddRecommendationsToPortfolio} 
                  variant="default" 
                  size="lg"
                  data-testid="button-add-recommendations"
                >
                  📊 Add These to My Portfolio
                </Button>
                <Button 
                  onClick={proceedToDashboard} 
                  variant="outline" 
                  size="lg"
                  data-testid="button-proceed-dashboard"
                >
                  <Target className="mr-2 h-5 w-5" />
                  Start My Investment Journey
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}