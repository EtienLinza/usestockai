import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PriceAlertModal } from "@/components/PriceAlertModal";
import {
  Heart,
  Search,
  Loader2,
  TrendingUp,
  Trash2,
  Plus,
  ChevronRight,
  Clock,
  Bell,
  BellRing,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface WatchlistItem {
  id: string;
  ticker: string;
  asset_type: string;
  display_name: string | null;
  notes: string | null;
  created_at: string;
}

interface PriceAlert {
  id: string;
  watchlist_item_id: string | null;
  ticker: string;
  target_price: number;
  direction: "above" | "below";
  is_triggered: boolean;
  triggered_at: string | null;
  created_at: string;
}

const Watchlist = () => {
  const navigate = useNavigate();
  const { user, session } = useAuth();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newTicker, setNewTicker] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<WatchlistItem | null>(null);

  useEffect(() => {
    if (!session) {
      navigate("/auth");
      return;
    }
    fetchWatchlist();
    fetchAlerts();
    checkTriggeredAlerts();
  }, [session]);

  const fetchWatchlist = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("watchlist")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      setWatchlist(data || []);
    } catch (error) {
      console.error("Fetch watchlist error:", error);
      toast.error("Failed to load watchlist");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAlerts = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from("price_alerts")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAlerts((data as PriceAlert[]) || []);
    } catch (error) {
      console.error("Fetch alerts error:", error);
    }
  };

  const checkTriggeredAlerts = async () => {
    if (!user) return;

    try {
      // Check for triggered alerts and show notification
      const { data, error } = await supabase
        .from("price_alerts")
        .select("*")
        .eq("user_id", user.id)
        .eq("is_triggered", true)
        .not("triggered_at", "is", null);

      if (error) throw error;

      const recentlyTriggered = (data as PriceAlert[])?.filter((alert) => {
        const triggeredAt = new Date(alert.triggered_at!);
        const now = new Date();
        const hoursSince = (now.getTime() - triggeredAt.getTime()) / (1000 * 60 * 60);
        return hoursSince < 24; // Show alerts triggered in last 24 hours
      });

      if (recentlyTriggered && recentlyTriggered.length > 0) {
        recentlyTriggered.forEach((alert) => {
          toast.success(
            `${alert.ticker} hit your target of $${alert.target_price.toFixed(2)}!`,
            {
              icon: <BellRing className="w-4 h-4 text-primary" />,
              duration: 5000,
            }
          );
        });
      }
    } catch (error) {
      console.error("Check triggered alerts error:", error);
    }
  };

  const addToWatchlist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newTicker.trim()) return;

    const ticker = newTicker.toUpperCase().trim();
    const isCrypto = ticker.includes("-USD");
    
    setIsAdding(true);
    try {
      const { error } = await supabase
        .from("watchlist")
        .insert({
          user_id: user.id,
          ticker,
          asset_type: isCrypto ? "crypto" : "stock",
        });
      
      if (error) {
        if (error.code === "23505") {
          toast.error(`${ticker} is already in your watchlist`);
        } else {
          throw error;
        }
      } else {
        toast.success(`${ticker} added to watchlist`);
        setNewTicker("");
        fetchWatchlist();
      }
    } catch (error) {
      console.error("Add to watchlist error:", error);
      toast.error("Failed to add to watchlist");
    } finally {
      setIsAdding(false);
    }
  };

  const removeFromWatchlist = async (id: string, ticker: string) => {
    try {
      const { error } = await supabase
        .from("watchlist")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
      
      setWatchlist(prev => prev.filter(item => item.id !== id));
      // Also remove associated alerts from local state
      setAlerts(prev => prev.filter(alert => alert.watchlist_item_id !== id));
      toast.success(`${ticker} removed from watchlist`);
    } catch (error) {
      console.error("Remove from watchlist error:", error);
      toast.error("Failed to remove from watchlist");
    }
  };

  const handleSetAlert = (item: WatchlistItem) => {
    setSelectedItem(item);
    setAlertModalOpen(true);
  };

  const createAlert = async (targetPrice: number, direction: "above" | "below") => {
    if (!user || !selectedItem) return;

    try {
      const { error } = await supabase
        .from("price_alerts")
        .insert({
          user_id: user.id,
          watchlist_item_id: selectedItem.id,
          ticker: selectedItem.ticker,
          target_price: targetPrice,
          direction,
        });

      if (error) throw error;

      toast.success(`Alert set for ${selectedItem.ticker} ${direction} $${targetPrice.toFixed(2)}`);
      fetchAlerts();
    } catch (error) {
      console.error("Create alert error:", error);
      toast.error("Failed to create alert");
      throw error;
    }
  };

  const deleteAlert = async (alertId: string, ticker: string) => {
    try {
      const { error } = await supabase
        .from("price_alerts")
        .delete()
        .eq("id", alertId);

      if (error) throw error;

      setAlerts(prev => prev.filter(alert => alert.id !== alertId));
      toast.success(`Alert removed for ${ticker}`);
    } catch (error) {
      console.error("Delete alert error:", error);
      toast.error("Failed to delete alert");
    }
  };

  const getAlertsForItem = (itemId: string) => {
    return alerts.filter(alert => alert.watchlist_item_id === itemId && !alert.is_triggered);
  };

  const handleAnalyze = (ticker: string) => {
    navigate(`/dashboard?ticker=${ticker}`);
  };

  const activeAlertsCount = alerts.filter(a => !a.is_triggered).length;
  const triggeredAlertsCount = alerts.filter(a => a.is_triggered).length;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Subtle background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/4 w-[600px] h-[600px] bg-primary/2 rounded-full blur-[150px]" />
      </div>
      
      <main className="pt-20 pb-12 px-4 sm:px-6 relative z-10">
        <div className="container mx-auto max-w-4xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-medium mb-1">Watchlist</h1>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Save your favorite stocks and crypto for quick access
                </p>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 text-primary" />
                  <span>{watchlist.length} saved</span>
                </div>
                {activeAlertsCount > 0 && (
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-warning" />
                    <span>{activeAlertsCount} alerts</span>
                  </div>
                )}
              </div>
            </div>

            {/* Add Ticker Form */}
            <Card className="glass-card p-4">
              <form onSubmit={addToWatchlist} className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={newTicker}
                    onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
                    placeholder="Enter ticker (e.g., AAPL or BTC-USD)"
                    className="pl-10 font-mono"
                    maxLength={10}
                  />
                </div>
                <Button type="submit" disabled={isAdding || !newTicker.trim()}>
                  {isAdding ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Plus className="w-4 h-4 mr-2" />
                      Add
                    </>
                  )}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground mt-2">
                Use -USD suffix for crypto (e.g., BTC-USD, ETH-USD)
              </p>
            </Card>
          </motion.div>

          {/* Triggered Alerts Section */}
          {triggeredAlertsCount > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
                <BellRing className="w-4 h-4 text-success" />
                Triggered Alerts ({triggeredAlertsCount})
              </h2>
              <div className="grid gap-2">
                {alerts
                  .filter(a => a.is_triggered)
                  .map(alert => (
                    <Card key={alert.id} className="glass-card p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge className="bg-success/20 text-success border-success/30">
                          Triggered
                        </Badge>
                        <span className="font-mono text-sm font-medium text-primary">
                          {alert.ticker}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {alert.direction} ${alert.target_price.toFixed(2)}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteAlert(alert.id, alert.ticker)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </Card>
                  ))}
              </div>
            </motion.div>
          )}

          {/* Watchlist Content */}
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="glass-card p-12 text-center"
              >
                <Loader2 className="w-8 h-8 text-primary mx-auto mb-4 animate-spin" />
                <p className="text-sm text-muted-foreground">Loading watchlist...</p>
              </motion.div>
            ) : watchlist.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="glass-card p-12 text-center"
              >
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Heart className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-sm font-medium mb-2">No items in watchlist</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
                  Add stocks and crypto to your watchlist for quick access to analysis. 
                  Start by entering a ticker symbol above.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="grid gap-3 sm:grid-cols-2"
              >
                {watchlist.map((item, index) => {
                  const itemAlerts = getAlertsForItem(item.id);
                  
                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card 
                        className="glass-card p-4 cursor-pointer transition-all duration-200 hover:border-primary/30 hover:bg-primary/5 group"
                        onClick={() => handleAnalyze(item.ticker)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                              <TrendingUp className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-base font-medium text-primary">
                                  {item.ticker}
                                </span>
                                <Badge variant="outline" className="text-xs">
                                  {item.asset_type === "crypto" ? "Crypto" : "Stock"}
                                </Badge>
                                {itemAlerts.length > 0 && (
                                  <Badge className="bg-warning/20 text-warning border-warning/30 text-xs gap-1">
                                    <Bell className="w-3 h-3" />
                                    {itemAlerts.length}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                <Clock className="w-3 h-3" />
                                <span>Added {new Date(item.created_at).toLocaleDateString()}</span>
                              </div>
                              {/* Show active alerts */}
                              {itemAlerts.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                  {itemAlerts.map(alert => (
                                    <span
                                      key={alert.id}
                                      className="text-xs text-warning flex items-center gap-1"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteAlert(alert.id, alert.ticker);
                                      }}
                                    >
                                      {alert.direction === "above" ? "↑" : "↓"} $
                                      {alert.target_price.toFixed(2)}
                                      <X className="w-3 h-3 hover:text-destructive cursor-pointer" />
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSetAlert(item);
                              }}
                              className="text-muted-foreground hover:text-warning"
                              title="Set price alert"
                            >
                              <Bell className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromWatchlist(item.id, item.ticker);
                              }}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Price Alert Modal */}
      <PriceAlertModal
        isOpen={alertModalOpen}
        onClose={() => {
          setAlertModalOpen(false);
          setSelectedItem(null);
        }}
        onSubmit={createAlert}
        ticker={selectedItem?.ticker || ""}
      />
    </div>
  );
};

export default Watchlist;
