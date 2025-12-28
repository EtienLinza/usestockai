import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { PredictionForm } from "@/components/PredictionForm";
import { PredictionResult, PredictionData } from "@/components/PredictionResult";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

const Dashboard = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [lastFormData, setLastFormData] = useState<{ ticker: string; targetDate: Date; newsApiKey?: string } | null>(null);

  const handleSubmit = async (data: { ticker: string; targetDate: Date; newsApiKey?: string }) => {
    setIsLoading(true);
    setLastFormData(data);
    
    try {
      // Call the real edge function
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
      
      // Save to database if user is logged in
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
        } else {
          toast.success("Prediction saved to history");
        }
      }
      
      toast.success(`Prediction generated for ${data.ticker}`);
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
    } else {
      toast.info("Enter a ticker and date first to refresh data");
    }
  }, [lastFormData]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Background effects */}
      <div className="fixed inset-0 bg-gradient-hero pointer-events-none" />
      
      <main className="pt-24 pb-12 px-4 relative z-10">
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <h1 className="text-3xl font-bold mb-2">
              Stock Prediction <span className="text-gradient">Dashboard</span>
            </h1>
            <p className="text-muted-foreground">
              Enter a ticker symbol and target date to generate AI-powered predictions
              {!user && " — sign in to save your prediction history"}
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Form Section */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="lg:col-span-5"
            >
              <div className="sticky top-24">
                <PredictionForm 
                  onSubmit={handleSubmit} 
                  isLoading={isLoading} 
                  onRefresh={handleRefresh}
                />
              </div>
            </motion.div>

            {/* Results Section */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="lg:col-span-7"
            >
              {prediction ? (
                <PredictionResult data={prediction} />
              ) : (
                <div className="glass-card p-12 text-center">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <svg
                      className="w-8 h-8 text-primary"
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
                  <h3 className="text-lg font-semibold mb-2">No Prediction Yet</h3>
                  <p className="text-muted-foreground text-sm max-w-xs mx-auto">
                    Enter a stock ticker and target date on the left to generate 
                    your first AI-powered prediction.
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