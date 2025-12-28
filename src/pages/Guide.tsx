import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface StockOpportunity {
  ticker: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;
  explanation: string;
  strength: number;
}

const Guide = () => {
  const [opportunities, setOpportunities] = useState<StockOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [noOpportunities, setNoOpportunities] = useState(false);

  const fetchOpportunities = async () => {
    setIsLoading(true);
    setNoOpportunities(false);
    
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
            mode: "guide",
          }),
        }
      );

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
    fetchOpportunities();
  }, []);

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

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Subtle background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-primary/2 rounded-full blur-[150px]" />
      </div>
      
      <main className="pt-20 pb-12 px-6 relative z-10">
        <div className="container mx-auto max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex items-center justify-between mb-2">
              <h1 className="text-2xl font-medium">Guide</h1>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchOpportunities}
                disabled={isLoading}
                className="gap-2 text-muted-foreground"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Refresh
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              AI-identified opportunities based on current market conditions
            </p>
            {lastUpdated && (
              <p className="text-xs text-muted-foreground mt-1">
                Last updated: {lastUpdated.toLocaleTimeString()}
              </p>
            )}
          </motion.div>

          {isLoading && opportunities.length === 0 ? (
            <div className="glass-card p-16 text-center">
              <Loader2 className="w-8 h-8 text-primary mx-auto mb-4 animate-spin" />
              <p className="text-sm text-muted-foreground">Analyzing market conditions...</p>
            </div>
          ) : noOpportunities ? (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-card p-16 text-center"
            >
              <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6 text-warning" />
              </div>
              <h3 className="text-sm font-medium mb-2">No Strong Opportunities</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                Market conditions are not favorable for high-confidence predictions right now. 
                Check back later or analyze specific stocks on the Dashboard.
              </p>
            </motion.div>
          ) : (
            <div className="space-y-4">
              {opportunities.map((opp, index) => (
                <motion.div
                  key={opp.ticker}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <Card className="glass-card p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <span className="font-mono text-lg font-medium text-primary">
                            {opp.ticker}
                          </span>
                          <Badge 
                            variant="outline" 
                            className={`${getDirectionColor(opp.direction)} border gap-1`}
                          >
                            {getDirectionIcon(opp.direction)}
                            {opp.direction.charAt(0).toUpperCase() + opp.direction.slice(1)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {opp.explanation}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-mono font-medium text-foreground">
                          {opp.confidence}%
                        </div>
                        <div className="text-xs text-muted-foreground">confidence</div>
                        {/* Strength indicator */}
                        <div className="flex gap-1 mt-2 justify-end">
                          {[1, 2, 3, 4, 5].map((level) => (
                            <div
                              key={level}
                              className={`w-1.5 h-4 rounded-sm ${
                                level <= opp.strength
                                  ? opp.direction === "bullish"
                                    ? "bg-success"
                                    : opp.direction === "bearish"
                                    ? "bg-destructive"
                                    : "bg-warning"
                                  : "bg-muted"
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              ))}
            </div>
          )}

          {/* Disclaimer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-8 p-4 border border-border/30 rounded-lg"
          >
            <p className="text-xs text-muted-foreground text-center">
              This is AI-generated analysis for informational purposes only. 
              Not financial advice. Always do your own research.
            </p>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default Guide;