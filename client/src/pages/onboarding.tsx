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
import type { ContributionFrequency } from "@shared/schema";

type OnboardingStep = "choice" | "savings" | "chat" | "suggestions";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function Onboarding() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<OnboardingStep>("choice");
  const [savingsAmount, setSavingsAmount] = useState("");
  const [contributionFrequency, setContributionFrequency] = useState<ContributionFrequency>("monthly");
  const [contributionAmount, setContributionAmount] = useState("");
  const [financialGoals, setFinancialGoals] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Hi! I'm your personal financial assistant. Tell me about your financial goals - what are you hoping to achieve with your money? Are you saving for retirement, a house, emergency fund, or something else?"
    }
  ]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [suggestions, setSuggestions] = useState<any>(null);
  const { toast } = useToast();

  const handlePortfolioChoice = async () => {
    try {
      // Save onboarding choice for authenticated users
      await apiRequest("POST", "/api/onboarding", {
        onboardingType: "portfolio",
        completed: new Date()
      });
    } catch (error) {
      console.log("Failed to save onboarding data:", error);
    }
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
    } catch (error) {
      toast({
        title: "Failed to generate suggestions",
        variant: "destructive"
      });
    }
  };

  const proceedToDashboard = async () => {
    try {
      // Save onboarding data for users who completed the savings path
      await apiRequest("POST", "/api/onboarding", {
        onboardingType: "savings",
        savingsAmount: parseFloat(savingsAmount),
        contributionFrequency,
        contributionAmount: parseFloat(contributionAmount),
        chatHistory: chatMessages,
        investmentSuggestions: suggestions,
        completed: new Date()
      });
    } catch (error) {
      console.log("Failed to save onboarding data:", error);
    }
    navigate("/dashboard");
  };

  if (step === "choice") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-4xl w-full">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Welcome to SmartTrader! 🚀
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
              <Card key={index}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{rec.category}</span>
                    <span className="text-green-600 font-bold">
                      ${rec.suggestedAmount.toLocaleString()}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 mb-2">{rec.explanation}</p>
                  <div className="text-sm text-blue-600">
                    {rec.percentage}% of your savings
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center mt-8">
            <Button onClick={proceedToDashboard} size="lg" data-testid="button-proceed-dashboard">
              <Target className="mr-2 h-5 w-5" />
              Start My Investment Journey
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}