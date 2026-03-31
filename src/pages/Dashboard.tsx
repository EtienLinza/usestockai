import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Brain, Loader2, AlertTriangle, RefreshCw, Zap, DollarSign,
  ArrowUpRight, ArrowDownRight, Package, BarChart3, Bell,
  Trophy, Percent, Globe, CheckCircle2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { MarketTab } from "@/components/dashboard/MarketTab";
import { TradingTab } from "@/components/dashboard/TradingTab";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PredictionData {
  ticker: string;
  targetDate: string;
  currentPrice: number;
  predictedPrice: number;
  uncertaintyLow: number;
  uncertaintyHigh: number;
  confidence: number;
  regime: string;
  regimeDescription?: string;
  regimeStrength?: number;
  sentimentScore: number;
  sentimentConfidence?: number;
  featureImportance: { name: string; importance: number }[];
  historicalData: { date: string; price: number }[];
  reasoning?: string;
  volatility?: number;
  currency?: string;
  supportLevels?: number[];
  resistanceLevels?: number[];
  fibonacciTrend?: string;
  obvTrend?: string;
  relativeStrength?: number | null;
  beta?: number | null;
  sectorMomentum?: number | null;
  sectorETFTicker?: string | null;
  vixLevel?: number | null;
  vixPercentile?: number | null;
  dollarRegime?: string | null;
  yieldRegime?: string | null;
  marketState?: string | null;
}

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
  id: string;
  ticker: string;
  reason: string;
  current_price: number;
  currentPrice: number;
  position_id: string | null;
  is_dismissed: boolean;
}

interface PortfolioSnapshot {
  date: string;
  total_value: number;
  cash: number;
  positions_value: number;
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // ─ State ─
  const [signals, setSignals] = useState<Signal[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ batch: 0, total: 0 });
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [shareAmount, setShareAmount] = useState("");
  const [targetProfitPct, setTargetProfitPct] = useState("");
  const [sellDialogOpen, setSellDialogOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [sellPrice, setSellPrice] = useState("");
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [sellAlerts, setSellAlerts] = useState<SellAlert[]>([]);
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([]);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const [showTradeLog, setShowTradeLog] = useState(false);
  const [tradingStyle, setTradingStyle] = useState("all");

  // Derived
  const openPositions = useMemo(() => positions.filter(p => p.status === "open"), [positions]);
  const closedPositions = useMemo(() => positions.filter(p => p.status === "closed"), [positions]);

  const totalPortfolioValue = useMemo(() => {
    return openPositions.reduce((sum, pos) => {
      const price = currentPrices[pos.ticker] || Number(pos.entry_price);
      return sum + price * Number(pos.shares);
    }, 0);
  }, [openPositions, currentPrices]);

  const totalUnrealizedPnL = useMemo(() => {
    return openPositions.reduce((sum, pos) => {
      const price = currentPrices[pos.ticker];
      if (!price) return sum;
      const pnl = pos.position_type === "long"
        ? (price - Number(pos.entry_price)) * Number(pos.shares)
        : (Number(pos.entry_price) - price) * Number(pos.shares);
      return sum + pnl;
    }, 0);
  }, [openPositions, currentPrices]);

  const totalRealizedPnL = useMemo(
    () => closedPositions.reduce((sum, p) => sum + (Number(p.pnl) || 0), 0),
    [closedPositions]
  );

  const winRate = useMemo(() => {
    if (closedPositions.length === 0) return 0;
    const wins = closedPositions.filter(p => (Number(p.pnl) || 0) > 0).length;
    return (wins / closedPositions.length) * 100;
  }, [closedPositions]);

  // ── Load signals + positions ─────────────────────────────────────────────────
  const loadSignalData = useCallback(async () => {
    setSignalsLoading(true);
    try {
      const { data: signalData } = await supabase
        .from("live_signals")
        .select("*")
        .gte("expires_at", new Date().toISOString())
        .order("confidence", { ascending: false });

      if (signalData) {
        setSignals(signalData as Signal[]);
        if (signalData.length > 0) setLastScanTime(signalData[0].created_at);
      }

      if (user) {
        const [{ data: posData }, { data: histData }, { data: alertData }] = await Promise.all([
          supabase.from("virtual_positions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
          supabase.from("virtual_portfolio_log").select("*").eq("user_id", user.id).order("date", { ascending: true }),
          supabase.from("sell_alerts").select("*").eq("user_id", user.id).eq("is_dismissed", false).order("created_at", { ascending: false }),
        ]);
        if (posData) setPositions(posData as Position[]);
        if (histData) setPortfolioHistory(histData as PortfolioSnapshot[]);
        if (alertData) setSellAlerts(alertData.map((a: any) => ({ ...a, currentPrice: Number(a.current_price) })) as SellAlert[]);
      }
    } catch (err) {
      console.error("Failed to load signal data:", err);
    }
    setSignalsLoading(false);
  }, [user]);

  useEffect(() => { loadSignalData(); }, [loadSignalData]);

  useEffect(() => {
    const signalChannel = supabase
      .channel("live-signals")
      .on("postgres_changes", { event: "*", schema: "public", table: "live_signals" }, () => loadSignalData())
      .subscribe();

    const alertChannel = user ? supabase
      .channel("sell-alerts-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "sell_alerts", filter: `user_id=eq.${user.id}` }, () => loadSignalData())
      .subscribe() : null;

    return () => {
      supabase.removeChannel(signalChannel);
      if (alertChannel) supabase.removeChannel(alertChannel);
    };
  }, [loadSignalData, user]);

  const fetchCurrentPrices = useCallback(async () => {
    const tickers = [...new Set(openPositions.map(p => p.ticker))];
    if (tickers.length === 0) return;
    setPricesLoading(true);
    const prices: Record<string, number> = {};
    await Promise.all(
      tickers.map(async (ticker) => {
        try {
          const { data } = await supabase.functions.invoke("fetch-stock-price", { body: { ticker } });
          if (data?.latestPrice) prices[ticker] = data.latestPrice;
        } catch (e) { console.error(`Price fetch failed for ${ticker}:`, e); }
      })
    );
    setCurrentPrices(prices);
    setPricesLoading(false);
  }, [openPositions]);

  useEffect(() => {
    if (openPositions.length > 0) fetchCurrentPrices();
  }, [openPositions.length, fetchCurrentPrices]);

  // ── Market scan ──────────────────────────────────────────────────────────────

  const runScan = async () => {
    if (!user) { toast.error("Please sign in to scan the market"); return; }
    setScanning(true);
    setScanProgress({ batch: 0, total: 0 });

    try {
      let batch = 0;
      let done = false;
      let totalSignals = 0;
      let tickerList: string[] | undefined;
      let totalBatches = 0;

      while (!done) {
        setScanProgress({ batch: batch + 1, total: totalBatches || batch + 2 });
        const invokeBody: any = { batch, batchSize: 25 };
        if (tickerList) invokeBody.tickerList = tickerList;

        const { data, error } = await supabase.functions.invoke("market-scanner", { body: invokeBody });
        if (error) throw error;
        totalSignals += data.signals?.length || 0;
        done = data.done;
        if (data.tickerList && !tickerList) tickerList = data.tickerList;
        if (data.totalBatches) totalBatches = data.totalBatches;
        setScanProgress({ batch: batch + 1, total: totalBatches });
        batch++;
        if (!done) await new Promise(r => setTimeout(r, 500));
      }

      setLastScanTime(new Date().toISOString());
      const tickerCount = tickerList?.length || batch * 25;
      toast.success(`Scan complete! Found ${totalSignals} signals across ${tickerCount} stocks`);
      await loadSignalData();
      if (openPositions.length > 0) fetchCurrentPrices();
    } catch (err: any) {
      toast.error(err.message || "Scan failed");
    }
    setScanning(false);
  };

  // ── Buy / Sell handlers ──────────────────────────────────────────────────────

  const handleBuy = async () => {
    if (!user || !selectedSignal || !shareAmount) return;
    const shares = parseFloat(shareAmount);
    if (isNaN(shares) || shares <= 0) { toast.error("Enter a valid number of shares"); return; }

    const profitTarget = targetProfitPct ? parseFloat(targetProfitPct) : null;
    if (profitTarget !== null && (isNaN(profitTarget) || profitTarget <= 0)) { toast.error("Enter a valid profit target percentage"); return; }

    const { error } = await supabase.from("virtual_positions").insert({
      user_id: user.id, ticker: selectedSignal.ticker, entry_price: selectedSignal.entry_price,
      shares, position_type: selectedSignal.signal_type === "BUY" ? "long" : "short", signal_id: selectedSignal.id,
      target_profit_pct: profitTarget,
    } as any);

    if (error) { toast.error("Failed to register position"); }
    else {
      toast.success(`Registered ${shares} shares of ${selectedSignal.ticker} at $${Number(selectedSignal.entry_price).toFixed(2)}`);
      setBuyDialogOpen(false);
      setShareAmount("");
      setTargetProfitPct("");
      await loadSignalData();
    }
  };

  const handleSell = async () => {
    if (!selectedPosition || !sellPrice) return;
    const price = parseFloat(sellPrice);
    if (isNaN(price) || price <= 0) { toast.error("Enter a valid price"); return; }

    const pnl = selectedPosition.position_type === "long"
      ? (price - Number(selectedPosition.entry_price)) * Number(selectedPosition.shares)
      : (Number(selectedPosition.entry_price) - price) * Number(selectedPosition.shares);

    const { error } = await supabase.from("virtual_positions").update({
      status: "closed", exit_price: price, exit_date: new Date().toISOString(),
      exit_reason: "manual", pnl, closed_at: new Date().toISOString(),
    }).eq("id", selectedPosition.id);

    if (error) { toast.error("Failed to close position"); }
    else {
      toast.success(`Closed ${selectedPosition.ticker} at $${price.toFixed(2)} | P&L: $${pnl.toFixed(2)}`);
      setSellDialogOpen(false);
      setSellPrice("");
      const alertsForPos = sellAlerts.filter(a => a.ticker === selectedPosition.ticker);
      for (const alert of alertsForPos) {
        if (alert.id) await supabase.from("sell_alerts").update({ is_dismissed: true }).eq("id", alert.id);
      }
      await loadSignalData();
    }
  };

  const handleSellAlertClose = (alert: SellAlert) => {
    const pos = openPositions.find(p => p.ticker === alert.ticker);
    if (!pos) return;
    setSelectedPosition(pos);
    setSellPrice(alert.currentPrice.toFixed(2));
    setSellDialogOpen(true);
  };

  const handleDismissAlert = async (alert: SellAlert) => {
    if (alert.id) {
      await supabase.from("sell_alerts").update({ is_dismissed: true }).eq("id", alert.id);
      setSellAlerts(prev => prev.filter(a => a.id !== alert.id));
      toast.success(`Dismissed alert for ${alert.ticker}`);
    }
  };

  const getConfidenceColor = (c: number) => {
    if (c >= 80) return "text-success";
    if (c >= 65) return "text-primary";
    return "text-warning";
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/2 rounded-full blur-[150px]" />
      </div>

      <main className="pt-20 pb-12 px-4 sm:px-6 relative z-10">
        <div className="container mx-auto max-w-7xl">

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-medium mb-1 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  Trading Hub
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  AI-powered signals, portfolio tracking & performance analytics
                  {lastScanTime && (
                    <span className="ml-2 text-xs">• Last scan: {new Date(lastScanTime).toLocaleTimeString()}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs h-8"
                  disabled={signalsLoading}
                  onClick={async () => {
                    await loadSignalData();
                    if (openPositions.length > 0) fetchCurrentPrices();
                    toast.success("Dashboard refreshed");
                  }}
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", signalsLoading && "animate-spin")} />
                  Refresh
                </Button>
                <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted/50 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  Auto-scanning active
                </div>
              </div>
            </div>
          </motion.div>

          {/* Sell Alerts Banner */}
          <AnimatePresence>
            {sellAlerts.length > 0 && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-6">
                <Card className="border-warning/50 bg-warning/5 p-4 sm:p-6">
                  <div className="text-sm sm:text-base flex items-center gap-2 text-warning font-medium mb-3">
                    <Bell className="w-4 h-4" />Sell Alerts ({sellAlerts.length})
                  </div>
                  <div className="space-y-2">
                    {sellAlerts.map((alert) => (
                      <div key={alert.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-warning/10 border border-warning/20 gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                          <div className="min-w-0">
                            <span className="font-mono font-bold text-sm">{alert.ticker}</span>
                            <span className="text-xs sm:text-sm text-muted-foreground ml-2 line-clamp-1">{alert.reason}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-7 sm:ml-0">
                          <span className="font-mono text-sm">${alert.currentPrice.toFixed(2)}</span>
                          <Button size="sm" variant="ghost" onClick={() => handleDismissAlert(alert)} className="text-xs h-7">Dismiss</Button>
                          <Button size="sm" variant="destructive" onClick={() => handleSellAlertClose(alert)} className="text-xs h-7">Close</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Layout: Config Left + Content Right ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">

            {/* ── Left Panel: Scanner + Portfolio Summary ── */}
            <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }} className="lg:col-span-4 xl:col-span-3">
              <div className="sticky top-20 space-y-4">

                {/* Scanner Control */}
                <Card className="glass-card p-5 space-y-5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Brain className="w-4 h-4 text-primary" />
                    Market Scanner
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Scan 75+ stocks across all sectors using the quantitative algorithm to find high-conviction trade signals.
                  </p>
                  {scanning && (
                    <div className="space-y-2">
                      <Progress value={(scanProgress.batch / scanProgress.total) * 100} className="h-1.5" />
                      <p className="text-[10px] text-muted-foreground text-center">
                        Batch {scanProgress.batch} of {scanProgress.total}
                      </p>
                    </div>
                  )}
                  <Button onClick={runScan} disabled={scanning || !user} className="w-full gap-2">
                    {scanning ? (
                      <><Loader2 className="w-4 h-4 animate-spin" />Scanning...</>
                    ) : (
                      <><RefreshCw className="w-4 h-4" />Scan Market</>
                    )}
                  </Button>
                </Card>

                {/* Portfolio Summary */}
                <Card className="glass-card p-5 space-y-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Package className="w-4 h-4 text-primary" />
                    Portfolio Summary
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Open Positions</span>
                      <span className="font-mono font-medium">{openPositions.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Portfolio Value</span>
                      <span className="font-mono font-medium">${totalPortfolioValue.toFixed(0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Unrealized P&L</span>
                      <span className={cn("font-mono font-medium", totalUnrealizedPnL >= 0 ? "text-success" : "text-destructive")}>
                        {totalUnrealizedPnL >= 0 ? "+" : ""}${totalUnrealizedPnL.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Realized P&L</span>
                      <span className={cn("font-mono font-medium", totalRealizedPnL >= 0 ? "text-success" : "text-destructive")}>
                        {totalRealizedPnL >= 0 ? "+" : ""}${totalRealizedPnL.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Win Rate</span>
                      <span className={cn("font-mono font-medium", winRate >= 50 ? "text-success" : winRate > 0 ? "text-destructive" : "text-muted-foreground")}>
                        {closedPositions.length > 0 ? `${winRate.toFixed(1)}%` : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Closed Trades</span>
                      <span className="font-mono font-medium">{closedPositions.length}</span>
                    </div>
                  </div>
                </Card>

                {/* Algorithm Details */}
                <Card className="glass-card p-4">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Algorithm Details</div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span>Indicators</span><span className="font-mono text-primary">10+</span></div>
                    <div className="flex justify-between"><span>Regime Detection</span><span className="font-mono text-success">Active</span></div>
                    <div className="flex justify-between"><span>Signal Consensus</span><span className="font-mono text-success">Weighted</span></div>
                    <div className="flex justify-between"><span>Conviction Range</span><span className="font-mono">35–92%</span></div>
                    <div className="flex justify-between"><span>Auto-Scan</span><span className="font-mono text-success">Scheduled</span></div>
                  </div>
                </Card>
              </div>
            </motion.div>

            {/* ── Right Panel ── */}
            <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="lg:col-span-8 xl:col-span-9">
              <Tabs defaultValue="trading" className="w-full">
                <TabsList className="bg-secondary/30 mb-6">
                  <TabsTrigger value="trading" className="text-xs sm:text-sm gap-1.5"><Zap className="w-3.5 h-3.5" />Trading</TabsTrigger>
                  <TabsTrigger value="market" className="text-xs sm:text-sm gap-1.5"><Globe className="w-3.5 h-3.5" />Market</TabsTrigger>
                </TabsList>

                <TabsContent value="trading">
                  <TradingTab
                    signals={signals}
                    signalsLoading={signalsLoading}
                    scanning={scanning}
                    scanProgress={scanProgress}
                    openPositions={openPositions}
                    closedPositions={closedPositions}
                    currentPrices={currentPrices}
                    pricesLoading={pricesLoading}
                    sellAlerts={sellAlerts}
                    portfolioHistory={portfolioHistory}
                    showTradeLog={showTradeLog}
                    setShowTradeLog={setShowTradeLog}
                    user={user}
                    tradingStyle={tradingStyle}
                    setTradingStyle={setTradingStyle}
                    runScan={runScan}
                    onClearSignals={async () => {
                      if (!user) return;
                      try {
                        const { error } = await supabase.functions.invoke("clear-signals");
                        if (error) throw error;
                        setSignals([]);
                        toast.success("All signals cleared");
                      } catch {
                        toast.error("Failed to clear signals");
                      }
                    }}
                    fetchCurrentPrices={fetchCurrentPrices}
                    onRegisterSignal={(signal) => {
                      if (!user) { toast.error("Please sign in first"); return; }
                      setSelectedSignal(signal);
                      setBuyDialogOpen(true);
                    }}
                    onClosePosition={(pos, price) => {
                      setSelectedPosition(pos);
                      setSellPrice(price || "");
                      setSellDialogOpen(true);
                    }}
                    onDismissAlert={handleDismissAlert}
                    onSellAlertClose={handleSellAlertClose}
                  />
                </TabsContent>

                <TabsContent value="market">
                  <MarketTab />
                </TabsContent>
              </Tabs>
            </motion.div>
          </div>
        </div>
      </main>

      {/* Buy Dialog */}
      <Dialog open={buyDialogOpen} onOpenChange={setBuyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedSignal?.signal_type === "BUY" ? <ArrowUpRight className="w-5 h-5 text-success" /> : <ArrowDownRight className="w-5 h-5 text-destructive" />}
              Register {selectedSignal?.signal_type} — {selectedSignal?.ticker}
            </DialogTitle>
            <DialogDescription>This doesn't execute a real trade. Register how many shares you bought on your trading platform.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Entry Price</span>
              <span className="font-mono font-bold">${selectedSignal ? Number(selectedSignal.entry_price).toFixed(2) : "—"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Confidence</span>
              <span className={cn("font-mono font-bold", getConfidenceColor(selectedSignal?.confidence || 0))}>{selectedSignal?.confidence}%</span>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Number of Shares</label>
              <Input type="number" placeholder="e.g. 10" value={shareAmount} onChange={(e) => setShareAmount(e.target.value)} variant="glow" />
              {shareAmount && selectedSignal && (
                <p className="text-sm text-muted-foreground mt-2">Total: ${(parseFloat(shareAmount) * Number(selectedSignal.entry_price)).toFixed(2)}</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Desired Profit Target %</label>
              <Input type="number" placeholder="e.g. 10 (for 10%)" value={targetProfitPct} onChange={(e) => setTargetProfitPct(e.target.value)} variant="glow" />
              <p className="text-xs text-muted-foreground mt-1">
                {targetProfitPct && shareAmount && selectedSignal
                  ? `You'll be notified when profit reaches $${((parseFloat(targetProfitPct) / 100) * parseFloat(shareAmount) * Number(selectedSignal.entry_price)).toFixed(2)}`
                  : "Optional — defaults to 15% if not set"}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuyDialogOpen(false)}>Cancel</Button>
            <Button variant="success" onClick={handleBuy}><CheckCircle2 className="w-4 h-4 mr-2" />Confirm Registration</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sell Dialog */}
      <Dialog open={sellDialogOpen} onOpenChange={setSellDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close Position — {selectedPosition?.ticker}</DialogTitle>
            <DialogDescription>Enter the price at which you sold on your trading platform.</DialogDescription>
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
              <Input type="number" placeholder="e.g. 155.00" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} variant="glow" />
              {sellPrice && selectedPosition && (
                <p className={cn("text-sm mt-2 font-mono", (() => {
                  const pnl = selectedPosition.position_type === "long"
                    ? (parseFloat(sellPrice) - Number(selectedPosition.entry_price)) * Number(selectedPosition.shares)
                    : (Number(selectedPosition.entry_price) - parseFloat(sellPrice)) * Number(selectedPosition.shares);
                  return pnl >= 0 ? "text-success" : "text-destructive";
                })())}>
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
            <Button variant="destructive" onClick={handleSell}>Close Position</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Dashboard;
