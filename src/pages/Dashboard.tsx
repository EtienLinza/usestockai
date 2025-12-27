import { useState } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { PredictionForm } from "@/components/PredictionForm";
import { PredictionResult, PredictionData } from "@/components/PredictionResult";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format, subDays } from "date-fns";

// Simulated prediction function (in production, this would call a Python backend)
const generatePrediction = (ticker: string, targetDate: Date): PredictionData => {
  // Generate realistic mock historical data
  const historicalData = [];
  const basePrice = 150 + Math.random() * 100;
  let currentPrice = basePrice;
  
  for (let i = 30; i >= 0; i--) {
    const date = subDays(new Date(), i);
    const change = (Math.random() - 0.48) * 5; // Slight upward bias
    currentPrice = Math.max(currentPrice + change, basePrice * 0.7);
    historicalData.push({
      date: format(date, "yyyy-MM-dd"),
      price: parseFloat(currentPrice.toFixed(2)),
    });
  }

  const lastPrice = historicalData[historicalData.length - 1].price;
  
  // Generate prediction with some variance
  const trend = (Math.random() - 0.4) * 0.1; // Slight bullish bias
  const predictedPrice = lastPrice * (1 + trend);
  const volatility = 0.03 + Math.random() * 0.04;
  
  // Regime detection simulation
  const regimes = ["bullish", "bearish", "neutral", "volatile"];
  const regime = regimes[Math.floor(Math.random() * regimes.length)];
  
  // Feature importance simulation
  const features = [
    { name: "EMA Crossover", importance: 0.15 + Math.random() * 0.1 },
    { name: "RSI Divergence", importance: 0.12 + Math.random() * 0.08 },
    { name: "MACD Signal", importance: 0.1 + Math.random() * 0.1 },
    { name: "Volume Trend", importance: 0.08 + Math.random() * 0.08 },
    { name: "Volatility Index", importance: 0.06 + Math.random() * 0.06 },
    { name: "News Sentiment", importance: 0.04 + Math.random() * 0.04 },
  ].sort((a, b) => b.importance - a.importance);

  // Normalize importance
  const totalImportance = features.reduce((sum, f) => sum + f.importance, 0);
  features.forEach(f => f.importance = f.importance / totalImportance);

  return {
    ticker,
    targetDate: format(targetDate, "yyyy-MM-dd"),
    currentPrice: lastPrice,
    predictedPrice: parseFloat(predictedPrice.toFixed(2)),
    uncertaintyLow: parseFloat((predictedPrice * (1 - volatility)).toFixed(2)),
    uncertaintyHigh: parseFloat((predictedPrice * (1 + volatility)).toFixed(2)),
    confidence: 55 + Math.random() * 35,
    regime,
    sentimentScore: (Math.random() - 0.5) * 2,
    featureImportance: features,
    historicalData,
  };
};

const Dashboard = () => {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [prediction, setPrediction] = useState<PredictionData | null>(null);

  const handleSubmit = async (data: { ticker: string; targetDate: Date; newsApiKey?: string }) => {
    setIsLoading(true);
    
    try {
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const result = generatePrediction(data.ticker, data.targetDate);
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
      toast.error("Failed to generate prediction");
    } finally {
      setIsLoading(false);
    }
  };

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
                <PredictionForm onSubmit={handleSubmit} isLoading={isLoading} />
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
