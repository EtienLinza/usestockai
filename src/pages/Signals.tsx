import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2, TrendingUp, TrendingDown, AlertTriangle,
  RefreshCw, Zap, DollarSign, Target, ArrowUpRight, ArrowDownRight,
  Package, BarChart3, Clock, CheckCircle2, Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface Signal {
  id: string;
  ticker: string;
  signal_type: "BUY" | "SELL";
  entry_price: number;
  confidence: number;
  regime: string;
  stock_profile: string;
  weekly_bias: string;
  target_allocation: number;
  reasoning: string;
  strategy: string;
  created_at: string;
  expires_at: string;
  sector?: string;
}

interface Position {
  id: string;
  ticker: string;
  entry_price: number;
  shares: number;
  position_type: "long" | "short";
  status: "open" | "closed";
  exit_price: number | null;
  pnl: number | null;
  created_at: string;
  closed_at: string | null;
  exit_reason: string | null;
}

interface SellAlert {
  ticker: string;
  reason: string;
  currentPrice: number;
}

interface PortfolioSnapshot {
  date: string;
  total_value: number;
  cash: number;
  positions_value: number;
}

const Signals = () => {
  const { user } = useAuth();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ batch: 0, total: 0 });
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [shareAmount, setShareAmount] = useState("");
  const [sellDialogOpen, setSellDialogOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [sellPrice, setSellPrice] = useState("");
  const [activeTab, setActiveTab] = useState("signals");

  // Live P&L state
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  // Sell alerts state
  const [sellAlerts, setSellAlerts] = useState<SellAlert[]>([]);

  // Portfolio snapshots
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([]);

  // Last scan time
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: signalData } = await supabase
        .from("live_signals")
        .select("*")
        .gte("expires_at", new Date().toISOString())
        .order("confidence", { ascending: false });

      if (signalData) {
        setSignals(signalData as Signal[]);
        // Use latest signal's created_at as proxy for last scan time
        if (signalData.length > 0) {
          setLastScanTime(signalData[0].created_at);
        }
      }

      if (user) {
        const { data: posData } = await supabase
          .from("virtual_positions")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (posData) setPositions(posData as Position[]);

        // Load portfolio history
        const { data: histData } = await supabase
          .from("virtual_portfolio_log")
          .select("*")
          .eq("user_id", user.id)
          .order("date", { ascending: true });

        if (histData) setPortfolioHistory(histData as PortfolioSnapshot[]);
      }
    } catch (err) {
      console.error("Failed to load data:", err);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("live-signals")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_signals" }, () => {
        loadData();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  // Fetch current prices for open positions
  const openPositions = useMemo(() => positions.filter(p => p.status === "open"), [positions]);
  const closedPositions = useMemo(() => positions.filter(p => p.status === "closed"), [positions]);

  const fetchCurrentPrices = useCallback(async () => {
    const tickers = [...new Set(openPositions.map(p => p.ticker))];
    if (tickers.length === 0) return;

    setPricesLoading(true);
    const prices: Record<string, number> = {};

    await Promise.all(
      tickers.map(async (ticker) => {
        try {
          const { data } = await supabase.functions.invoke("fetch-stock-price", {
            body: { ticker },
          });
          if (data?.latestPrice) prices[ticker] = data.latestPrice;
        } catch (e) {
          console.error(`Price fetch failed for ${ticker}:`, e);
        }
      })
    );

    setCurrentPrices(prices);
    setPricesLoading(false);
  }, [openPositions]);

  // Auto-fetch prices when switching to portfolio tab
  useEffect(() => {
    if (activeTab === "portfolio" && openPositions.length > 0) {
      fetchCurrentPrices();
    }
  }, [activeTab, openPositions.length, fetchCurrentPrices]);

  // Compute unrealized P&L for a position
  const getUnrealizedPnL = (pos: Position) => {
    const price = currentPrices[pos.ticker];
    if (!price) return null;
    return pos.position_type === "long"
      ? (price - Number(pos.entry_price)) * Number(pos.shares)
      : (Number(pos.entry_price) - price) * Number(pos.shares);
  };

  const getUnrealizedPnLPct = (pos: Position) => {
    const price = currentPrices[pos.ticker];
    if (!price) return null;
    return pos.position_type === "long"
      ? ((price - Number(pos.entry_price)) / Number(pos.entry_price)) * 100
      : ((Number(pos.entry_price) - price) / Number(pos.entry_price)) * 100;
  };

  const totalUnrealizedPnL = useMemo(() => {
    return openPositions.reduce((sum, pos) => {
      const pnl = getUnrealizedPnL(pos);
      return sum + (pnl || 0);
    }, 0);
  }, [openPositions, currentPrices]);

  const totalRealizedPnL = closedPositions.reduce((sum, p) => sum + (Number(p.pnl) || 0), 0);

  // Run market scan
  const runScan = async () => {
    if (!user) {
      toast.error("Please sign in to scan the market");
      return;
    }
    setScanning(true);
    setScanProgress({ batch: 0, total: 3 });
    const collectedSellAlerts: SellAlert[] = [];

    try {
      let batch = 0;
      let done = false;
      let totalSignals = 0;

      while (!done) {
        setScanProgress({ batch: batch + 1, total: 3 });
        const { data, error } = await supabase.functions.invoke("market-scanner", {
          body: { batch, batchSize: 25, checkSells: batch === 0, userId: user.id },
        });

        if (error) throw error;
        totalSignals += data.signals?.length || 0;

        // Collect sell alerts from scanner
        if (data.sellSignals && data.sellSignals.length > 0) {
          collectedSellAlerts.push(...data.sellSignals);
        }

        done = data.done;
        batch++;

        if (!done) await new Promise(r => setTimeout(r, 500));
      }

      setSellAlerts(collectedSellAlerts);
      setLastScanTime(new Date().toISOString());

      if (collectedSellAlerts.length > 0) {
        toast.warning(`${collectedSellAlerts.length} sell alert(s) for your positions!`, {
          duration: 8000,
        });
      }

      toast.success(`Scan complete! Found ${totalSignals} signals across ${batch} batches`);
      await loadData();
      // Refresh prices after scan
      if (openPositions.length > 0) fetchCurrentPrices();
    } catch (err: any) {
      toast.error(err.message || "Scan failed");
    }
    setScanning(false);
  };

  // Register buy
  const handleBuy = async () => {
    if (!user || !selectedSignal || !shareAmount) return;
    const shares = parseFloat(shareAmount);
    if (isNaN(shares) || shares <= 0) {
      toast.error("Enter a valid number of shares");
      return;
    }

    const { error } = await supabase.from("virtual_positions").insert({
      user_id: user.id,
      ticker: selectedSignal.ticker,
      entry_price: selectedSignal.entry_price,
      shares,
      position_type: selectedSignal.signal_type === "BUY" ? "long" : "short",
      signal_id: selectedSignal.id,
    });

    if (error) {
      toast.error("Failed to register position");
    } else {
      toast.success(`Registered ${shares} shares of ${selectedSignal.ticker} at $${Number(selectedSignal.entry_price).toFixed(2)}`);
      setBuyDialogOpen(false);
      setShareAmount("");
      await loadData();
    }
  };

  // Close position
  const handleSell = async () => {
    if (!selectedPosition || !sellPrice) return;
    const price = parseFloat(sellPrice);
    if (isNaN(price) || price <= 0) {
      toast.error("Enter a valid price");
      return;
    }

    const pnl = selectedPosition.position_type === "long"
      ? (price - Number(selectedPosition.entry_price)) * Number(selectedPosition.shares)
      : (Number(selectedPosition.entry_price) - price) * Number(selectedPosition.shares);

    const { error } = await supabase
      .from("virtual_positions")
      .update({
        status: "closed",
        exit_price: price,
        exit_date: new Date().toISOString(),
        exit_reason: "manual",
        pnl,
        closed_at: new Date().toISOString(),
      })
      .eq("id", selectedPosition.id);

    if (error) {
      toast.error("Failed to close position");
    } else {
      toast.success(`Closed ${selectedPosition.ticker} at $${price.toFixed(2)} | P&L: $${pnl.toFixed(2)}`);
      setSellDialogOpen(false);
      setSellPrice("");
      // Remove from sell alerts
      setSellAlerts(prev => prev.filter(a => a.ticker !== selectedPosition.ticker));
      await loadData();
    }
  };

  // Close position from sell alert (auto-fill current price)
  const handleSellAlertClose = (alert: SellAlert) => {
    const pos = openPositions.find(p => p.ticker === alert.ticker);
    if (!pos) return;
    setSelectedPosition(pos);
    setSellPrice(alert.currentPrice.toFixed(2));
    setSellDialogOpen(true);
  };

  const buySignals = signals.filter(s => s.signal_type === "BUY");

  const getConfidenceColor = (c: number) => {
    if (c >= 80) return "text-success";
    if (c >= 65) return "text-primary";
    return "text-warning";
  };

  const getRegimeBadge = (regime: string) => {
    const colors: Record<string, string> = {
      strong_bullish: "bg-success/20 text-success border-success/30",
      bullish: "bg-success/10 text-success border-success/20",
      strong_bearish: "bg-destructive/20 text-destructive border-destructive/30",
      bearish: "bg-destructive/10 text-destructive border-destructive/20",
      neutral: "bg-muted text-muted-foreground border-border",
      overbought: "bg-warning/20 text-warning border-warning/30",
      oversold: "bg-primary/20 text-primary border-primary/30",
    };
    return colors[regime] || colors.neutral;
  };

  const totalPortfolioValue = useMemo(() => {
    return openPositions.reduce((sum, pos) => {
      const price = currentPrices[pos.ticker] || Number(pos.entry_price);
      return sum + price * Number(pos.shares);
    }, 0);
  }, [openPositions, currentPrices]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-4 pt-20 pb-10 max-w-7xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <Zap className="w-8 h-8 text-primary" />
                Live Signals
              </h1>
              <p className="text-muted-foreground mt-1">
                AI-powered market scanner • {signals.length} active signals • {openPositions.length} open positions
                {lastScanTime && (
                  <span className="ml-2 text-xs">
                    • Last scan: {new Date(lastScanTime).toLocaleTimeString()}
                  </span>
                )}
              </p>
            </div>
            <Button
              variant="glow"
              size="lg"
              onClick={runScan}
              disabled={scanning || !user}
              className="gap-2"
            >
              {scanning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Scanning batch {scanProgress.batch}/{scanProgress.total}...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Scan Market
                </>
              )}
            </Button>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
            <Card variant="stat">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <TrendingUp className="w-4 h-4 text-success" />
                  Buy Signals
                </div>
                <div className="text-2xl font-bold mt-1">{buySignals.length}</div>
              </CardContent>
            </Card>
            <Card variant="stat">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Package className="w-4 h-4 text-primary" />
                  Open Positions
                </div>
                <div className="text-2xl font-bold mt-1">{openPositions.length}</div>
              </CardContent>
            </Card>
            <Card variant="stat">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Target className="w-4 h-4 text-primary" />
                  Portfolio Value
                </div>
                <div className="text-2xl font-bold mt-1 font-mono">
                  ${totalPortfolioValue.toFixed(0)}
                </div>
              </CardContent>
            </Card>
            <Card variant="stat">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <TrendingUp className="w-4 h-4" />
                  Unrealized P&L
                </div>
                <div className={cn("text-2xl font-bold mt-1 font-mono", totalUnrealizedPnL >= 0 ? "text-success" : "text-destructive")}>
                  {totalUnrealizedPnL >= 0 ? "+" : ""}${totalUnrealizedPnL.toFixed(2)}
                </div>
              </CardContent>
            </Card>
            <Card variant="stat">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <DollarSign className="w-4 h-4" />
                  Realized P&L
                </div>
                <div className={cn("text-2xl font-bold mt-1 font-mono", totalRealizedPnL >= 0 ? "text-success" : "text-destructive")}>
                  {totalRealizedPnL >= 0 ? "+" : ""}${totalRealizedPnL.toFixed(2)}
                </div>
              </CardContent>
            </Card>
          </div>
        </motion.div>

        {/* Sell Alerts Banner */}
        <AnimatePresence>
          {sellAlerts.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6"
            >
              <Card className="border-warning/50 bg-warning/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2 text-warning">
                    <Bell className="w-5 h-5" />
                    Sell Alerts ({sellAlerts.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {sellAlerts.map((alert, i) => (
                    <div
                      key={`${alert.ticker}-${i}`}
                      className="flex items-center justify-between p-3 rounded-lg bg-warning/10 border border-warning/20"
                    >
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                        <div>
                          <span className="font-mono font-bold">{alert.ticker}</span>
                          <span className="text-sm text-muted-foreground ml-2">{alert.reason}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm">${alert.currentPrice.toFixed(2)}</span>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleSellAlertClose(alert)}
                        >
                          Close Position
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="signals" className="gap-2">
              <Zap className="w-4 h-4" />
              Signals ({signals.length})
            </TabsTrigger>
            <TabsTrigger value="portfolio" className="gap-2">
              <Package className="w-4 h-4" />
              Portfolio ({openPositions.length})
              {sellAlerts.length > 0 && (
                <span className="ml-1 w-5 h-5 rounded-full bg-warning text-warning-foreground text-xs flex items-center justify-center">
                  {sellAlerts.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <Clock className="w-4 h-4" />
              History ({closedPositions.length})
            </TabsTrigger>
          </TabsList>

          {/* Signals Tab */}
          <TabsContent value="signals">
            <AnimatePresence mode="wait">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : signals.length === 0 ? (
                <Card variant="glass" className="p-12 text-center">
                  <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Active Signals</h3>
                  <p className="text-muted-foreground mb-6">
                    Click "Scan Market" to analyze 75 stocks across all sectors
                  </p>
                  <Button variant="glow" onClick={runScan} disabled={scanning || !user}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Run First Scan
                  </Button>
                </Card>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-3"
                >
                  {signals.map((signal, idx) => (
                    <motion.div
                      key={signal.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                    >
                      <Card variant="glass" className="hover:border-primary/30 transition-all">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between flex-wrap gap-3">
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                {signal.signal_type === "BUY" ? (
                                  <ArrowUpRight className="w-5 h-5 text-success" />
                                ) : (
                                  <ArrowDownRight className="w-5 h-5 text-destructive" />
                                )}
                                <span className="text-lg font-bold font-mono">{signal.ticker}</span>
                                <Badge
                                  variant="outline"
                                  className={signal.signal_type === "BUY"
                                    ? "bg-success/10 text-success border-success/30"
                                    : "bg-destructive/10 text-destructive border-destructive/30"
                                  }
                                >
                                  {signal.signal_type}
                                </Badge>
                              </div>

                              <div className="hidden sm:flex items-center gap-2">
                                <Badge variant="outline" className={getRegimeBadge(signal.regime)}>
                                  {signal.regime?.replace("_", " ")}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {signal.stock_profile}
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {signal.strategy}
                                </Badge>
                              </div>
                            </div>

                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <div className="text-sm text-muted-foreground">Entry</div>
                                <div className="font-mono font-semibold">${Number(signal.entry_price).toFixed(2)}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm text-muted-foreground">Confidence</div>
                                <div className={cn("font-mono font-bold", getConfidenceColor(signal.confidence))}>
                                  {signal.confidence}%
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant={signal.signal_type === "BUY" ? "success" : "destructive"}
                                onClick={() => {
                                  if (!user) { toast.error("Please sign in first"); return; }
                                  setSelectedSignal(signal);
                                  setBuyDialogOpen(true);
                                }}
                              >
                                Register {signal.signal_type === "BUY" ? "Buy" : "Short"}
                              </Button>
                            </div>
                          </div>

                          {signal.reasoning && (
                            <p className="text-sm text-muted-foreground mt-2 border-t border-border/30 pt-2">
                              {signal.reasoning}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </TabsContent>

          {/* Portfolio Tab */}
          <TabsContent value="portfolio">
            {/* Equity Curve Chart */}
            {portfolioHistory.length > 1 && (
              <Card variant="glass" className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-primary" />
                    Portfolio Performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={portfolioHistory}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 11 }}
                          className="fill-muted-foreground"
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          className="fill-muted-foreground"
                          tickFormatter={(v) => `$${v.toLocaleString()}`}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                          formatter={(value: number) => [`$${value.toFixed(2)}`, "Portfolio Value"]}
                        />
                        <Line
                          type="monotone"
                          dataKey="total_value"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {openPositions.length === 0 ? (
              <Card variant="glass" className="p-12 text-center">
                <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Open Positions</h3>
                <p className="text-muted-foreground">
                  Register a buy from the Signals tab to start tracking
                </p>
              </Card>
            ) : (
              <Card variant="glass">
                <div className="p-4 border-b border-border/30 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {pricesLoading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Fetching live prices...
                      </span>
                    ) : Object.keys(currentPrices).length > 0 ? (
                      "Live prices loaded"
                    ) : (
                      "Prices not yet loaded"
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={fetchCurrentPrices}
                    disabled={pricesLoading}
                  >
                    <RefreshCw className={cn("w-3 h-3 mr-1", pricesLoading && "animate-spin")} />
                    Refresh Prices
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Current</TableHead>
                      <TableHead>Shares</TableHead>
                      <TableHead>Unrealized P&L</TableHead>
                      <TableHead>P&L %</TableHead>
                      <TableHead>Opened</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openPositions.map((pos) => {
                      const unrealizedPnL = getUnrealizedPnL(pos);
                      const unrealizedPnLPct = getUnrealizedPnLPct(pos);
                      const curPrice = currentPrices[pos.ticker];
                      const hasSellAlert = sellAlerts.some(a => a.ticker === pos.ticker);

                      return (
                        <TableRow key={pos.id} className={hasSellAlert ? "bg-warning/5" : ""}>
                          <TableCell className="font-mono font-bold">
                            <div className="flex items-center gap-2">
                              {pos.ticker}
                              {hasSellAlert && <AlertTriangle className="w-3 h-3 text-warning" />}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={pos.position_type === "long" ? "text-success" : "text-destructive"}>
                              {pos.position_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono">${Number(pos.entry_price).toFixed(2)}</TableCell>
                          <TableCell className="font-mono">
                            {curPrice ? `$${curPrice.toFixed(2)}` : (
                              pricesLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "—"
                            )}
                          </TableCell>
                          <TableCell className="font-mono">{Number(pos.shares).toFixed(2)}</TableCell>
                          <TableCell>
                            {unrealizedPnL !== null ? (
                              <span className={cn("font-mono font-bold", unrealizedPnL >= 0 ? "text-success" : "text-destructive")}>
                                {unrealizedPnL >= 0 ? "+" : ""}${unrealizedPnL.toFixed(2)}
                              </span>
                            ) : "—"}
                          </TableCell>
                          <TableCell>
                            {unrealizedPnLPct !== null ? (
                              <span className={cn("font-mono font-bold", unrealizedPnLPct >= 0 ? "text-success" : "text-destructive")}>
                                {unrealizedPnLPct >= 0 ? "+" : ""}{unrealizedPnLPct.toFixed(2)}%
                              </span>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(pos.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant={hasSellAlert ? "destructive" : "outline"}
                              onClick={() => {
                                setSelectedPosition(pos);
                                const alert = sellAlerts.find(a => a.ticker === pos.ticker);
                                setSellPrice(alert ? alert.currentPrice.toFixed(2) : curPrice ? curPrice.toFixed(2) : "");
                                setSellDialogOpen(true);
                              }}
                            >
                              Close Position
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history">
            {closedPositions.length === 0 ? (
              <Card variant="glass" className="p-12 text-center">
                <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Trade History</h3>
                <p className="text-muted-foreground">
                  Closed positions will appear here
                </p>
              </Card>
            ) : (
              <Card variant="glass">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticker</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Entry</TableHead>
                      <TableHead>Exit</TableHead>
                      <TableHead>Shares</TableHead>
                      <TableHead>P&L</TableHead>
                      <TableHead>Exit Reason</TableHead>
                      <TableHead>Closed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closedPositions.map((pos) => (
                      <TableRow key={pos.id}>
                        <TableCell className="font-mono font-bold">{pos.ticker}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={pos.position_type === "long" ? "text-success" : "text-destructive"}>
                            {pos.position_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">${Number(pos.entry_price).toFixed(2)}</TableCell>
                        <TableCell className="font-mono">${pos.exit_price ? Number(pos.exit_price).toFixed(2) : "—"}</TableCell>
                        <TableCell className="font-mono">{Number(pos.shares).toFixed(2)}</TableCell>
                        <TableCell className={cn("font-mono font-bold", (Number(pos.pnl) || 0) >= 0 ? "text-success" : "text-destructive")}>
                          {(Number(pos.pnl) || 0) >= 0 ? "+" : ""}${(Number(pos.pnl) || 0).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-sm">{pos.exit_reason || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {pos.closed_at ? new Date(pos.closed_at).toLocaleDateString() : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Buy Dialog */}
        <Dialog open={buyDialogOpen} onOpenChange={setBuyDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedSignal?.signal_type === "BUY" ? (
                  <ArrowUpRight className="w-5 h-5 text-success" />
                ) : (
                  <ArrowDownRight className="w-5 h-5 text-destructive" />
                )}
                Register {selectedSignal?.signal_type} — {selectedSignal?.ticker}
              </DialogTitle>
              <DialogDescription>
                This doesn't execute a real trade. Register how many shares you bought on your trading platform.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Entry Price</span>
                <span className="font-mono font-bold">${selectedSignal ? Number(selectedSignal.entry_price).toFixed(2) : "—"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Confidence</span>
                <span className={cn("font-mono font-bold", getConfidenceColor(selectedSignal?.confidence || 0))}>
                  {selectedSignal?.confidence}%
                </span>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Number of Shares</label>
                <Input
                  type="number"
                  placeholder="e.g. 10"
                  value={shareAmount}
                  onChange={(e) => setShareAmount(e.target.value)}
                  variant="glow"
                />
                {shareAmount && selectedSignal && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Total: ${(parseFloat(shareAmount) * Number(selectedSignal.entry_price)).toFixed(2)}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBuyDialogOpen(false)}>Cancel</Button>
              <Button variant="success" onClick={handleBuy}>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Confirm Registration
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Sell Dialog */}
        <Dialog open={sellDialogOpen} onOpenChange={setSellDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Close Position — {selectedPosition?.ticker}</DialogTitle>
              <DialogDescription>
                Enter the price at which you sold on your trading platform.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Entry Price</span>
                <span className="font-mono font-bold">${selectedPosition ? Number(selectedPosition.entry_price).toFixed(2) : "—"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Shares</span>
                <span className="font-mono">{selectedPosition ? Number(selectedPosition.shares).toFixed(2) : "—"}</span>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Exit Price</label>
                <Input
                  type="number"
                  placeholder="e.g. 155.00"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  variant="glow"
                />
                {sellPrice && selectedPosition && (
                  <p className={cn("text-sm mt-2 font-mono",
                    (() => {
                      const pnl = selectedPosition.position_type === "long"
                        ? (parseFloat(sellPrice) - Number(selectedPosition.entry_price)) * Number(selectedPosition.shares)
                        : (Number(selectedPosition.entry_price) - parseFloat(sellPrice)) * Number(selectedPosition.shares);
                      return pnl >= 0 ? "text-success" : "text-destructive";
                    })()
                  )}>
                    P&L: ${(() => {
                      const pnl = selectedPosition.position_type === "long"
                        ? (parseFloat(sellPrice) - Number(selectedPosition.entry_price)) * Number(selectedPosition.shares)
                        : (Number(selectedPosition.entry_price) - parseFloat(sellPrice)) * Number(selectedPosition.shares);
                      return (pnl >= 0 ? "+" : "") + pnl.toFixed(2);
                    })()}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSellDialogOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleSell}>
                Close Position
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default Signals;
