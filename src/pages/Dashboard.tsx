import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { MetricCard } from "@/components/MetricCard";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Brain, TrendingUp, TrendingDown, Shield,
  Loader2, AlertTriangle, RefreshCw, Zap, DollarSign, Target,
  ArrowUpRight, ArrowDownRight, Package, BarChart3, Clock, CheckCircle2, Bell,
  Trophy, Percent, ChevronDown, Activity, Sparkles, Globe, PieChart,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { fetchWithErrorHandling, handleResponseError, showErrorToast } from "@/lib/api-error";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { MarketTab } from "@/components/dashboard/MarketTab";

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
  const [sellDialogOpen, setSellDialogOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [sellPrice, setSellPrice] = useState("");
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [sellAlerts, setSellAlerts] = useState<SellAlert[]>([]);
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>([]);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const [showTradeLog, setShowTradeLog] = useState(false);

  // Derived
  const openPositions = useMemo(() => positions.filter(p => p.status === "open"), [positions]);
  const closedPositions = useMemo(() => positions.filter(p => p.status === "closed"), [positions]);
  const buySignals = useMemo(() => signals.filter(s => s.signal_type === "BUY"), [signals]);

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

  const totalPortfolioValue = useMemo(() => {
    return openPositions.reduce((sum, pos) => {
      const price = currentPrices[pos.ticker] || Number(pos.entry_price);
      return sum + price * Number(pos.shares);
    }, 0);
  }, [openPositions, currentPrices]);

  const winRate = useMemo(() => {
    if (closedPositions.length === 0) return 0;
    const wins = closedPositions.filter(p => (Number(p.pnl) || 0) > 0).length;
    return (wins / closedPositions.length) * 100;
  }, [closedPositions]);

  const avgWin = useMemo(() => {
    const wins = closedPositions.filter(p => (Number(p.pnl) || 0) > 0);
    if (wins.length === 0) return 0;
    return wins.reduce((sum, p) => sum + Number(p.pnl), 0) / wins.length;
  }, [closedPositions]);

  const avgLoss = useMemo(() => {
    const losses = closedPositions.filter(p => (Number(p.pnl) || 0) < 0);
    if (losses.length === 0) return 0;
    return losses.reduce((sum, p) => sum + Number(p.pnl), 0) / losses.length;
  }, [closedPositions]);

  const profitFactor = useMemo(() => {
    const grossProfit = closedPositions.filter(p => (Number(p.pnl) || 0) > 0).reduce((s, p) => s + Number(p.pnl), 0);
    const grossLoss = Math.abs(closedPositions.filter(p => (Number(p.pnl) || 0) < 0).reduce((s, p) => s + Number(p.pnl), 0));
    return grossLoss === 0 ? grossProfit > 0 ? Infinity : 0 : grossProfit / grossLoss;
  }, [closedPositions]);

  const drawdownData = useMemo(() => {
    if (portfolioHistory.length < 2) return [];
    let peak = portfolioHistory[0].total_value;
    return portfolioHistory.map(snap => {
      if (snap.total_value > peak) peak = snap.total_value;
      const dd = peak > 0 ? ((snap.total_value - peak) / peak) * 100 : 0;
      return { date: snap.date, drawdown: dd };
    });
  }, [portfolioHistory]);

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

  // ── Helpers ──────────────────────────────────────────────────────────────────

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

  const getConfidenceColor = (c: number) => {
    if (c >= 80) return "text-success";
    if (c >= 65) return "text-primary";
    return "text-warning";
  };

  const getConfidenceBg = (c: number) => {
    if (c >= 80) return "bg-success";
    if (c >= 65) return "bg-primary";
    return "bg-warning";
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
        // Pass the discovered tickerList to subsequent batches so the edge function
        // doesn't re-discover on every call
        if (tickerList) invokeBody.tickerList = tickerList;

        const { data, error } = await supabase.functions.invoke("market-scanner", {
          body: invokeBody,
        });
        if (error) throw error;
        totalSignals += data.signals?.length || 0;
        done = data.done;
        // Capture the tickerList from the first batch response
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

    const { error } = await supabase.from("virtual_positions").insert({
      user_id: user.id, ticker: selectedSignal.ticker, entry_price: selectedSignal.entry_price,
      shares, position_type: selectedSignal.signal_type === "BUY" ? "long" : "short", signal_id: selectedSignal.id,
    });

    if (error) { toast.error("Failed to register position"); }
    else {
      toast.success(`Registered ${shares} shares of ${selectedSignal.ticker} at $${Number(selectedSignal.entry_price).toFixed(2)}`);
      setBuyDialogOpen(false);
      setShareAmount("");
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
                <Card className="border-warning/50 bg-warning/5">
                  <CardHeader className="pb-3 px-4 sm:px-6">
                    <CardTitle className="text-sm sm:text-base flex items-center gap-2 text-warning">
                      <Bell className="w-4 h-4" />Sell Alerts ({sellAlerts.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 px-4 sm:px-6">
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
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Backtester-style layout: Config Left + Content Right ── */}
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

                {/* Anti-Bias Info (matching backtester) */}
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

            {/* ── Right Panel: Signals + Positions + Charts ── */}
            <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="lg:col-span-8 xl:col-span-9">
              <Tabs defaultValue="trading" className="w-full">
                <TabsList className="bg-secondary/30 mb-6">
                  <TabsTrigger value="trading" className="text-xs sm:text-sm gap-1.5"><Zap className="w-3.5 h-3.5" />Trading</TabsTrigger>
                  <TabsTrigger value="market" className="text-xs sm:text-sm gap-1.5"><Globe className="w-3.5 h-3.5" />Market</TabsTrigger>
                  <TabsTrigger value="sectors" className="text-xs sm:text-sm gap-1.5"><PieChart className="w-3.5 h-3.5" />Sectors</TabsTrigger>
                </TabsList>

                <TabsContent value="trading">
              <AnimatePresence mode="wait">
                {signalsLoading ? (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card p-12 text-center">
                    <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">Loading signals & positions...</p>
                  </motion.div>
                ) : (
                  <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">

                    {/* Primary Metrics Row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricCard icon={Zap} label="Buy Signals" value={buySignals.length} color="text-success" />
                      <MetricCard icon={Package} label="Open Positions" value={openPositions.length} color="text-primary" />
                      <MetricCard icon={DollarSign} label="Portfolio Value" value={`$${totalPortfolioValue.toFixed(0)}`} />
                      <MetricCard
                        icon={Trophy}
                        label="Win Rate"
                        value={closedPositions.length > 0 ? `${winRate.toFixed(1)}` : "—"}
                        suffix={closedPositions.length > 0 ? "%" : ""}
                        color={winRate >= 50 ? "text-success" : winRate > 0 ? "text-destructive" : "text-muted-foreground"}
                        subtext={closedPositions.length > 0 ? `${closedPositions.length} trades` : "No closed trades"}
                      />
                    </div>

                    {/* Performance Metrics (if closed trades) */}
                    {closedPositions.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <MetricCard icon={TrendingUp} label="Avg Win" value={`+$${avgWin.toFixed(2)}`} color="text-success" />
                        <MetricCard icon={TrendingDown} label="Avg Loss" value={`$${avgLoss.toFixed(2)}`} color="text-destructive" />
                        <MetricCard
                          icon={Activity}
                          label="Profit Factor"
                          value={profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}
                          color={profitFactor >= 1.5 ? "text-success" : profitFactor >= 1 ? "text-primary" : "text-destructive"}
                        />
                        <MetricCard
                          icon={Target}
                          label="Total P&L"
                          value={`${totalRealizedPnL >= 0 ? "+" : ""}$${totalRealizedPnL.toFixed(2)}`}
                          color={totalRealizedPnL >= 0 ? "text-success" : "text-destructive"}
                        />
                      </div>
                    )}

                    {/* Equity Curve */}
                    {portfolioHistory.length > 1 && (
                      <Card className="glass-card p-4 sm:p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <BarChart3 className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">Equity Curve</span>
                        </div>
                        <div className="h-36 sm:h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={portfolioHistory}>
                              <defs>
                                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" className="stroke-border/20" />
                              <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                              <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" tickFormatter={(v) => `$${v.toLocaleString()}`} />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "hsl(var(--card))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "8px",
                                  fontSize: "12px",
                                }}
                                formatter={(value: number) => [`$${value.toFixed(2)}`, "Portfolio Value"]}
                              />
                              <Area type="monotone" dataKey="total_value" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#equityFill)" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>

                        {drawdownData.length > 0 && (
                          <div className="h-24 mt-4">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Drawdown</div>
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={drawdownData}>
                                <defs>
                                  <linearGradient id="ddFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border/10" />
                                <XAxis dataKey="date" tick={false} />
                                <YAxis tick={{ fontSize: 9 }} className="fill-muted-foreground" tickFormatter={(v) => `${v.toFixed(0)}%`} />
                                <Tooltip
                                  contentStyle={{
                                    backgroundColor: "hsl(var(--card))",
                                    border: "1px solid hsl(var(--border))",
                                    borderRadius: "8px",
                                    fontSize: "11px",
                                  }}
                                  formatter={(value: number) => [`${value.toFixed(2)}%`, "Drawdown"]}
                                />
                                <ReferenceLine y={0} className="stroke-border" />
                                <Area type="monotone" dataKey="drawdown" stroke="hsl(var(--destructive))" strokeWidth={1.5} fill="url(#ddFill)" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </Card>
                    )}

                    {/* Active Signals */}
                    <Card className="glass-card">
                      <div className="p-4 border-b border-border/30 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">Active Signals</span>
                          {signals.length > 0 && <Badge variant="secondary" className="text-[10px] px-1.5 h-4">{signals.length}</Badge>}
                        </div>
                        <Button variant="outline" size="sm" onClick={runScan} disabled={scanning || !user} className="gap-1.5 text-xs h-7">
                          {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          Scan
                        </Button>
                      </div>

                      {signals.length === 0 ? (
                        <div className="p-8 text-center">
                          <Zap className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                          <h3 className="text-sm font-medium mb-1">No Active Signals</h3>
                          <p className="text-xs text-muted-foreground mb-4">Click "Scan Market" to analyze 75 stocks across all sectors</p>
                          <Button variant="glow" size="sm" onClick={runScan} disabled={scanning || !user}>
                            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Run First Scan
                          </Button>
                        </div>
                      ) : (
                        <div className="divide-y divide-border/20">
                          {signals.map((signal, idx) => (
                            <motion.div key={signal.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.02 }} className="p-3 sm:p-4 hover:bg-muted/5 transition-colors">
                              {/* Mobile: stacked layout */}
                              <div className="flex items-start sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  {signal.signal_type === "BUY" ? <ArrowUpRight className="w-4 h-4 sm:w-5 sm:h-5 text-success shrink-0" /> : <ArrowDownRight className="w-4 h-4 sm:w-5 sm:h-5 text-destructive shrink-0" />}
                                  <span className="text-base sm:text-lg font-bold font-mono">{signal.ticker}</span>
                                  <Badge variant="outline" className={cn("text-[10px]", signal.signal_type === "BUY" ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30")}>
                                    {signal.signal_type}
                                  </Badge>
                                </div>
                                <Button
                                  size="sm"
                                  variant={signal.signal_type === "BUY" ? "success" : "destructive"}
                                  className="text-xs h-7 shrink-0"
                                  onClick={() => {
                                    if (!user) { toast.error("Please sign in first"); return; }
                                    setSelectedSignal(signal);
                                    setBuyDialogOpen(true);
                                  }}
                                >
                                  Register
                                </Button>
                              </div>

                              {/* Stats row */}
                              <div className="flex items-center gap-3 sm:gap-4 mt-2 ml-6 sm:ml-0">
                                <div className="hidden sm:flex items-center gap-2">
                                  <Badge variant="outline" className={cn("text-[10px]", getRegimeBadge(signal.regime))}>{signal.regime?.replace("_", " ")}</Badge>
                                  <Badge variant="outline" className="text-[10px]">{signal.stock_profile}</Badge>
                                  <Badge variant="outline" className="text-[10px]">{signal.strategy}</Badge>
                                </div>
                                <div className="flex items-center gap-3 text-xs sm:ml-auto">
                                  <span className="text-muted-foreground">Entry: <span className="font-mono font-medium text-foreground">${Number(signal.entry_price).toFixed(2)}</span></span>
                                  <span className="text-muted-foreground">Conv: <span className={cn("font-mono font-bold", getConfidenceColor(signal.confidence))}>{signal.confidence}%</span></span>
                                  {signal.target_allocation > 0 && (
                                    <span className="text-muted-foreground hidden sm:inline">Alloc: <span className="font-mono">{signal.target_allocation}%</span></span>
                                  )}
                                </div>
                              </div>

                              {/* Conviction bar */}
                              <div className="mt-2 ml-6 sm:ml-0">
                                <div className="h-1 sm:h-1.5 rounded-full bg-muted overflow-hidden">
                                  <div
                                    className={cn("h-full rounded-full transition-all", getConfidenceBg(signal.confidence))}
                                    style={{ width: `${signal.confidence}%` }}
                                  />
                                </div>
                              </div>

                              {/* Mobile badges */}
                              <div className="flex sm:hidden items-center gap-1.5 mt-2 ml-6 flex-wrap">
                                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", getRegimeBadge(signal.regime))}>{signal.regime?.replace("_", " ")}</Badge>
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0">{signal.stock_profile}</Badge>
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0">{signal.strategy}</Badge>
                              </div>

                              {signal.reasoning && (
                                <p className="text-[11px] sm:text-xs text-muted-foreground mt-2 border-t border-border/10 pt-2 ml-6 sm:ml-0 line-clamp-2 sm:line-clamp-none">{signal.reasoning}</p>
                              )}
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </Card>

                    {/* Open Positions */}
                    {openPositions.length > 0 && (
                      <Card className="glass-card">
                        <div className="p-4 border-b border-border/30 flex items-center justify-between">
                          <span className="text-sm font-medium flex items-center gap-2">
                            <Package className="w-4 h-4 text-primary" />
                            Open Positions ({openPositions.length})
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">
                              {pricesLoading ? (
                                <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Fetching...</span>
                              ) : Object.keys(currentPrices).length > 0 ? "Live" : "—"}
                            </span>
                            <Button size="sm" variant="ghost" onClick={fetchCurrentPrices} disabled={pricesLoading} className="h-7 px-2 text-xs">
                              <RefreshCw className={cn("w-3 h-3", pricesLoading && "animate-spin")} />
                            </Button>
                          </div>
                        </div>
                        {/* Mobile: Card layout */}
                        <div className="sm:hidden divide-y divide-border/20">
                          {openPositions.map((pos) => {
                            const unrealizedPnL = getUnrealizedPnL(pos);
                            const unrealizedPnLPct = getUnrealizedPnLPct(pos);
                            const curPrice = currentPrices[pos.ticker];
                            const hasSellAlert = sellAlerts.some(a => a.ticker === pos.ticker);
                            return (
                              <div key={pos.id} className={cn("p-3 space-y-2", hasSellAlert && "bg-warning/5")}>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-sm">{pos.ticker}</span>
                                    {hasSellAlert && <AlertTriangle className="w-3 h-3 text-warning" />}
                                    <Badge variant="outline" className={cn("text-[9px]", pos.position_type === "long" ? "text-success" : "text-destructive")}>{pos.position_type}</Badge>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant={hasSellAlert ? "destructive" : "outline"}
                                    className="text-xs h-7"
                                    onClick={() => {
                                      setSelectedPosition(pos);
                                      const alert = sellAlerts.find(a => a.ticker === pos.ticker);
                                      setSellPrice(alert ? alert.currentPrice.toFixed(2) : curPrice ? curPrice.toFixed(2) : "");
                                      setSellDialogOpen(true);
                                    }}
                                  >
                                    Close
                                  </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-xs">
                                  <div>
                                    <div className="text-[9px] text-muted-foreground">Entry</div>
                                    <div className="font-mono">${Number(pos.entry_price).toFixed(2)}</div>
                                  </div>
                                  <div>
                                    <div className="text-[9px] text-muted-foreground">Current</div>
                                    <div className="font-mono">{curPrice ? `$${curPrice.toFixed(2)}` : pricesLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "—"}</div>
                                  </div>
                                  <div>
                                    <div className="text-[9px] text-muted-foreground">P&L</div>
                                    <div className={cn("font-mono font-bold", unrealizedPnL !== null ? (unrealizedPnL >= 0 ? "text-success" : "text-destructive") : "")}>
                                      {unrealizedPnL !== null ? `${unrealizedPnL >= 0 ? "+" : ""}$${unrealizedPnL.toFixed(2)}` : "—"}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Desktop: Table layout */}
                        <div className="hidden sm:block overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="border-border/10">
                                <TableHead className="text-[10px]">Ticker</TableHead>
                                <TableHead className="text-[10px]">Type</TableHead>
                                <TableHead className="text-[10px]">Entry</TableHead>
                                <TableHead className="text-[10px]">Current</TableHead>
                                <TableHead className="text-[10px]">Shares</TableHead>
                                <TableHead className="text-[10px]">P&L</TableHead>
                                <TableHead className="text-[10px]">P&L %</TableHead>
                                <TableHead className="text-[10px]">Opened</TableHead>
                                <TableHead className="text-[10px]"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {openPositions.map((pos) => {
                                const unrealizedPnL = getUnrealizedPnL(pos);
                                const unrealizedPnLPct = getUnrealizedPnLPct(pos);
                                const curPrice = currentPrices[pos.ticker];
                                const hasSellAlert = sellAlerts.some(a => a.ticker === pos.ticker);
                                return (
                                  <TableRow key={pos.id} className={cn("border-border/10", hasSellAlert && "bg-warning/5")}>
                                    <TableCell className="font-mono font-bold text-sm">
                                      <div className="flex items-center gap-2">{pos.ticker}{hasSellAlert && <AlertTriangle className="w-3 h-3 text-warning" />}</div>
                                    </TableCell>
                                    <TableCell><Badge variant="outline" className={cn("text-[10px]", pos.position_type === "long" ? "text-success" : "text-destructive")}>{pos.position_type}</Badge></TableCell>
                                    <TableCell className="font-mono text-sm">${Number(pos.entry_price).toFixed(2)}</TableCell>
                                    <TableCell className="font-mono text-sm">{curPrice ? `$${curPrice.toFixed(2)}` : pricesLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "—"}</TableCell>
                                    <TableCell className="font-mono text-sm">{Number(pos.shares).toFixed(2)}</TableCell>
                                    <TableCell>{unrealizedPnL !== null ? <span className={cn("font-mono font-bold text-sm", unrealizedPnL >= 0 ? "text-success" : "text-destructive")}>{unrealizedPnL >= 0 ? "+" : ""}${unrealizedPnL.toFixed(2)}</span> : "—"}</TableCell>
                                    <TableCell>{unrealizedPnLPct !== null ? <span className={cn("font-mono font-bold text-sm", unrealizedPnLPct >= 0 ? "text-success" : "text-destructive")}>{unrealizedPnLPct >= 0 ? "+" : ""}{unrealizedPnLPct.toFixed(2)}%</span> : "—"}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{new Date(pos.created_at).toLocaleDateString()}</TableCell>
                                    <TableCell>
                                      <Button
                                        size="sm"
                                        variant={hasSellAlert ? "destructive" : "outline"}
                                        className="text-xs h-7"
                                        onClick={() => {
                                          setSelectedPosition(pos);
                                          const alert = sellAlerts.find(a => a.ticker === pos.ticker);
                                          setSellPrice(alert ? alert.currentPrice.toFixed(2) : curPrice ? curPrice.toFixed(2) : "");
                                          setSellDialogOpen(true);
                                        }}
                                      >
                                        Close
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </Card>
                    )}

                    {/* Empty state if no positions and no signals */}
                    {openPositions.length === 0 && closedPositions.length === 0 && signals.length === 0 && (
                      <Card className="glass-card p-8 text-center">
                        <BarChart3 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                        <h3 className="text-lg font-medium mb-2">Welcome to the Trading Hub</h3>
                        <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
                          Scan the market to discover AI-powered trade signals, then register positions to track your portfolio performance.
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-lg mx-auto">
                          {[
                            { icon: Brain, label: "10+ Indicators" },
                            { icon: Sparkles, label: "AI Signals" },
                            { icon: Shield, label: "Regime Detection" },
                            { icon: Trophy, label: "P&L Tracking" },
                          ].map(({ icon: Icon, label }) => (
                            <div key={label} className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-secondary/30">
                              <Icon className="w-4 h-4 text-primary" />
                              <span className="text-[10px] text-muted-foreground">{label}</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}

                    {/* Collapsible Trade Log */}
                    {closedPositions.length > 0 && (
                      <Collapsible open={showTradeLog} onOpenChange={setShowTradeLog}>
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" className="w-full justify-between text-xs text-muted-foreground hover:text-foreground mb-2">
                            <span className="flex items-center gap-2">
                              <Clock className="w-3.5 h-3.5" />
                              {showTradeLog ? "Hide" : "Show"} Trade Log ({closedPositions.length} trades)
                            </span>
                            <ChevronDown className={cn("w-4 h-4 transition-transform", showTradeLog && "rotate-180")} />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <Card className="glass-card">
                            {/* Mobile: card layout */}
                            <div className="sm:hidden divide-y divide-border/20">
                              {closedPositions.map((pos) => (
                                <div key={pos.id} className="p-3 space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono font-bold text-sm">{pos.ticker}</span>
                                      <Badge variant="outline" className={cn("text-[9px]", pos.position_type === "long" ? "text-success" : "text-destructive")}>{pos.position_type}</Badge>
                                    </div>
                                    <span className={cn("font-mono font-bold text-sm", (Number(pos.pnl) || 0) >= 0 ? "text-success" : "text-destructive")}>
                                      {(Number(pos.pnl) || 0) >= 0 ? "+" : ""}${(Number(pos.pnl) || 0).toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                                    <span>${Number(pos.entry_price).toFixed(2)} → ${pos.exit_price ? Number(pos.exit_price).toFixed(2) : "—"}</span>
                                    <span>{pos.exit_reason || "—"}</span>
                                    <span className="ml-auto">{pos.closed_at ? new Date(pos.closed_at).toLocaleDateString() : "—"}</span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Desktop: table layout */}
                            <div className="hidden sm:block overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow className="border-border/10">
                                    <TableHead className="text-[10px]">Ticker</TableHead>
                                    <TableHead className="text-[10px]">Type</TableHead>
                                    <TableHead className="text-[10px]">Entry</TableHead>
                                    <TableHead className="text-[10px]">Exit</TableHead>
                                    <TableHead className="text-[10px]">Shares</TableHead>
                                    <TableHead className="text-[10px]">P&L</TableHead>
                                    <TableHead className="text-[10px]">Exit Reason</TableHead>
                                    <TableHead className="text-[10px]">Closed</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {closedPositions.map((pos) => (
                                    <TableRow key={pos.id} className="border-border/10">
                                      <TableCell className="font-mono font-bold text-sm">{pos.ticker}</TableCell>
                                      <TableCell><Badge variant="outline" className={cn("text-[10px]", pos.position_type === "long" ? "text-success" : "text-destructive")}>{pos.position_type}</Badge></TableCell>
                                      <TableCell className="font-mono text-sm">${Number(pos.entry_price).toFixed(2)}</TableCell>
                                      <TableCell className="font-mono text-sm">${pos.exit_price ? Number(pos.exit_price).toFixed(2) : "—"}</TableCell>
                                      <TableCell className="font-mono text-sm">{Number(pos.shares).toFixed(2)}</TableCell>
                                      <TableCell className={cn("font-mono font-bold text-sm", (Number(pos.pnl) || 0) >= 0 ? "text-success" : "text-destructive")}>
                                        {(Number(pos.pnl) || 0) >= 0 ? "+" : ""}${(Number(pos.pnl) || 0).toFixed(2)}
                                      </TableCell>
                                      <TableCell className="text-xs">{pos.exit_reason || "—"}</TableCell>
                                      <TableCell className="text-xs text-muted-foreground">{pos.closed_at ? new Date(pos.closed_at).toLocaleDateString() : "—"}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </Card>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
                </TabsContent>

                <TabsContent value="market">
                  <MarketTab />
                </TabsContent>

                <TabsContent value="sectors">
                  <SectorsTab />
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
