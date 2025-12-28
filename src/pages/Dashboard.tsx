import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { PredictionForm } from "@/components/PredictionForm";
import { StockPredictionCard } from "@/components/StockPredictionCard";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

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
  const [isLoading, setIsLoading] = useState(false);
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [lastFormData, setLastFormData] = useState<{ ticker: string; targetDate: Date; newsApiKey?: string } | null>(null);

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
                <div className="glass-card p-16 text-center">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-6 h-6 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                      />
                    </svg>
                  </div>
                  <h3 className="text-sm font-medium mb-2">No Analysis Yet</h3>
                  <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                    Enter a stock ticker to generate AI-powered predictions.
                  </p>
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