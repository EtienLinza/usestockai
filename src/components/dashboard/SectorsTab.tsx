import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, LayoutGrid, Grid3X3 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SectorCard } from "@/components/sectors/SectorCard";
import { SectorHeatmap } from "@/components/sectors/SectorHeatmap";

interface SectorData {
  sector: string;
  etfTicker: string;
  dailyChange: number;
  weeklyChange: number;
  monthlyChange: number;
}

export function SectorsTab() {
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [viewMode, setViewMode] = useState<"cards" | "heatmap">("cards");
  const [sortBy, setSortBy] = useState<"name" | "daily" | "weekly" | "monthly">("daily");

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
    if (!fetched && !isLoading) fetchSectorData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedSectors = [...sectors].sort((a, b) => {
    switch (sortBy) {
      case "name": return a.sector.localeCompare(b.sector);
      case "daily": return b.dailyChange - a.dailyChange;
      case "weekly": return b.weeklyChange - a.weeklyChange;
      case "monthly": return b.monthlyChange - a.monthlyChange;
      default: return 0;
    }
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-secondary/50 rounded-lg">
            <Button variant="ghost" size="sm" onClick={() => setViewMode("cards")} className={`h-7 px-2 text-xs ${viewMode === "cards" ? "bg-background shadow-sm" : ""}`}><LayoutGrid className="w-3 h-3" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setViewMode("heatmap")} className={`h-7 px-2 text-xs ${viewMode === "heatmap" ? "bg-background shadow-sm" : ""}`}><Grid3X3 className="w-3 h-3" /></Button>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => fetchSectorData(true)} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {viewMode === "cards" && !isLoading && sectors.length > 0 && (
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
          {viewMode === "cards" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {sortedSectors.map((sector, index) => (
                <motion.div key={sector.etfTicker} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
                  <SectorCard {...sector} />
                </motion.div>
              ))}
            </div>
          ) : (
            <SectorHeatmap sectors={sectors} />
          )}
        </motion.div>
      ) : (
        <Card className="glass-card p-12 text-center">
          <p className="text-muted-foreground">No sector data available</p>
          <Button variant="ghost" className="mt-4" onClick={() => fetchSectorData()}>Try Again</Button>
        </Card>
      )}
    </div>
  );
}
