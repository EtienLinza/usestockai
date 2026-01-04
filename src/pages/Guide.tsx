import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  RefreshCw, 
  Loader2, 
  AlertCircle, 
  AlertTriangle, 
  ChevronRight,
  Info,
  Clock,
  Activity,
  Target,
  Shield,
  Zap,
  Calendar,
  BarChart3,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Lightbulb,
  AlertOctagon
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { AddToWatchlistButton } from "@/components/AddToWatchlistButton";

type TradingStyle = "scalping" | "daytrading" | "swing" | "position";
type SortOption = "roi" | "confidence" | "risk";

interface StockOpportunity {
  ticker: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  explanation: string;
  strength: number;
  riskLevel?: "low" | "medium" | "high";
  currentPrice?: number;
  predictedPrice?: number;
  expectedROI?: number;
  riskAdjustedROI?: number;
  volatility?: number;
  holdingPeriod?: string;
  regime?: string;
  aiReasoning?: string;
  keyCatalyst?: string;
  riskFactor?: string;
  aiEnhanced?: boolean;
}

const tradingStyleInfo: Record<TradingStyle, { 
  name: string; 
  description: string; 
  holdingPeriod: string;
  riskLevel: string;
  icon: React.ElementType;
}> = {
  scalping: {
    name: "Scalping",
    description: "Rapid trades capturing small price movements. Requires high volatility and quick execution.",
    holdingPeriod: "Minutes to hours",
    riskLevel: "High",
    icon: Zap,
  },
  daytrading: {
    name: "Day Trading",
    description: "Opening and closing positions within the same trading day. No overnight exposure.",
    holdingPeriod: "Hours (same day)",
    riskLevel: "Medium-High",
    icon: Activity,
  },
  swing: {
    name: "Swing Trading",
    description: "Capturing short-term price swings over several days. Balances risk and opportunity.",
    holdingPeriod: "Days to weeks",
    riskLevel: "Medium",
    icon: BarChart3,
  },
  position: {
    name: "Position Trading",
    description: "Long-term positions based on fundamental trends. Lower frequency, lower risk approach.",
    holdingPeriod: "Weeks to months",
    riskLevel: "Low-Medium",
    icon: Calendar,
  },
};

const Guide = () => {
  const navigate = useNavigate();
  const { user, session } = useAuth();
  const [opportunities, setOpportunities] = useState<StockOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [noOpportunities, setNoOpportunities] = useState(false);
  const [tradingStyle, setTradingStyle] = useState<TradingStyle>("swing");
  const [sortBy, setSortBy] = useState<SortOption>("roi");

  const handleStockClick = (ticker: string) => {
    navigate(`/dashboard?ticker=${ticker}`);
  };

  const getRiskBadge = (riskLevel?: string) => {
    const level = riskLevel || "medium";
    const colors: Record<string, string> = {
      low: "text-success bg-success/10 border-success/20",
      medium: "text-warning bg-warning/10 border-warning/20",
      high: "text-destructive bg-destructive/10 border-destructive/20",
    };
    return (
      <Badge variant="outline" className={`${colors[level]} border gap-1 text-xs`}>
        <AlertTriangle className="w-3 h-3" />
        {level.charAt(0).toUpperCase() + level.slice(1)} Risk
      </Badge>
    );
  };

  const getROIBadge = (roi?: number) => {
    if (roi === undefined || roi === null) return null;
    const isPositive = roi >= 0;
    const color = isPositive 
      ? "text-success bg-success/10 border-success/20" 
      : "text-destructive bg-destructive/10 border-destructive/20";
    const Icon = isPositive ? ArrowUpRight : ArrowDownRight;
    
    return (
      <Badge variant="outline" className={`${color} border gap-1 text-xs font-mono`}>
        <Icon className="w-3 h-3" />
        {isPositive ? "+" : ""}{roi.toFixed(1)}% ROI
      </Badge>
    );
  };

  const fetchOpportunities = async () => {
    if (!session?.access_token) {
      toast.error("Please sign in to access the Guide");
      navigate("/auth");
      return;
    }

    setIsLoading(true);
    setNoOpportunities(false);
    
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stock-predict`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            mode: "guide",
            tradingStyle,
          }),
        }
      );

      if (response.status === 401) {
        toast.error("Session expired. Please sign in again.");
        navigate("/auth");
        return;
      }

      if (response.status === 429) {
        const data = await response.json();
        toast.error(`Rate limit exceeded. Please wait ${data.retryAfter || 60} seconds.`);
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to fetch opportunities");
      }

      const result = await response.json();
      
      if (result.opportunities && result.opportunities.length > 0) {
        setOpportunities(result.opportunities);
        setNoOpportunities(false);
      } else {
        setOpportunities([]);
        setNoOpportunities(true);
      }
      
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Guide fetch error:", error);
      toast.error("Failed to fetch market opportunities");
      setNoOpportunities(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (session?.access_token) {
      fetchOpportunities();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradingStyle, session?.access_token]);

  // Sort opportunities based on selected option
  const sortedOpportunities = [...opportunities].sort((a, b) => {
    switch (sortBy) {
      case "roi":
        return Math.abs(b.expectedROI || 0) - Math.abs(a.expectedROI || 0);
      case "confidence":
        return b.confidence - a.confidence;
      case "risk":
        const riskOrder = { low: 1, medium: 2, high: 3 };
        return (riskOrder[a.riskLevel || "medium"] || 2) - (riskOrder[b.riskLevel || "medium"] || 2);
      default:
        return 0;
    }
  });

  const getDirectionIcon = (direction: string) => {
    switch (direction) {
      case "bullish":
        return <TrendingUp className="w-4 h-4" />;
      case "bearish":
        return <TrendingDown className="w-4 h-4" />;
      default:
        return <Minus className="w-4 h-4" />;
    }
  };

  const getDirectionColor = (direction: string) => {
    switch (direction) {
      case "bullish":
        return "text-success bg-success/10 border-success/20";
      case "bearish":
        return "text-destructive bg-destructive/10 border-destructive/20";
      default:
        return "text-warning bg-warning/10 border-warning/20";
    }
  };

  const formatVolatility = (vol?: number) => {
    if (!vol) return "N/A";
    return `${(vol * 100).toFixed(1)}%`;
  };

  const formatPrice = (price?: number) => {
    if (!price) return "N/A";
    return `$${price.toFixed(2)}`;
  };

  // Calculate summary stats
  const avgROI = opportunities.length > 0 
    ? opportunities.reduce((sum, o) => sum + (o.expectedROI || 0), 0) / opportunities.length 
    : 0;
  const topPick = opportunities.length > 0 
    ? opportunities.reduce((max, o) => (Math.abs(o.expectedROI || 0) > Math.abs(max.expectedROI || 0) ? o : max), opportunities[0])
    : null;

  const currentStyleInfo = tradingStyleInfo[tradingStyle];
  const StyleIcon = currentStyleInfo.icon;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <Navbar />
        
        {/* Subtle background */}
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-primary/2 rounded-full blur-[150px]" />
        </div>
        
        <main className="pt-20 pb-12 px-4 sm:px-6 relative z-10">
          <div className="container mx-auto max-w-4xl">
            {/* Header */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-medium mb-1">Guide</h1>
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    AI-identified opportunities from market-wide scanning
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchOpportunities}
                  disabled={isLoading}
                  className="gap-2 text-muted-foreground self-start sm:self-auto"
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  Refresh
                </Button>
              </div>

              {/* Trading Style Selector */}
              <Card className="glass-card p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <StyleIcon className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Trading Style</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs">
                              Select your preferred trading approach. Results are filtered to show stocks that match your style's volatility and holding period preferences.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {currentStyleInfo.description}
                      </p>
                    </div>
                  </div>
                  
                  <Select value={tradingStyle} onValueChange={(v) => setTradingStyle(v as TradingStyle)}>
                    <SelectTrigger className="w-full sm:w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(tradingStyleInfo) as TradingStyle[]).map((style) => {
                        const info = tradingStyleInfo[style];
                        const Icon = info.icon;
                        return (
                          <SelectItem key={style} value={style}>
                            <div className="flex items-center gap-2">
                              <Icon className="w-4 h-4" />
                              <span>{info.name}</span>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Style Details */}
                <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-border/30">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{currentStyleInfo.holdingPeriod}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Shield className="w-3.5 h-3.5" />
                    <span>{currentStyleInfo.riskLevel} Risk</span>
                  </div>
                </div>
              </Card>

              {/* Summary Stats & Sort */}
              {opportunities.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Avg ROI:</span>
                      <span className={`font-mono font-medium ${avgROI >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {avgROI >= 0 ? '+' : ''}{avgROI.toFixed(1)}%
                      </span>
                    </div>
                    {topPick && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Top Pick:</span>
                        <span className="font-mono font-medium text-primary">{topPick.ticker}</span>
                        <span className={`font-mono ${(topPick.expectedROI || 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                          ({(topPick.expectedROI || 0) >= 0 ? '+' : ''}{(topPick.expectedROI || 0).toFixed(1)}%)
                        </span>
                      </div>
                    )}
                  </div>
                  
                  <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                    <SelectTrigger className="w-full sm:w-[160px]">
                      <SelectValue placeholder="Sort by..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="roi">Highest ROI</SelectItem>
                      <SelectItem value="confidence">Highest Confidence</SelectItem>
                      <SelectItem value="risk">Lowest Risk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {lastUpdated && (
                <p className="text-xs text-muted-foreground mt-3">
                  Last updated: {lastUpdated.toLocaleTimeString()}
                </p>
              )}
            </motion.div>

            {/* Content */}
            <AnimatePresence mode="wait">
              {isLoading && opportunities.length === 0 ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="glass-card p-12 sm:p-16 text-center"
                >
                  <Loader2 className="w-8 h-8 text-primary mx-auto mb-4 animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Scanning market for {tradingStyleInfo[tradingStyle].name.toLowerCase()} opportunities...
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-2">
                    Scanning markets and analyzing opportunities...
                  </p>
                </motion.div>
              ) : noOpportunities ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="glass-card p-12 sm:p-16 text-center"
                >
                  <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4">
                    <AlertCircle className="w-6 h-6 text-warning" />
                  </div>
                  <h3 className="text-sm font-medium mb-2">No Strong Opportunities</h3>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                    Market conditions are not favorable for {tradingStyleInfo[tradingStyle].name.toLowerCase()} right now. 
                    Try a different trading style or check back later.
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="results"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-3"
                >
                  {sortedOpportunities.map((opp, index) => (
                    <motion.div
                      key={opp.ticker}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.08 }}
                    >
                      <Card 
                        className="glass-card p-4 sm:p-5 cursor-pointer transition-all duration-200 hover:border-primary/30 hover:bg-primary/5 group"
                        onClick={() => handleStockClick(opp.ticker)}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                          {/* Left: Stock Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span className="font-mono text-base sm:text-lg font-medium text-primary group-hover:text-primary/90">
                                {opp.ticker}
                              </span>
                              <Badge 
                                variant="outline" 
                                className={`${getDirectionColor(opp.direction)} border gap-1 text-xs`}
                              >
                                {getDirectionIcon(opp.direction)}
                                {opp.direction.charAt(0).toUpperCase() + opp.direction.slice(1)}
                              </Badge>
                              {getROIBadge(opp.expectedROI)}
                              {getRiskBadge(opp.riskLevel)}
                              {opp.aiEnhanced && (
                                <Badge variant="outline" className="text-primary bg-primary/10 border-primary/20 gap-1 text-xs">
                                  <Sparkles className="w-3 h-3" />
                                  AI Enhanced
                                </Badge>
                              )}
                            </div>
                            
                            {/* AI Reasoning */}
                            {opp.aiReasoning ? (
                              <p className="text-xs sm:text-sm text-foreground leading-relaxed mb-3">
                                {opp.aiReasoning}
                              </p>
                            ) : (
                              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed mb-3">
                                {opp.explanation}
                              </p>
                            )}

                            {/* Catalyst & Risk */}
                            {(opp.keyCatalyst || opp.riskFactor) && (
                              <div className="flex flex-wrap gap-3 mb-3">
                                {opp.keyCatalyst && (
                                  <div className="flex items-start gap-1.5 text-xs">
                                    <Lightbulb className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
                                    <span className="text-muted-foreground">
                                      <span className="font-medium text-foreground">Catalyst:</span> {opp.keyCatalyst}
                                    </span>
                                  </div>
                                )}
                                {opp.riskFactor && (
                                  <div className="flex items-start gap-1.5 text-xs">
                                    <AlertOctagon className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                                    <span className="text-muted-foreground">
                                      <span className="font-medium text-foreground">Risk:</span> {opp.riskFactor}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Metrics Row */}
                            <div className="flex flex-wrap gap-3 sm:gap-4">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help">
                                    <Target className="w-3.5 h-3.5" />
                                    <span className="font-mono">{formatPrice(opp.currentPrice)}</span>
                                    <span className="text-primary">→</span>
                                    <span className="font-mono text-foreground">{formatPrice(opp.predictedPrice)}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">Current → Predicted Price</p>
                                </TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help">
                                    <Activity className="w-3.5 h-3.5" />
                                    <span>Vol: {formatVolatility(opp.volatility)}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">Daily Volatility (20-day)</p>
                                </TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help">
                                    <Clock className="w-3.5 h-3.5" />
                                    <span>{opp.holdingPeriod || currentStyleInfo.holdingPeriod}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">Expected Holding Period</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </div>

                          {/* Right: Confidence & Actions */}
                          <div className="flex sm:flex-col items-center gap-3 sm:gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="relative w-14 h-14 shrink-0">
                                  <svg className="w-14 h-14 -rotate-90">
                                    <circle
                                      cx="28"
                                      cy="28"
                                      r="24"
                                      strokeWidth="4"
                                      fill="none"
                                      className="stroke-muted/20"
                                    />
                                    <circle
                                      cx="28"
                                      cy="28"
                                      r="24"
                                      strokeWidth="4"
                                      fill="none"
                                      strokeLinecap="round"
                                      className="stroke-primary"
                                      strokeDasharray={`${(opp.confidence / 100) * 150.8} 150.8`}
                                    />
                                  </svg>
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-xs font-mono font-medium">{opp.confidence}%</span>
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">AI Confidence Score</p>
                              </TooltipContent>
                            </Tooltip>
                            
                            <div className="flex items-center gap-2">
                              <AddToWatchlistButton 
                                ticker={opp.ticker} 
                                assetType={opp.ticker.includes('-') ? 'crypto' : 'stock'}
                              />
                              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors hidden sm:block" />
                            </div>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Disclaimer */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-8 p-4 rounded-lg bg-warning/5 border border-warning/10"
            >
              <div className="flex gap-3">
                <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-medium text-warning">Disclaimer:</span> These AI-generated insights are for educational purposes only and should not be considered financial advice. 
                  Always conduct your own research and consult with a qualified financial advisor before making investment decisions.
                </p>
              </div>
            </motion.div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
};

export default Guide;
