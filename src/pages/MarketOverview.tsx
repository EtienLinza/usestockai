import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { SentimentGauge } from "@/components/market/SentimentGauge";
import { MarketIndicators } from "@/components/market/MarketIndicators";
import { TrendingTickers } from "@/components/market/TrendingTickers";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MarketData {
  fearGreedScore: number;
  sp500Change: number;
  nasdaqChange: number;
  dowChange: number;
  vixValue: number;
  gainers: { ticker: string; name: string; change: number; volume: number }[];
  losers: { ticker: string; name: string; change: number; volume: number }[];
  updatedAt: string;
}

const MarketOverview = () => {
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchMarketData = async (showRefreshToast = false) => {
    if (showRefreshToast) setIsRefreshing(true);
    
    try {
      const { data, error } = await supabase.functions.invoke("market-sentiment");
      
      if (error) throw error;
      
      setMarketData(data);
      if (showRefreshToast) toast.success("Market data refreshed");
    } catch (error) {
      console.error("Failed to fetch market data:", error);
      toast.error("Failed to fetch market data");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchMarketData();
    
    // Refresh every 5 minutes
    const interval = setInterval(() => fetchMarketData(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const getMarketStatus = () => {
    const now = new Date();
    const nyTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hours = nyTime.getHours();
    const minutes = nyTime.getMinutes();
    const day = nyTime.getDay();
    
    if (day === 0 || day === 6) {
      return { status: "Closed", color: "text-muted-foreground" };
    }
    
    const time = hours * 60 + minutes;
    const preMarketStart = 4 * 60;
    const marketOpen = 9 * 60 + 30;
    const marketClose = 16 * 60;
    const afterHoursEnd = 20 * 60;
    
    if (time >= marketOpen && time < marketClose) {
      return { status: "Open", color: "text-success" };
    }
    if (time >= preMarketStart && time < marketOpen) {
      return { status: "Pre-Market", color: "text-warning" };
    }
    if (time >= marketClose && time < afterHoursEnd) {
      return { status: "After Hours", color: "text-warning" };
    }
    return { status: "Closed", color: "text-muted-foreground" };
  };

  const marketStatus = getMarketStatus();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 right-1/4 w-[600px] h-[600px] bg-primary/2 rounded-full blur-[150px]" />
      </div>
      
      <main className="pt-20 pb-12 px-4 sm:px-6 relative z-10">
        <div className="container mx-auto max-w-6xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          >
            <div>
              <h1 className="text-xl sm:text-2xl font-medium mb-1">Market Overview</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Real-time market sentiment and trends
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className={`${marketStatus.color} gap-1`}>
                <Activity className="w-3 h-3" />
                {marketStatus.status}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchMarketData(true)}
                disabled={isRefreshing}
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </motion.div>

          {isLoading ? (
            <div className="space-y-6">
              <div className="grid md:grid-cols-3 gap-6">
                <Skeleton className="h-[280px]" />
                <div className="md:col-span-2 space-y-4">
                  <Skeleton className="h-20" />
                  <Skeleton className="h-20" />
                </div>
              </div>
              <Skeleton className="h-[300px]" />
            </div>
          ) : marketData ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              {/* Top Row: Gauge + Indicators */}
              <div className="grid md:grid-cols-3 gap-6">
                <SentimentGauge score={marketData.fearGreedScore} />
                <div className="md:col-span-2 space-y-4">
                  <MarketIndicators
                    data={{
                      sp500Change: marketData.sp500Change,
                      nasdaqChange: marketData.nasdaqChange,
                      dowChange: marketData.dowChange,
                      vixValue: marketData.vixValue,
                    }}
                  />
                  {/* Last updated */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>Updated: {new Date(marketData.updatedAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>

              {/* Trending Tickers */}
              <TrendingTickers gainers={marketData.gainers} losers={marketData.losers} />
            </motion.div>
          ) : (
            <Card className="glass-card p-12 text-center">
              <p className="text-muted-foreground">Failed to load market data</p>
              <Button
                variant="ghost"
                className="mt-4"
                onClick={() => fetchMarketData()}
              >
                Try Again
              </Button>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
};

export default MarketOverview;