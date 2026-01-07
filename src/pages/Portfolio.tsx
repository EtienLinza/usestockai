import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { PortfolioSummary } from "@/components/portfolio/PortfolioSummary";
import { HoldingsTable, Holding } from "@/components/portfolio/HoldingsTable";
import { AddHoldingModal } from "@/components/portfolio/AddHoldingModal";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Wallet, TrendingUp } from "lucide-react";

const Portfolio = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch holdings from database
  const fetchHoldings = useCallback(async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("portfolio_holdings")
        .select("*")
        .eq("user_id", user.id);

      if (error) throw error;

      // Transform and set holdings with placeholder prices
      const holdingsData: Holding[] = (data || []).map((h) => ({
        id: h.id,
        ticker: h.ticker,
        shares: Number(h.shares),
        averageCost: Number(h.average_cost),
        currentPrice: Number(h.average_cost), // Placeholder until refresh
        previousClose: undefined,
      }));

      setHoldings(holdingsData);
    } catch (error) {
      console.error("Error fetching holdings:", error);
      toast.error("Failed to load portfolio");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Fetch current prices for all holdings
  const refreshPrices = useCallback(async () => {
    if (holdings.length === 0) return;

    setIsRefreshing(true);
    try {
      const updatedHoldings = await Promise.all(
        holdings.map(async (holding) => {
          try {
            const { data, error } = await supabase.functions.invoke("fetch-stock-price", {
              body: { ticker: holding.ticker },
            });

            if (error || !data) {
              console.error(`Failed to fetch price for ${holding.ticker}`);
              return holding;
            }

            return {
              ...holding,
              currentPrice: data.latestPrice || holding.averageCost,
              previousClose: data.priceHistory?.[data.priceHistory.length - 2]?.price,
            };
          } catch {
            return holding;
          }
        })
      );

      setHoldings(updatedHoldings);
      toast.success("Prices updated");
    } catch (error) {
      toast.error("Failed to refresh prices");
    } finally {
      setIsRefreshing(false);
    }
  }, [holdings]);

  // Add new holding
  const addHolding = async (newHolding: { ticker: string; shares: number; averageCost: number }) => {
    if (!user) return;

    // Check if holding already exists
    const existing = holdings.find((h) => h.ticker === newHolding.ticker);
    if (existing) {
      // Update existing holding with new average
      const totalShares = existing.shares + newHolding.shares;
      const totalCost = existing.shares * existing.averageCost + newHolding.shares * newHolding.averageCost;
      const newAverage = totalCost / totalShares;

      const { error } = await supabase
        .from("portfolio_holdings")
        .update({
          shares: totalShares,
          average_cost: newAverage,
        })
        .eq("id", existing.id);

      if (error) throw error;
    } else {
      // Insert new holding
      const { error } = await supabase.from("portfolio_holdings").insert({
        user_id: user.id,
        ticker: newHolding.ticker,
        shares: newHolding.shares,
        average_cost: newHolding.averageCost,
      });

      if (error) throw error;
    }

    await fetchHoldings();
    await refreshPrices();
  };

  // Delete holding
  const deleteHolding = async (id: string) => {
    const { error } = await supabase.from("portfolio_holdings").delete().eq("id", id);

    if (error) {
      toast.error("Failed to delete holding");
      return;
    }

    setHoldings((prev) => prev.filter((h) => h.id !== id));
    toast.success("Holding removed");
  };

  // Redirect if not authenticated
  useEffect(() => {
    if (!user && !isLoading) {
      navigate("/auth");
    }
  }, [user, isLoading, navigate]);

  // Initial fetch
  useEffect(() => {
    fetchHoldings();
  }, [fetchHoldings]);

  // Refresh prices on initial load
  useEffect(() => {
    if (holdings.length > 0 && !isRefreshing) {
      refreshPrices();
    }
  }, [holdings.length]); // Only trigger once when holdings are loaded

  // Calculate summary stats
  const totalValue = holdings.reduce((sum, h) => sum + h.shares * h.currentPrice, 0);
  const totalCost = holdings.reduce((sum, h) => sum + h.shares * h.averageCost, 0);
  const dayChange = holdings.reduce((sum, h) => {
    const prevClose = h.previousClose || h.currentPrice;
    return sum + h.shares * (h.currentPrice - prevClose);
  }, 0);
  const dayChangePercent = totalValue > 0 ? (dayChange / (totalValue - dayChange)) * 100 : 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/2 rounded-full blur-[150px]" />
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
              <h1 className="text-xl sm:text-2xl font-medium flex items-center gap-2">
                <Wallet className="w-6 h-6 text-primary" />
                Portfolio
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                Track your holdings and performance
              </p>
            </div>
            <AddHoldingModal onAdd={addHolding} />
          </motion.div>

          {/* Summary */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <PortfolioSummary
              totalValue={totalValue}
              totalCost={totalCost}
              dayChange={dayChange}
              dayChangePercent={dayChangePercent}
            />
          </motion.div>

          {/* Holdings Table */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <HoldingsTable
              holdings={holdings}
              isLoading={isRefreshing}
              onDelete={deleteHolding}
              onRefresh={refreshPrices}
            />
          </motion.div>

          {/* Empty State */}
          {holdings.length === 0 && !isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-center py-12"
            >
              <TrendingUp className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
              <h3 className="text-lg font-medium mb-2">Start Building Your Portfolio</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Add your first holding to track your investments
              </p>
              <AddHoldingModal onAdd={addHolding} />
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Portfolio;
