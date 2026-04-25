import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, RefreshCw, Clock, LayoutGrid, Grid3X3 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SentimentGauge } from "@/components/market/SentimentGauge";
import { MarketIndicators } from "@/components/market/MarketIndicators";
import { TrendingTickers } from "@/components/market/TrendingTickers";
import { SectorCard } from "@/components/sectors/SectorCard";
import { SectorHeatmap } from "@/components/sectors/SectorHeatmap";
import { getMarketStatus as getNyseStatus } from "@/lib/market-hours";

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

interface SectorData {
  sector: string;
  etfTicker: string;
  dailyChange: number;
  weeklyChange: number;
  monthlyChange: number;
}

function getMarketStatus() {
  const s = getNyseStatus();
  if (s.state === "open") return { status: "Open", color: "text-success" };
  if (s.state === "early-close") return { status: "Early Close", color: "text-warning" };
  if (s.state === "closed-pre-market") return { status: "Pre-Market", color: "text-warning" };
  if (s.state === "closed-after-hours") return { status: "After Hours", color: "text-warning" };
  if (s.state === "closed-holiday") return { status: "Holiday", color: "text-muted-foreground" };
  return { status: "Closed", color: "text-muted-foreground" };
}

export function MarketTab() {
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [viewMode, setViewMode] = useState<"market" | "sectors">("market");
  const [sortBy, setSortBy] = useState<"name" | "daily" | "weekly" | "monthly">("daily");
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

  const fetchSectorData = async (showToast = false) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("sector-analysis");
      if (error) throw error;
      setSectors(data.sectors || []);
      setFetched(true);
      if (showToast) toast.success("Sector data refreshed");
    } catch (error) {
      console.error("Failed to fetch sector data:", error);
      toast.error("Failed to fetch sector data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!fetched && !isLoading) {
      if (viewMode === "market") {
        fetchMarketData();
      } else {
        fetchSectorData();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`${marketStatus.color} gap-1`}>
            <Activity className="w-3 h-3" />{marketStatus.status}
          </Badge>
          <div className="flex items-center gap-1 p-1 bg-secondary/50 rounded-lg">
            <Button variant="ghost" size="sm" onClick={() => setViewMode("market")} className={`h-7 px-2 text-xs ${viewMode === "market" ? "bg-background shadow-sm" : ""}`}>
              Market
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setViewMode("sectors"); setFetched(false); }} className={`h-7 px-2 text-xs ${viewMode === "sectors" ? "bg-background shadow-sm" : ""}`}>
              Sectors
            </Button>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => viewMode === "market" ? fetchMarketData(true) : fetchSectorData(true)} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {viewMode === "market" ? (
        <>
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
        </>
      ) : (
        <>
          {!isLoading && sectors.length > 0 && (
            <div className="mb-4">
              <Tabs value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <TabsList className="bg-secondary/30">
                  <TabsTrigger value="daily" className="text-xs">Daily</TabsTrigger>
                  <TabsTrigger value="weekly" className="text-xs">Weekly</TabsTrigger>
                  <TabsTrigger value="monthly" className="text-xs">Monthly</TabsTrigger>
                  <TabsTrigger value="name" className="text-xs">A-Z</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          )}

          {isLoading && sectors.length === 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 11 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
            </div>
          ) : sectors.length > 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {[...sectors].sort((a, b) => {
                  switch (sortBy) {
                    case "name": return a.sector.localeCompare(b.sector);
                    case "daily": return b.dailyChange - a.dailyChange;
                    case "weekly": return b.weeklyChange - a.weeklyChange;
                    case "monthly": return b.monthlyChange - a.monthlyChange;
                    default: return 0;
                  }
                }).map((sector, index) => (
                  <motion.div key={sector.etfTicker} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
                    <SectorCard {...sector} />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ) : (
            <Card className="glass-card p-12 text-center">
              <p className="text-muted-foreground">No sector data available</p>
              <Button variant="ghost" className="mt-4" onClick={() => fetchSectorData()}>Try Again</Button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
