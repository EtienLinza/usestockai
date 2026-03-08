import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, RefreshCw, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SentimentGauge } from "@/components/market/SentimentGauge";
import { MarketIndicators } from "@/components/market/MarketIndicators";
import { TrendingTickers } from "@/components/market/TrendingTickers";

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

function getMarketStatus() {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hours = nyTime.getHours();
  const minutes = nyTime.getMinutes();
  const day = nyTime.getDay();
  if (day === 0 || day === 6) return { status: "Closed", color: "text-muted-foreground" };
  const time = hours * 60 + minutes;
  if (time >= 570 && time < 960) return { status: "Open", color: "text-success" };
  if (time >= 240 && time < 570) return { status: "Pre-Market", color: "text-warning" };
  if (time >= 960 && time < 1200) return { status: "After Hours", color: "text-warning" };
  return { status: "Closed", color: "text-muted-foreground" };
}

export function MarketTab() {
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const marketStatus = getMarketStatus();

  const fetchMarketData = async (showToast = false) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("market-sentiment");
      if (error) throw error;
      setMarketData(data);
      setFetched(true);
      if (showToast) toast.success("Market data refreshed");
    } catch (error) {
      console.error("Failed to fetch market data:", error);
      toast.error("Failed to fetch market data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!fetched && !isLoading) fetchMarketData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Badge variant="outline" className={`${marketStatus.color} gap-1`}>
          <Activity className="w-3 h-3" />{marketStatus.status}
        </Badge>
        <Button variant="ghost" size="sm" onClick={() => fetchMarketData(true)} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {isLoading && !marketData ? (
        <div className="space-y-6">
          <div className="grid md:grid-cols-3 gap-6">
            <Skeleton className="h-[280px]" />
            <div className="md:col-span-2 space-y-4"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
          </div>
          <Skeleton className="h-[300px]" />
        </div>
      ) : marketData ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          <div className="grid md:grid-cols-3 gap-6">
            <SentimentGauge score={marketData.fearGreedScore} />
            <div className="md:col-span-2 space-y-4">
              <MarketIndicators data={{ sp500Change: marketData.sp500Change, nasdaqChange: marketData.nasdaqChange, dowChange: marketData.dowChange, vixValue: marketData.vixValue }} />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" /><span>Updated: {new Date(marketData.updatedAt).toLocaleTimeString()}</span>
              </div>
            </div>
          </div>
          <TrendingTickers gainers={marketData.gainers} losers={marketData.losers} />
        </motion.div>
      ) : (
        <Card className="glass-card p-12 text-center">
          <p className="text-muted-foreground">Failed to load market data</p>
          <Button variant="ghost" className="mt-4" onClick={() => fetchMarketData()}>Try Again</Button>
        </Card>
      )}
    </div>
  );
}
