import { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { PredictionForm, PredictionMode } from "@/components/PredictionForm";
import { StockPredictionCard } from "@/components/StockPredictionCard";
import { StockComparisonView } from "@/components/StockComparisonView";
import { PriceTargetResult, PriceTargetData } from "@/components/PriceTargetResult";
import { MetricCard } from "@/components/MetricCard";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Brain, TrendingUp, TrendingDown, Shield, Sparkles, Layers, LayoutGrid,
  Loader2, AlertTriangle, RefreshCw, Zap, DollarSign, Target,
  ArrowUpRight, ArrowDownRight, Package, BarChart3, Clock, CheckCircle2, Bell,
  Trophy, Percent, ChevronDown, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchWithErrorHandling, handleResponseError, showErrorToast } from "@/lib/api-error";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

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
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ─ Analyze tab state ─
  const [isLoading, setIsLoading] = useState(false);
  const [predictions, setPredictions] = useState<PredictionData[]>([]);
  const [priceTargetResult, setPriceTargetResult] = useState<PriceTargetData | null>(null);
  const [lastFormData, setLastFormData] = useState<{ ticker: string; targetDate?: Date; targetPrice?: number; mode: PredictionMode } | null>(null);
  const [initialTicker, setInitialTicker] = useState("");
  const [viewMode, setViewMode] = useState<'single' | 'compare'>('single');

  // ─ Signals tab state ─
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

  // ─ Active tab ─
  const [activeTab, setActiveTab] = useState("analyze");

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

  // Portfolio analytics
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

  // Drawdown from portfolio history
  const drawdownData = useMemo(() => {
    if (portfolioHistory.length < 2) return [];
    let peak = portfolioHistory[0].total_value;
    return portfolioHistory.map(snap => {
      if (snap.total_value > peak) peak = snap.total_value;
      const dd = peak > 0 ? ((snap.total_value - peak) / peak) * 100 : 0;
      return { date: snap.date, drawdown: dd };
    });
  }, [portfolioHistory]);

  // ── URL param for ticker ─────────────────────────────────────────────────────
  useEffect(() => {
    const t = searchParams.get("ticker");
    if (t) setInitialTicker(t.toUpperCase());
  }, [searchParams]);

  useEffect(() => {
    setViewMode(predictions.length > 1 ? 'compare' : 'single');
  }, [predictions.length]);

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
    if ((signals.length > 0 || openPositions.length > 0) && predictions.length === 0 && !priceTargetResult) {
      setActiveTab("signals");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (activeTab === "portfolio" && openPositions.length > 0) fetchCurrentPrices();
  }, [activeTab, openPositions.length, fetchCurrentPrices]);

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

  // ── Prediction submit ────────────────────────────────────────────────────────

  const handleSubmit = async (data: { ticker: string; targetDate?: Date; targetPrice?: number; mode: PredictionMode }) => {
    if (!session?.access_token) {
      toast.error("Please sign in to generate predictions");
      navigate("/auth");
      return;
    }
    setIsLoading(true);
    setLastFormData(data);

    try {
      if (data.mode === 'price' && data.targetPrice) {
        setPriceTargetResult(null);
        const response = await fetchWithErrorHandling(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stock-predict`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ ticker: data.ticker, targetPrice: data.targetPrice, mode: 'price-target' }),
            timeoutMs: 60000,
          }
        );
        if (!response.ok) await handleResponseError(response, navigate);
        const result: PriceTargetData = await response.json();
        setPriceTargetResult(result);
        setPredictions([]);
        toast.success(`Timeline estimated for ${data.ticker}`);
      } else if (data.targetDate) {
        setPriceTargetResult(null);
        const response = await fetchWithErrorHandling(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stock-predict`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ ticker: data.ticker, targetDate: format(data.targetDate, "yyyy-MM-dd") }),
            timeoutMs: 60000,
          }
        );
        if (!response.ok) await handleResponseError(response, navigate);
        const result: PredictionData = await response.json();

        setPredictions(prev => {
          const idx = prev.findIndex(p => p.ticker === result.ticker);
          if (idx !== -1) { const u = [...prev]; u[idx] = result; return u; }
          if (prev.length >= 6) { toast.info("Maximum 6 stocks. Removing oldest."); return [...prev.slice(1), result]; }
          return [...prev, result];
        });

        if (user) {
          await supabase.from("prediction_runs").insert({
            user_id: user.id, ticker: result.ticker, target_date: result.targetDate,
            predicted_price: result.predictedPrice, uncertainty_low: result.uncertaintyLow,
            uncertainty_high: result.uncertaintyHigh, confidence: result.confidence,
            current_price: result.currentPrice, feature_importance: result.featureImportance,
            historical_data: result.historicalData, regime: result.regime, sentiment_score: result.sentimentScore,
          });
        }
        toast.success(`Analysis complete for ${data.ticker}`);
      }
    } catch (error) {
      console.error("Prediction error:", error);
      showErrorToast(error, "Failed to generate prediction");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    if (lastFormData) await handleSubmit(lastFormData);
  }, [lastFormData, session?.access_token]);

  const handleRemovePrediction = (index: number) => {
    setPredictions(prev => prev.filter((_, i) => i !== index));
    toast.success("Stock removed from comparison");
  };

  const handleClearAll = () => {
    setPredictions([]);
    setPriceTargetResult(null);
    setViewMode('single');
    toast.success("All predictions cleared");
  };

  // ── Market scan ──────────────────────────────────────────────────────────────

  const runScan = async () => {
    if (!user) { toast.error("Please sign in to scan the market"); return; }
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
        if (data.sellSignals?.length > 0) collectedSellAlerts.push(...data.sellSignals);
        done = data.done;
        batch++;
        if (!done) await new Promise(r => setTimeout(r, 500));
      }

      setSellAlerts(collectedSellAlerts);
      setLastScanTime(new Date().toISOString());
      if (collectedSellAlerts.length > 0) toast.warning(`${collectedSellAlerts.length} sell alert(s) for your positions!`, { duration: 8000 });
      toast.success(`Scan complete! Found ${totalSignals} signals across ${batch} batches`);
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
      setSellAlerts(prev => prev.filter(a => a.ticker !== selectedPosition.ticker));
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
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h1 className="text-xl sm:text-2xl font-medium mb-1">Dashboard</h1>
                <p className="text-xs sm:text-sm text-muted-foreground">
                  Analyze stocks, track signals & manage positions
                  {lastScanTime && (
                    <span className="ml-2 text-xs">• Last scan: {new Date(lastScanTime).toLocaleTimeString()}</span>
                  )}
                </p>
              </div>
              <Button variant="glow" onClick={runScan} disabled={scanning || !user} className="gap-2">
                {scanning ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Scanning {scanProgress.batch}/{scanProgress.total}...</>
                ) : (
                  <><RefreshCw className="w-4 h-4" />Scan Market</>
                )}
              </Button>
            </div>

            {/* Stats Row — MetricCard style */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-5">
              <MetricCard icon={TrendingUp} label="Buy Signals" value={buySignals.length} color="text-success" />
              <MetricCard icon={Package} label="Open Positions" value={openPositions.length} color="text-primary" />
              <MetricCard icon={DollarSign} label="Portfolio Value" value={`$${totalPortfolioValue.toFixed(0)}`} />
              <MetricCard
                icon={TrendingUp}
                label="Unrealized P&L"
                value={`${totalUnrealizedPnL >= 0 ? "+" : ""}$${totalUnrealizedPnL.toFixed(2)}`}
                color={totalUnrealizedPnL >= 0 ? "text-success" : "text-destructive"}
              />
              <MetricCard
                icon={Target}
                label="Realized P&L"
                value={`${totalRealizedPnL >= 0 ? "+" : ""}$${totalRealizedPnL.toFixed(2)}`}
                color={totalRealizedPnL >= 0 ? "text-success" : "text-destructive"}
              />
              <MetricCard
                icon={Trophy}
                label="Win Rate"
                value={closedPositions.length > 0 ? `${winRate.toFixed(1)}` : "—"}
                suffix={closedPositions.length > 0 ? "%" : ""}
                color={winRate >= 50 ? "text-success" : winRate > 0 ? "text-destructive" : "text-muted-foreground"}
                subtext={closedPositions.length > 0 ? `${closedPositions.length} trades` : "No closed trades"}
              />
            </div>
          </motion.div>

          {/* Sell Alerts Banner */}
          <AnimatePresence>
            {sellAlerts.length > 0 && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-6">
                <Card className="border-warning/50 bg-warning/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2 text-warning">
                      <Bell className="w-4 h-4" />Sell Alerts ({sellAlerts.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {sellAlerts.map((alert, i) => (
                      <div key={`${alert.ticker}-${i}`} className="flex items-center justify-between p-3 rounded-lg bg-warning/10 border border-warning/20">
                        <div className="flex items-center gap-3">
                          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                          <div>
                            <span className="font-mono font-bold">{alert.ticker}</span>
                            <span className="text-sm text-muted-foreground ml-2">{alert.reason}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm">${alert.currentPrice.toFixed(2)}</span>
                          <Button size="sm" variant="destructive" onClick={() => handleSellAlertClose(alert)}>Close Position</Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Tabs ──────────────────────────────────────────────────────────── */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6 flex-wrap h-auto gap-1">
              <TabsTrigger value="analyze" className="gap-1.5 text-xs sm:text-sm">
                <Brain className="w-4 h-4" />Analyze
              </TabsTrigger>
              <TabsTrigger value="signals" className="gap-1.5 text-xs sm:text-sm">
                <Zap className="w-4 h-4" />Signals
                {signals.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 h-4">{signals.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="portfolio" className="gap-1.5 text-xs sm:text-sm">
                <Package className="w-4 h-4" />Portfolio
                {sellAlerts.length > 0 && (
                  <span className="ml-1 w-4 h-4 rounded-full bg-warning text-warning-foreground text-[10px] flex items-center justify-center">{sellAlerts.length}</span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* ── Analyze Tab ──────────────────────────────────────────────────── */}
            <TabsContent value="analyze">
              {predictions.length > 0 && (
                <div className="flex items-center gap-2 mb-4">
                  {predictions.length > 1 && (
                    <div className="flex items-center gap-1 p-1 bg-secondary/50 rounded-lg">
                      <Button variant="ghost" size="sm" onClick={() => setViewMode('single')} className={cn("h-7 px-2 text-xs gap-1", viewMode === 'single' && "bg-background shadow-sm")}>
                        <LayoutGrid className="w-3 h-3" /><span className="hidden sm:inline">Single</span>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setViewMode('compare')} className={cn("h-7 px-2 text-xs gap-1", viewMode === 'compare' && "bg-background shadow-sm")}>
                        <Layers className="w-3 h-3" /><span className="hidden sm:inline">Compare</span>
                      </Button>
                    </div>
                  )}
                  <Badge variant="outline" className="text-xs">{predictions.length}/6</Badge>
                  <Button variant="ghost" size="sm" onClick={handleClearAll} className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive">Clear All</Button>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
                <div className="lg:col-span-4 xl:col-span-3">
                  <div className="sticky top-20">
                    <PredictionForm onSubmit={handleSubmit} isLoading={isLoading} initialTicker={initialTicker} />
                    {predictions.length === 0 && !priceTargetResult && (
                      <div className="mt-4 p-4 border border-border/30 rounded-lg">
                        <p className="text-xs text-muted-foreground">
                          <span className="text-primary font-medium">Tip:</span> Add multiple stocks to compare them side by side. Up to 6 stocks supported.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-8 xl:col-span-9">
                  <AnimatePresence mode="wait">
                    {priceTargetResult ? (
                      <motion.div key="price-target" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <PriceTargetResult data={priceTargetResult} />
                      </motion.div>
                    ) : predictions.length === 0 ? (
                      <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                        <div className="glass-card p-6 sm:p-8">
                          <h3 className="text-base sm:text-lg font-medium mb-6 flex items-center gap-2">
                            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />How StockAI Works
                          </h3>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                            <div className="space-y-3">
                              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><TrendingUp className="w-4 h-4 text-primary" /></div>
                              <h4 className="text-xs sm:text-sm font-medium">Real Market Data</h4>
                              <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">We pull live price data and compute technical indicators like RSI, MACD, EMA, and volatility metrics.</p>
                            </div>
                            <div className="space-y-3">
                              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><Brain className="w-4 h-4 text-primary" /></div>
                              <h4 className="text-xs sm:text-sm font-medium">AI Analysis</h4>
                              <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">Advanced AI models analyze patterns, market regime, and sentiment to generate predictions.</p>
                            </div>
                            <div className="space-y-3">
                              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center"><Shield className="w-4 h-4 text-primary" /></div>
                              <h4 className="text-xs sm:text-sm font-medium">Risk Assessment</h4>
                              <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">Every prediction includes uncertainty ranges and confidence levels.</p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-start gap-3 p-4 border border-border/30 rounded-lg">
                          <Shield className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                          <p className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
                            <span className="font-medium text-foreground">Important:</span> StockAI provides AI-generated analysis for informational purposes only. This is not financial advice.
                          </p>
                        </div>
                      </motion.div>
                    ) : predictions.length === 1 && viewMode === 'single' ? (
                      <motion.div key="single" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <StockPredictionCard data={predictions[0]} />
                      </motion.div>
                    ) : (
                      <motion.div key="compare" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <StockComparisonView predictions={predictions} onRemove={handleRemovePrediction} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </TabsContent>

            {/* ── Signals Tab ──────────────────────────────────────────────────── */}
            <TabsContent value="signals">
              <AnimatePresence mode="wait">
                {signalsLoading ? (
                  <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                ) : signals.length === 0 ? (
                  <Card variant="glass" className="p-12 text-center">
                    <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No Active Signals</h3>
                    <p className="text-muted-foreground mb-6">Click "Scan Market" to analyze 75 stocks across all sectors</p>
                    <Button variant="glow" onClick={runScan} disabled={scanning || !user}><RefreshCw className="w-4 h-4 mr-2" />Run First Scan</Button>
                  </Card>
                ) : (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                    {signals.map((signal, idx) => (
                      <motion.div key={signal.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
                        <Card variant="glass" className="hover:border-primary/30 transition-all">
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between flex-wrap gap-3">
                              <div className="flex items-center gap-4 flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  {signal.signal_type === "BUY" ? <ArrowUpRight className="w-5 h-5 text-success" /> : <ArrowDownRight className="w-5 h-5 text-destructive" />}
                                  <span className="text-lg font-bold font-mono">{signal.ticker}</span>
                                  <Badge variant="outline" className={signal.signal_type === "BUY" ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30"}>
                                    {signal.signal_type}
                                  </Badge>
                                </div>
                                <div className="hidden sm:flex items-center gap-2">
                                  <Badge variant="outline" className={getRegimeBadge(signal.regime)}>{signal.regime?.replace("_", " ")}</Badge>
                                  <Badge variant="outline" className="text-xs">{signal.stock_profile}</Badge>
                                  <Badge variant="outline" className="text-xs">{signal.strategy}</Badge>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  <div className="text-[10px] text-muted-foreground uppercase">Entry</div>
                                  <div className="font-mono font-semibold text-sm">${Number(signal.entry_price).toFixed(2)}</div>
                                </div>
                                <div className="text-right min-w-[60px]">
                                  <div className="text-[10px] text-muted-foreground uppercase">Conviction</div>
                                  <div className={cn("font-mono font-bold text-sm", getConfidenceColor(signal.confidence))}>{signal.confidence}%</div>
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

                            {/* Conviction bar + Allocation */}
                            <div className="mt-3 flex items-center gap-4">
                              <div className="flex-1">
                                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                  <div
                                    className={cn("h-full rounded-full transition-all", getConfidenceBg(signal.confidence))}
                                    style={{ width: `${signal.confidence}%` }}
                                  />
                                </div>
                              </div>
                              {signal.target_allocation > 0 && (
                                <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                                  Alloc: {signal.target_allocation}%
                                </span>
                              )}
                            </div>

                            {/* Mobile badges */}
                            <div className="flex sm:hidden items-center gap-2 mt-2 flex-wrap">
                              <Badge variant="outline" className={cn("text-[10px]", getRegimeBadge(signal.regime))}>{signal.regime?.replace("_", " ")}</Badge>
                              <Badge variant="outline" className="text-[10px]">{signal.stock_profile}</Badge>
                              <Badge variant="outline" className="text-[10px]">{signal.strategy}</Badge>
                            </div>

                            {signal.reasoning && (
                              <p className="text-xs text-muted-foreground mt-2 border-t border-border/30 pt-2">{signal.reasoning}</p>
                            )}
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </TabsContent>

            {/* ── Portfolio Tab ─────────────────────────────────────────────────── */}
            <TabsContent value="portfolio">
              {/* Performance Metrics Row (from closed trades) */}
              {closedPositions.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  <MetricCard
                    icon={Trophy}
                    label="Win Rate"
                    value={`${winRate.toFixed(1)}`}
                    suffix="%"
                    color={winRate >= 50 ? "text-success" : "text-destructive"}
                    subtext={`${closedPositions.filter(p => (Number(p.pnl) || 0) > 0).length}W / ${closedPositions.filter(p => (Number(p.pnl) || 0) <= 0).length}L`}
                  />
                  <MetricCard
                    icon={TrendingUp}
                    label="Avg Win"
                    value={`+$${avgWin.toFixed(2)}`}
                    color="text-success"
                  />
                  <MetricCard
                    icon={TrendingDown}
                    label="Avg Loss"
                    value={`$${avgLoss.toFixed(2)}`}
                    color="text-destructive"
                  />
                  <MetricCard
                    icon={Activity}
                    label="Profit Factor"
                    value={profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}
                    color={profitFactor >= 1.5 ? "text-success" : profitFactor >= 1 ? "text-primary" : "text-destructive"}
                  />
                </div>
              )}

              {/* Equity Curve + Drawdown */}
              {portfolioHistory.length > 1 && (
                <Card className="glass-card mb-6">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-primary" />Equity Curve
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="h-48">
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

                    {/* Drawdown */}
                    {drawdownData.length > 0 && (
                      <div className="h-24">
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
                  </CardContent>
                </Card>
              )}

              {/* Open Positions */}
              {openPositions.length === 0 && closedPositions.length === 0 ? (
                <Card variant="glass" className="p-12 text-center">
                  <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Positions Yet</h3>
                  <p className="text-muted-foreground">Register a buy from the Signals tab to start tracking</p>
                </Card>
              ) : openPositions.length > 0 && (
                <Card className="glass-card mb-6">
                  <div className="p-4 border-b border-border/30 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
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
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/10">
                        <TableHead className="text-[10px]">Ticker</TableHead>
                        <TableHead className="text-[10px]">Type</TableHead>
                        <TableHead className="text-[10px]">Entry</TableHead>
                        <TableHead className="text-[10px]">Current</TableHead>
                        <TableHead className="text-[10px]">Shares</TableHead>
                        <TableHead className="text-[10px]">Unrealized P&L</TableHead>
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
                </Card>
              )}

              {/* Collapsible Trade Log (closed positions) */}
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
                    </Card>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </TabsContent>
          </Tabs>
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
