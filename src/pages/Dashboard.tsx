import { useState, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { PredictionForm } from "@/components/PredictionForm";
import { StockPredictionCard } from "@/components/StockPredictionCard";
import { StockComparisonView } from "@/components/StockComparisonView";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { Brain, TrendingUp, Shield, Sparkles, Layers, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface PredictionData {
  ticker: string;
  targetDate: string;
  currentPrice: number;
  predictedPrice: number;
  uncertaintyLow: number;
  uncertaintyHigh: number;
  confidence: number;
  regime: string;
  sentimentScore: number;
  featureImportance: { name: string; importance: number }[];
  historicalData: { date: string; price: number }[];
  reasoning?: string;
  volatility?: number;
  currency?: string;
}

const Dashboard = () => {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [predictions, setPredictions] = useState<PredictionData[]>([]);
  const [lastFormData, setLastFormData] = useState<{ ticker: string; targetDate: Date } | null>(null);
  const [initialTicker, setInitialTicker] = useState<string>("");
  const [viewMode, setViewMode] = useState<'single' | 'compare'>('single');

  // Handle ticker from URL params (from Guide page)
  useEffect(() => {
    const tickerParam = searchParams.get("ticker");
    if (tickerParam) {
      setInitialTicker(tickerParam.toUpperCase());
    }
  }, [searchParams]);

  // Auto-switch to compare mode when multiple predictions
  useEffect(() => {
    if (predictions.length > 1) {
      setViewMode('compare');
    } else if (predictions.length <= 1) {
      setViewMode('single');
    }
  }, [predictions.length]);

  const handleSubmit = async (data: { ticker: string; targetDate: Date }) => {
    if (!session?.access_token) {
      toast.error("Please sign in to generate predictions");
      navigate("/auth");
      return;
    }

    // Check if this ticker already exists
    const existingIndex = predictions.findIndex(p => p.ticker === data.ticker);
    if (existingIndex !== -1) {
      toast.info(`${data.ticker} is already being compared. Refreshing...`);
    }

    setIsLoading(true);
    setLastFormData(data);
    
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
            ticker: data.ticker,
            targetDate: format(data.targetDate, "yyyy-MM-dd"),
          }),
        }
      );

      if (response.status === 401) {
        toast.error("Session expired. Please sign in again.");
        navigate("/auth");
        return;
      }

      if (response.status === 429) {
        const errorData = await response.json();
        toast.error(`Rate limit exceeded. Please wait ${errorData.retryAfter || 60} seconds.`);
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate prediction");
      }

      const result: PredictionData = await response.json();
      
      setPredictions(prev => {
        // If ticker exists, replace it
        const existingIdx = prev.findIndex(p => p.ticker === result.ticker);
        if (existingIdx !== -1) {
          const updated = [...prev];
          updated[existingIdx] = result;
          return updated;
        }
        // Otherwise add new (max 6 for comparison)
        if (prev.length >= 6) {
          toast.info("Maximum 6 stocks for comparison. Removing oldest.");
          return [...prev.slice(1), result];
        }
        return [...prev, result];
      });
      
      if (user) {
        const { error } = await supabase.from("prediction_runs").insert({
          user_id: user.id,
          ticker: result.ticker,
          target_date: result.targetDate,
          predicted_price: result.predictedPrice,
          uncertainty_low: result.uncertaintyLow,
          uncertainty_high: result.uncertaintyHigh,
          confidence: result.confidence,
          current_price: result.currentPrice,
          feature_importance: result.featureImportance,
          historical_data: result.historicalData,
          regime: result.regime,
          sentiment_score: result.sentimentScore,
        });
        
        if (error) {
          console.error("Failed to save prediction:", error);
        }
      }
      
      toast.success(`Analysis complete for ${data.ticker}`);
    } catch (error) {
      console.error("Prediction error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to generate prediction");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    if (lastFormData) {
      await handleSubmit(lastFormData);
    }
  }, [lastFormData, session?.access_token]);

  const handleRemovePrediction = (index: number) => {
    setPredictions(prev => prev.filter((_, i) => i !== index));
    toast.success("Stock removed from comparison");
  };

  const handleClearAll = () => {
    setPredictions([]);
    setViewMode('single');
    toast.success("All predictions cleared");
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Subtle background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/2 rounded-full blur-[150px]" />
      </div>
      
      <main className="pt-20 pb-12 px-4 sm:px-6 relative z-10">
        <div className="container mx-auto max-w-7xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          >
            <div>
              <h1 className="text-xl sm:text-2xl font-medium mb-1">Dashboard</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Analyze and compare stocks
              </p>
            </div>

            {/* View Mode & Actions */}
            {predictions.length > 0 && (
              <div className="flex items-center gap-2">
                {predictions.length > 1 && (
                  <div className="flex items-center gap-1 p-1 bg-secondary/50 rounded-lg">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewMode('single')}
                      className={cn(
                        "h-7 px-2 text-xs gap-1",
                        viewMode === 'single' && "bg-background shadow-sm"
                      )}
                    >
                      <LayoutGrid className="w-3 h-3" />
                      <span className="hidden sm:inline">Single</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewMode('compare')}
                      className={cn(
                        "h-7 px-2 text-xs gap-1",
                        viewMode === 'compare' && "bg-background shadow-sm"
                      )}
                    >
                      <Layers className="w-3 h-3" />
                      <span className="hidden sm:inline">Compare</span>
                    </Button>
                  </div>
                )}
                <Badge variant="outline" className="text-xs">
                  {predictions.length}/6
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                >
                  Clear All
                </Button>
              </div>
            )}
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            {/* Form Section */}
            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="lg:col-span-4 xl:col-span-3"
            >
              <div className="sticky top-20">
                <PredictionForm 
                  onSubmit={handleSubmit} 
                  isLoading={isLoading} 
                  initialTicker={initialTicker}
                />

                {/* Quick Tips */}
                {predictions.length === 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="mt-4 p-4 border border-border/30 rounded-lg"
                  >
                    <p className="text-xs text-muted-foreground">
                      <span className="text-primary font-medium">Tip:</span> Add multiple stocks to compare them side by side. Up to 6 stocks supported.
                    </p>
                  </motion.div>
                )}
              </div>
            </motion.div>

            {/* Results Section */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="lg:col-span-8 xl:col-span-9"
            >
              <AnimatePresence mode="wait">
                {predictions.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-6"
                  >
                    {/* How it works */}
                    <div className="glass-card p-6 sm:p-8">
                      <h3 className="text-base sm:text-lg font-medium mb-6 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                        How StockAI Works
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                        <div className="space-y-3">
                          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                          </div>
                          <h4 className="text-xs sm:text-sm font-medium">Real Market Data</h4>
                          <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                            We pull live price data and compute technical indicators like RSI, MACD, EMA, and volatility metrics.
                          </p>
                        </div>
                        <div className="space-y-3">
                          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Brain className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                          </div>
                          <h4 className="text-xs sm:text-sm font-medium">AI Analysis</h4>
                          <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                            Advanced AI models analyze patterns, market regime, and sentiment to generate predictions.
                          </p>
                        </div>
                        <div className="space-y-3">
                          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                          </div>
                          <h4 className="text-xs sm:text-sm font-medium">Risk Assessment</h4>
                          <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                            Every prediction includes uncertainty ranges and confidence levels.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Disclaimer */}
                    <div className="flex items-start gap-3 p-4 border border-border/30 rounded-lg">
                      <Shield className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                      <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                        <span className="font-medium text-foreground">Important:</span> StockAI provides AI-generated analysis for informational purposes only. 
                        This is not financial advice.
                      </p>
                    </div>
                  </motion.div>
                ) : predictions.length === 1 && viewMode === 'single' ? (
                  <motion.div
                    key="single"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <StockPredictionCard data={predictions[0]} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="compare"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <StockComparisonView 
                      predictions={predictions} 
                      onRemove={handleRemovePrediction}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
