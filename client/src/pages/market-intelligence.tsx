import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Eye,
  Clock,
  ExternalLink,
  RefreshCw
} from "lucide-react";

interface MarketEvent {
  id: string;
  title: string;
  description: string;
  eventType: string;
  affectedSymbol?: string;
  tone: 'positive' | 'negative' | 'neutral';
  impactLevel: 'low' | 'medium' | 'high';
  confidence: number;
  sourceUrl?: string;
  publishedAt: string;
  aiAnalysis?: {
    reasoning: string;
    priceImpactPrediction: string;
    tradingRecommendation: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
    keyFactors: string[];
    riskLevel: string;
  };
}

interface UserAlert {
  id: string;
  message: string;
  alertType: string;
  isRead: number;
  sentAt: string;
}

export default function MarketIntelligence() {
  const [marketEvents, setMarketEvents] = useState<MarketEvent[]>([]);
  const [newsHeadlines, setNewsHeadlines] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<UserAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const fetchNewsHeadlines = async () => {
    try {
      const response = await apiRequest("GET", "/api/news");
      const data = await response.json();
      setNewsHeadlines(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch news headlines:", error);
    }
  };

  const fetchMarketEvents = async () => {
    try {
      const response = await apiRequest("GET", "/api/market-events");
      const data = await response.json();
      setMarketEvents(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch market events:", error);
    }
  };

  const fetchAlerts = async () => {
    try {
      const response = await apiRequest("GET", "/api/alerts");
      const data = await response.json();
      setAlerts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to fetch alerts:", error);
    }
  };

  const processNews = async () => {
    setIsProcessing(true);
    try {
      const response = await apiRequest("GET", "/api/news/analyze");
      const data = await response.json();
      
      if (data.events && data.events.length > 0) {
        setMarketEvents(prev => [...data.events, ...prev]);
        toast({
          title: "News Analyzed",
          description: `AI analyzed ${data.events.length} real news stories for trading signals`,
        });
      } else {
        toast({
          title: "No actionable events found",
          description: "No strong trading signals in today's headlines",
        });
      }
    } catch (error) {
      toast({
        title: "Failed to analyze news",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await Promise.all([fetchMarketEvents(), fetchAlerts(), fetchNewsHeadlines()]);
      setIsLoading(false);
    };
    loadData();
  }, []);

  const getToneIcon = (tone: string) => {
    switch (tone) {
      case 'positive':
        return <TrendingUp className="h-4 w-4 text-green-600" />;
      case 'negative':
        return <TrendingDown className="h-4 w-4 text-red-600" />;
      default:
        return <Eye className="h-4 w-4 text-gray-600" />;
    }
  };

  const getRecommendationColor = (recommendation?: string) => {
    switch (recommendation) {
      case 'BUY':
        return 'bg-green-100 text-green-800';
      case 'SELL':
        return 'bg-red-100 text-red-800';
      case 'WATCH':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'high':
        return 'bg-red-100 text-red-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-green-100 text-green-800';
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p>Loading market intelligence...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Market Intelligence</h1>
          <p className="text-gray-600">AI-powered market monitoring and trading alerts</p>
        </div>
        <Button 
          onClick={processNews} 
          disabled={isProcessing}
          data-testid="button-process-news"
        >
          {isProcessing ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
          Process Latest News
        </Button>
      </div>

      {/* Live News Headlines */}
      {newsHeadlines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center">
                <Eye className="h-5 w-5 mr-2 text-blue-600" />
                Live Financial News
              </div>
              <Badge variant="secondary">From News API</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {newsHeadlines.slice(0, 6).map((article, index) => (
                <div key={index} className="flex items-start justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                  <div className="flex-1 pr-4">
                    <p className="text-sm font-medium text-gray-900 leading-snug">{article.title}</p>
                    {article.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-1">{article.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-blue-600 font-medium">{article.source}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(article.publishedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {article.url && (
                    <a href={article.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                      <ExternalLink className="h-4 w-4 text-gray-400 hover:text-blue-600" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 text-yellow-600" />
              Recent Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {alerts.slice(0, 5).map((alert) => (
                <div key={alert.id} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
                  <div className="flex-1">
                    <p className="text-sm">{alert.message}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(alert.sentAt).toLocaleString()}
                    </p>
                  </div>
                  <Badge variant={alert.isRead ? "secondary" : "destructive"}>
                    {alert.alertType.replace('_', ' ').toUpperCase()}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Market Events */}
      <div className="grid gap-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Latest Market Events</h2>
          <Badge variant="secondary">{marketEvents.length} events analyzed</Badge>
        </div>

        {marketEvents.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-gray-500">No market events analyzed yet.</p>
              <p className="text-sm text-gray-400 mt-1">
                Click "Process Latest News" to analyze recent market events with AI.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {marketEvents.map((event) => (
              <Card key={event.id} className="overflow-hidden">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        {getToneIcon(event.tone)}
                        <Badge variant="outline">{event.eventType}</Badge>
                        {event.affectedSymbol && (
                          <Badge variant="secondary">{event.affectedSymbol}</Badge>
                        )}
                        <Badge className={getImpactColor(event.impactLevel)}>
                          {event.impactLevel.toUpperCase()} IMPACT
                        </Badge>
                      </div>
                      <CardTitle className="text-lg">{event.title}</CardTitle>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {new Date(event.publishedAt).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-gray-400">
                        AI Confidence: {event.confidence}%
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-700 mb-4">{event.description}</p>
                  
                  {event.aiAnalysis && (
                    <div className="space-y-3">
                      <div className="flex items-center space-x-2">
                        <Badge className={getRecommendationColor(event.aiAnalysis.tradingRecommendation)}>
                          {event.aiAnalysis.tradingRecommendation}
                        </Badge>
                        <span className="text-sm text-gray-600">
                          Risk: {event.aiAnalysis.riskLevel}
                        </span>
                      </div>
                      
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <h4 className="font-medium text-sm mb-2">AI Analysis:</h4>
                        <p className="text-sm text-gray-700 mb-2">{event.aiAnalysis.reasoning}</p>
                        <p className="text-sm font-medium text-blue-700">
                          Price Impact: {event.aiAnalysis.priceImpactPrediction}
                        </p>
                      </div>

                      {event.aiAnalysis.keyFactors.length > 0 && (
                        <div>
                          <h4 className="font-medium text-sm mb-2">Key Factors:</h4>
                          <div className="flex flex-wrap gap-1">
                            {event.aiAnalysis.keyFactors.map((factor, index) => (
                              <Badge key={index} variant="outline" className="text-xs">
                                {factor}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {event.sourceUrl && (
                    <div className="mt-4 pt-3 border-t">
                      <a 
                        href={event.sourceUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm flex items-center"
                      >
                        Read Source <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}