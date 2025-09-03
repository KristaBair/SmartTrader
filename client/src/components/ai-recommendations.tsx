import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, TrendingUp, TrendingDown } from "lucide-react";
import type { Recommendation } from "@shared/schema";

interface AIRecommendationsProps {
  recommendations: Recommendation[];
  isLoading: boolean;
}

export default function AIRecommendations({ recommendations, isLoading }: AIRecommendationsProps) {
  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center">
            <Bot className="text-accent mr-3" />
            AI Investment Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-6 w-12" />
                </div>
                <Skeleton className="h-12 w-full mb-3" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center">
          <Bot className="text-accent mr-3" />
          AI Investment Recommendations
        </CardTitle>
      </CardHeader>
      <CardContent>
        {recommendations.length === 0 ? (
          <div className="text-center py-8 text-gray-500" data-testid="empty-recommendations">
            <Bot className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p className="text-lg font-medium mb-2">No Recommendations Yet</p>
            <p className="text-sm">Submit your portfolio details to get AI-powered investment recommendations.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {recommendations.map((recommendation) => (
              <div 
                key={recommendation.id} 
                className="border border-gray-200 rounded-lg p-4 hover:border-primary transition-colors"
                data-testid={`recommendation-${recommendation.symbol.toLowerCase()}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-gray-900" data-testid={`text-symbol-${recommendation.symbol.toLowerCase()}`}>
                      {recommendation.symbol}
                    </h4>
                    <p className="text-sm text-gray-600" data-testid={`text-name-${recommendation.symbol.toLowerCase()}`}>
                      {recommendation.name}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge 
                      variant={recommendation.action === "BUY" ? "default" : "destructive"}
                      className="mb-1"
                      data-testid={`badge-action-${recommendation.symbol.toLowerCase()}`}
                    >
                      {recommendation.action === "BUY" ? (
                        <TrendingUp className="mr-1 h-3 w-3" />
                      ) : (
                        <TrendingDown className="mr-1 h-3 w-3" />
                      )}
                      {recommendation.action}
                    </Badge>
                    <div className="text-sm text-gray-600">
                      Confidence: <span className="font-medium" data-testid={`text-confidence-${recommendation.symbol.toLowerCase()}`}>
                        {recommendation.confidence}%
                      </span>
                    </div>
                  </div>
                </div>
                
                <p className="text-sm text-gray-700 mb-3" data-testid={`text-reasoning-${recommendation.symbol.toLowerCase()}`}>
                  {recommendation.reasoning}
                </p>
                
                <div className="flex items-center justify-between text-sm">
                  {recommendation.targetPrice && (
                    <span className="text-gray-600">
                      Target Price: <span className="font-medium text-gray-900" data-testid={`text-target-price-${recommendation.symbol.toLowerCase()}`}>
                        ${parseFloat(recommendation.targetPrice).toFixed(2)}
                      </span>
                    </span>
                  )}
                  {recommendation.currentPrice && (
                    <span className="text-gray-600">
                      Current Price: <span className="font-medium text-gray-900" data-testid={`text-current-price-${recommendation.symbol.toLowerCase()}`}>
                        ${parseFloat(recommendation.currentPrice).toFixed(2)}
                      </span>
                    </span>
                  )}
                  {recommendation.expectedReturn && (
                    <span className="text-gray-600">
                      Expected Return: <span className="font-medium text-profit" data-testid={`text-expected-return-${recommendation.symbol.toLowerCase()}`}>
                        +{parseFloat(recommendation.expectedReturn).toFixed(1)}%
                      </span>
                    </span>
                  )}
                  {recommendation.recommendedAmount && (
                    <span className="text-gray-600">
                      Amount: <span className="font-medium text-gray-900" data-testid={`text-recommended-amount-${recommendation.symbol.toLowerCase()}`}>
                        ${parseFloat(recommendation.recommendedAmount).toFixed(0)}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
