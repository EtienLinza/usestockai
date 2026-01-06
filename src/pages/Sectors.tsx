import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { SectorCard } from "@/components/sectors/SectorCard";
import { SectorHeatmap } from "@/components/sectors/SectorHeatmap";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LayoutGrid, Grid3X3, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SectorData {
  sector: string;
  etfTicker: string;
  dailyChange: number;
  weeklyChange: number;
  monthlyChange: number;
}

const Sectors = () => {
  const [sectors, setSectors] = useState<SectorData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<"cards" | "heatmap">("cards");
  const [sortBy, setSortBy] = useState<"name" | "daily" | "weekly" | "monthly">("daily");

  const fetchSectorData = async (showRefreshToast = false) => {
    if (showRefreshToast) setIsRefreshing(true);
    
    try {
      const { data, error } = await supabase.functions.invoke("sector-analysis");
      
      if (error) throw error;
      
      setSectors(data.sectors || []);
      if (showRefreshToast) toast.success("Sector data refreshed");
    } catch (error) {
      console.error("Failed to fetch sector data:", error);
      toast.error("Failed to fetch sector data");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSectorData();
  }, []);

  const sortedSectors = [...sectors].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.sector.localeCompare(b.sector);
      case "daily":
        return b.dailyChange - a.dailyChange;
      case "weekly":
        return b.weeklyChange - a.weeklyChange;
      case "monthly":
        return b.monthlyChange - a.monthlyChange;
      default:
        return 0;
    }
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute bottom-1/4 left-1/3 w-[600px] h-[600px] bg-primary/2 rounded-full blur-[150px]" />
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
              <h1 className="text-xl sm:text-2xl font-medium mb-1">Sector Analysis</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Performance across market sectors
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* View mode toggle */}
              <div className="flex items-center gap-1 p-1 bg-secondary/50 rounded-lg">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setViewMode("cards")}
                  className={`h-7 px-2 text-xs ${viewMode === "cards" ? "bg-background shadow-sm" : ""}`}
                >
                  <LayoutGrid className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setViewMode("heatmap")}
                  className={`h-7 px-2 text-xs ${viewMode === "heatmap" ? "bg-background shadow-sm" : ""}`}
                >
                  <Grid3X3 className="w-3 h-3" />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchSectorData(true)}
                disabled={isRefreshing}
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </motion.div>

          {/* Sort tabs (cards view only) */}
          {viewMode === "cards" && !isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mb-6"
            >
              <Tabs value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <TabsList className="bg-secondary/30">
                  <TabsTrigger value="daily" className="text-xs">Daily</TabsTrigger>
                  <TabsTrigger value="weekly" className="text-xs">Weekly</TabsTrigger>
                  <TabsTrigger value="monthly" className="text-xs">Monthly</TabsTrigger>
                  <TabsTrigger value="name" className="text-xs">A-Z</TabsTrigger>
                </TabsList>
              </Tabs>
            </motion.div>
          )}

          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 11 }).map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : sectors.length > 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {viewMode === "cards" ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {sortedSectors.map((sector, index) => (
                    <motion.div
                      key={sector.etfTicker}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                    >
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
              <Button
                variant="ghost"
                className="mt-4"
                onClick={() => fetchSectorData()}
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

export default Sectors;