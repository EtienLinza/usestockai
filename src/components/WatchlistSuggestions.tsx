import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Plus, ChevronRight, TrendingUp, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Suggestion {
  ticker: string;
  reason: string;
  sector: string;
}

interface WatchlistSuggestionsProps {
  userWatchlist: string[];
  onAddToWatchlist: (ticker: string) => void;
}

export function WatchlistSuggestions({ userWatchlist, onAddToWatchlist }: WatchlistSuggestionsProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const generateSuggestions = async () => {
    if (userWatchlist.length === 0) {
      setSuggestions([]);
      return;
    }

    setIsLoading(true);
    try {
      // Simple sector-based suggestions based on watchlist patterns
      const sectorMap: Record<string, string[]> = {
        tech: ["AAPL", "MSFT", "GOOGL", "NVDA", "META", "AMZN", "AMD", "CRM", "ADBE", "INTC"],
        finance: ["JPM", "BAC", "GS", "MS", "V", "MA", "BLK", "C", "WFC", "AXP"],
        healthcare: ["JNJ", "UNH", "PFE", "MRK", "ABBV", "LLY", "TMO", "ABT", "BMY", "AMGN"],
        energy: ["XOM", "CVX", "COP", "SLB", "EOG", "OXY", "PSX", "MPC", "VLO", "HAL"],
        consumer: ["COST", "WMT", "HD", "MCD", "NKE", "SBUX", "TGT", "LOW", "TJX", "CMG"],
        crypto: ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "ADA-USD", "AVAX-USD"],
      };

      // Detect user's preferred sectors
      const userSectors: Record<string, number> = {};
      for (const ticker of userWatchlist) {
        for (const [sector, tickers] of Object.entries(sectorMap)) {
          if (tickers.includes(ticker)) {
            userSectors[sector] = (userSectors[sector] || 0) + 1;
          }
        }
      }

      // Get top 2 sectors
      const topSectors = Object.entries(userSectors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([sector]) => sector);

      // If no clear pattern, use tech and finance
      if (topSectors.length === 0) {
        topSectors.push("tech", "finance");
      }

      // Generate suggestions from those sectors, excluding already owned
      const newSuggestions: Suggestion[] = [];
      for (const sector of topSectors) {
        const candidates = sectorMap[sector]?.filter(t => !userWatchlist.includes(t)) || [];
        for (const ticker of candidates.slice(0, 2)) {
          newSuggestions.push({
            ticker,
            reason: `Popular in ${sector} sector, similar to your watchlist`,
            sector: sector.charAt(0).toUpperCase() + sector.slice(1),
          });
        }
      }

      setSuggestions(newSuggestions.slice(0, 4));
    } catch (error) {
      console.error("Error generating suggestions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    generateSuggestions();
  }, [userWatchlist.length]);

  if (userWatchlist.length === 0) {
    return null;
  }

  return (
    <Card className="glass-card overflow-hidden">
      <div 
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-primary/5 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Suggested for You</span>
        </div>
        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${!isCollapsed ? "rotate-90" : ""}`} />
      </div>

      {!isCollapsed && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="px-4 pb-4"
        >
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-lg" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-16 mb-1" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              ))}
            </div>
          ) : suggestions.length > 0 ? (
            <>
              <div className="space-y-3">
                {suggestions.map((suggestion, index) => (
                  <motion.div
                    key={suggestion.ticker}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <TrendingUp className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium text-primary">
                            {suggestion.ticker}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {suggestion.sector}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {suggestion.reason}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddToWatchlist(suggestion.ticker);
                        }}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/dashboard?ticker=${suggestion.ticker}`);
                        }}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-3 text-xs text-muted-foreground"
                onClick={generateSuggestions}
              >
                <RefreshCw className="w-3 h-3 mr-2" />
                Refresh suggestions
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">
              Add more stocks to your watchlist to get personalized suggestions
            </p>
          )}
        </motion.div>
      )}
    </Card>
  );
}