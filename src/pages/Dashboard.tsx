import { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { PredictionForm } from "@/components/PredictionForm";
import { StockPredictionCard } from "@/components/StockPredictionCard";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, addDays } from "date-fns";
import { Brain, TrendingUp, Shield, Sparkles } from "lucide-react";

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
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [lastFormData, setLastFormData] = useState<{ ticker: string; targetDate: Date; newsApiKey?: string } | null>(null);
  const [initialTicker, setInitialTicker] = useState<string>("");

  // Handle ticker from URL params (from Guide page)
  useEffect(() => {
    const tickerParam = searchParams.get("ticker");
    if (tickerParam) {
      setInitialTicker(tickerParam.toUpperCase());
    }
  }, [searchParams]);

  const handleSubmit = async (data: { ticker: string; targetDate: Date; newsApiKey?: string }) => {
    setIsLoading(true);
    setLastFormData(data);
    
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stock-predict`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            ticker: data.ticker,
            targetDate: format(data.targetDate, "yyyy-MM-dd"),
            newsApiKey: data.newsApiKey,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to generate prediction");
      }

      const result: PredictionData = await response.json();
      setPrediction(result);
      
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

  const handleRefresh = useCallback(() => {
    if (lastFormData) {
      handleSubmit(lastFormData);
    }
  }, [lastFormData]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Subtle background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/2 rounded-full blur-[150px]" />
      </div>
      
      <main className="pt-20 pb-12 px-6 relative z-10">
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <h1 className="text-2xl font-medium mb-1">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Enter a stock symbol to analyze
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Form Section */}
            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="lg:col-span-4"
            >
              <div className="sticky top-20">
                <PredictionForm 
                  onSubmit={handleSubmit} 
                  isLoading={isLoading} 
                  onRefresh={handleRefresh}
                  initialTicker={initialTicker}
                />
              </div>
            </motion.div>

            {/* Results Section */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="lg:col-span-8"
            >
              {prediction ? (
                <StockPredictionCard data={prediction} />
              ) : (
                <div className="space-y-6">
                  {/* How it works */}
                  <div className="glass-card p-8">
                    <h3 className="text-lg font-medium mb-6 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-primary" />
                      How StockAI Works
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="space-y-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <TrendingUp className="w-5 h-5 text-primary" />
                        </div>
                        <h4 className="text-sm font-medium">Real Market Data</h4>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          We pull live price data and compute technical indicators like RSI, MACD, EMA, and volatility metrics.
                        </p>
                      </div>
                      <div className="space-y-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Brain className="w-5 h-5 text-primary" />
                        </div>
                        <h4 className="text-sm font-medium">AI Analysis</h4>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Advanced AI models analyze patterns, market regime, and sentiment to generate price predictions with confidence intervals.
                        </p>
                      </div>
                      <div className="space-y-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Shield className="w-5 h-5 text-primary" />
                        </div>
                        <h4 className="text-sm font-medium">Risk Assessment</h4>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Every prediction includes uncertainty ranges, confidence levels, and volatility metrics to help you assess risk.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Disclaimer */}
                  <div className="flex items-start gap-3 p-4 border border-border/30 rounded-lg">
                    <Shield className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      <span className="font-medium text-foreground">Important:</span> StockAI provides AI-generated analysis for informational purposes only. 
                      This is not financial advice. Always conduct your own research and consult with a qualified financial advisor before making investment decisions.
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;