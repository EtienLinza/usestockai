import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { 
  History as HistoryIcon, 
  TrendingUp, 
  TrendingDown,
  Calendar,
  ArrowRight,
  Loader2,
  Lock
} from "lucide-react";

interface PredictionRun {
  id: string;
  ticker: string;
  target_date: string;
  predicted_price: number;
  current_price: number;
  confidence: number;
  regime: string;
  created_at: string;
}

const History = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [predictions, setPredictions] = useState<PredictionRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && user) {
      fetchPredictions();
    } else if (!authLoading && !user) {
      setIsLoading(false);
    }
  }, [user, authLoading]);

  const fetchPredictions = async () => {
    try {
      const { data, error } = await supabase
        .from("prediction_runs")
        .select("id, ticker, target_date, predicted_price, current_price, confidence, regime, created_at")
        .eq("user_id", user?.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setPredictions(data || []);
    } catch (error) {
      console.error("Failed to fetch predictions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const getRegimeBadge = (regime: string) => {
    const variants: Record<string, string> = {
      bullish: "bg-success/20 text-success border-success/30",
      bearish: "bg-destructive/20 text-destructive border-destructive/30",
      neutral: "bg-warning/20 text-warning border-warning/30",
      volatile: "bg-chart-4/20 text-chart-4 border-chart-4/30",
    };
    return variants[regime?.toLowerCase()] || variants.neutral;
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="fixed inset-0 bg-gradient-hero pointer-events-none" />
        
        <main className="pt-24 pb-12 px-4 relative z-10">
          <div className="container mx-auto max-w-2xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-12 text-center"
            >
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Lock className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-bold mb-4">Sign In Required</h2>
              <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                Create an account or sign in to view and save your prediction history.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button variant="glow" onClick={() => navigate("/auth?mode=signup")}>
                  Create Account
                </Button>
                <Button variant="outline" onClick={() => navigate("/auth")}>
                  Sign In
                </Button>
              </div>
            </motion.div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="fixed inset-0 bg-gradient-hero pointer-events-none" />
      
      <main className="pt-24 pb-12 px-4 relative z-10">
        <div className="container mx-auto max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
              <HistoryIcon className="w-8 h-8 text-primary" />
              Prediction <span className="text-gradient">History</span>
            </h1>
            <p className="text-muted-foreground">
              View all your past stock predictions and their results
            </p>
          </motion.div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : predictions.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-12 text-center"
            >
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <HistoryIcon className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No Predictions Yet</h3>
              <p className="text-muted-foreground text-sm max-w-xs mx-auto mb-6">
                You haven't made any predictions yet. Head to the dashboard to generate your first one.
              </p>
              <Button variant="glow" onClick={() => navigate("/dashboard")}>
                Go to Dashboard
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              {predictions.map((prediction, index) => {
                const priceChange = prediction.predicted_price - prediction.current_price;
                const isPositive = priceChange >= 0;

                return (
                  <motion.div
                    key={prediction.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Card variant="glass" className="hover:-translate-y-1 transition-transform cursor-pointer">
                      <CardContent className="p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                              isPositive ? "bg-success/20" : "bg-destructive/20"
                            }`}>
                              {isPositive ? (
                                <TrendingUp className="w-6 h-6 text-success" />
                              ) : (
                                <TrendingDown className="w-6 h-6 text-destructive" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xl font-bold font-mono">{prediction.ticker}</span>
                                <Badge variant="outline" className={getRegimeBadge(prediction.regime)}>
                                  {prediction.regime}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Calendar className="w-3 h-3" />
                                <span>Target: {format(new Date(prediction.target_date), "MMM d, yyyy")}</span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <div className="text-sm text-muted-foreground">Predicted</div>
                              <div className="text-lg font-bold font-mono">
                                ${prediction.predicted_price.toFixed(2)}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm text-muted-foreground">Confidence</div>
                              <div className={`text-lg font-bold font-mono ${
                                prediction.confidence >= 70 ? "text-success" : 
                                prediction.confidence >= 50 ? "text-warning" : "text-destructive"
                              }`}>
                                {prediction.confidence.toFixed(0)}%
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                          <span>Created: {format(new Date(prediction.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
                          <span className={isPositive ? "text-success" : "text-destructive"}>
                            {isPositive ? "+" : ""}{((priceChange / prediction.current_price) * 100).toFixed(2)}% from current
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
};

export default History;
