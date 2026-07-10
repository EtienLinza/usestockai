import { useMemo, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { MetricCard } from "@/components/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Brain, TrendingUp, TrendingDown, Shield,
  Loader2, AlertTriangle, RefreshCw, Zap, DollarSign, Target,
  ArrowUpRight, ArrowDownRight, Package, BarChart3, Clock, Bell,
  Trophy, ChevronDown, Activity, Sparkles, Trash2, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TickerLink } from "@/components/TickerLink";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExportDialog } from "@/components/ExportDialog";


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
  explanation?: string | null;
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

interface TradingTabProps {
  signals: Signal[];
  signalsLoading: boolean;
  scanning: boolean;
  scanProgress: { batch: number; total: number };
  openPositions: Position[];
  closedPositions: Position[];
  currentPrices: Record<string, number>;
  pricesLoading: boolean;
  sellAlerts: SellAlert[];
  portfolioHistory: PortfolioSnapshot[];
  showTradeLog: boolean;
  setShowTradeLog: (v: boolean) => void;
  user: any;
  tradingStyle: string;
  setTradingStyle: (v: string) => void;
  runScan: () => void;
  onClearSignals: () => void;
  fetchCurrentPrices: () => void;
  onRegisterSignal: (signal: Signal) => void;
  onClosePosition: (position: Position, price?: string) => void;
  onDismissAlert: (alert: SellAlert) => void;
  onSellAlertClose: (alert: SellAlert) => void;
}

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

// Danelfin AI Score record (subset of danelfin_scores row used by the UI).
interface DanelfinRow {
  ai_score: number;
  technical: number | null;
  fundamental: number | null;
  sentiment: number | null;
  low_risk: number | null;
  as_of: string;
}

// Hook: fetch Danelfin AI Scores for a list of tickers (≤7 days fresh).
// Returns map ticker → row. Missing tickers simply omitted.
function useDanelfinScores(tickers: string[]): Record<string, DanelfinRow> {
  const [scores, setScores] = useState<Record<string, DanelfinRow>>({});
  const key = tickers.slice().sort().join(",");
  useEffect(() => {
    if (tickers.length === 0) return;
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("danelfin_scores")
        .select("ticker, ai_score, technical, fundamental, sentiment, low_risk, as_of")
        .in("ticker", Array.from(new Set(tickers.map(t => t.toUpperCase()))))
        .gte("as_of", cutoff)
        .order("as_of", { ascending: false });
      if (cancelled || !data) return;
      const m: Record<string, DanelfinRow> = {};
      for (const r of data as Array<DanelfinRow & { ticker: string }>) {
        if (!(r.ticker in m)) {
          m[r.ticker] = {
            ai_score: r.ai_score,
            technical: r.technical,
            fundamental: r.fundamental,
            sentiment: r.sentiment,
            low_risk: r.low_risk,
            as_of: r.as_of,
          };
        }
      }
      setScores(m);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return scores;
}

const danelfinBadgeClass = (score: number) => {
  if (score >= 8) return "bg-primary/20 text-primary border-primary/30";
  if (score >= 6) return "bg-primary/10 text-primary border-primary/20";
  if (score <= 3) return "bg-destructive/10 text-destructive border-destructive/20";
  return "bg-muted/30 text-muted-foreground border-border/30";
};

const SubScore = ({ label, value }: { label: string; value: number | null }) => (
  <div className="flex items-center justify-between text-[11px]">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-mono font-medium text-foreground">{value ?? "—"}</span>
  </div>
);

function DanelfinBadge({ row }: { row: DanelfinRow }) {
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <Badge
          variant="outline"
          className={cn("text-[10px] font-mono cursor-help", danelfinBadgeClass(row.ai_score))}
        >
          AI {row.ai_score}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent className="w-56 p-3 space-y-2" align="start" side="top">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Danelfin AI Score</span>
          <span className={cn("text-xs font-mono font-bold", row.ai_score >= 6 ? "text-primary" : row.ai_score <= 3 ? "text-destructive" : "text-muted-foreground")}>
            {row.ai_score}/10
          </span>
        </div>
        <div className="space-y-1 border-t border-border/40 pt-2">
          <SubScore label="Technical" value={row.technical} />
          <SubScore label="Fundamental" value={row.fundamental} />
          <SubScore label="Sentiment" value={row.sentiment} />
          {row.low_risk !== null && <SubScore label="Low Risk" value={row.low_risk} />}
        </div>
        <div className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
          Supporting factor only — never blocks signals. As of {row.as_of}.
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}


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

// ── Market Regime Badge ────────────────────────────────────────────────────
// Reads the most recent row from `market_regime` and renders a small chip.
// Hidden when no data exists (cold start, never trained).
function MarketRegimeBadge() {
  const [data, setData] = useState<{ regime: string; atr_pct: number | null; sma_ratio: number | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: row } = await supabase
        .from("market_regime")
        .select("regime, atr_pct, sma_ratio")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && row) setData(row as any);
    })();
    return () => { cancelled = true; };
  }, []);
  if (!data) return null;
  const label = data.regime.replace("_", " ");
  const tone = data.regime.startsWith("bull")
    ? "bg-success/10 text-success border-success/30"
    : data.regime.startsWith("bear")
    ? "bg-destructive/10 text-destructive border-destructive/30"
    : "bg-muted text-muted-foreground border-border";
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <div className="inline-flex items-center gap-2 cursor-help">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Market regime</span>
          <Badge variant="outline" className={cn("text-[11px] capitalize", tone)}>{label}</Badge>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-72 text-xs space-y-1">
        <div className="font-semibold text-sm capitalize">{label}</div>
        <div className="text-muted-foreground">
          Daily SPY-derived market state used to softly tilt strategy weights (±15%).
        </div>
        {data.atr_pct !== null && <div>SPY ATR%: <span className="font-mono">{Number(data.atr_pct).toFixed(2)}%</span></div>}
        {data.sma_ratio !== null && <div>50d / 200d: <span className="font-mono">{Number(data.sma_ratio).toFixed(4)}</span></div>}
      </HoverCardContent>
    </HoverCard>
  );
}

// Surfaces the most recent ADWIN drift event within the last 48h. Hidden
// when no drift has fired (the default healthy state).
function DriftBadge() {
  const [data, setData] = useState<{ severity: string; pre_mean: number; post_mean: number; detected_at: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
      const { data: row } = await supabase
        .from("drift_events")
        .select("severity, pre_mean, post_mean, detected_at")
        .gte("detected_at", cutoff)
        .order("detected_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled && row) setData(row as any);
    })();
    return () => { cancelled = true; };
  }, []);
  if (!data) return null;
  const tone = data.severity === "hard"
    ? "bg-destructive/10 text-destructive border-destructive/30"
    : "bg-warning/10 text-warning border-warning/30";
  const delta = ((data.post_mean - data.pre_mean) * 100).toFixed(1);
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <div className="inline-flex items-center gap-2 cursor-help">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Drift</span>
          <Badge variant="outline" className={cn("text-[11px] capitalize", tone)}>{data.severity}</Badge>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-72 text-xs space-y-1">
        <div className="font-semibold text-sm">Concept drift detected</div>
        <div className="text-muted-foreground">
          Live hit-rate has shifted relative to the recent baseline. Meta-label gate has been tightened automatically.
        </div>
        <div>Pre-mean: <span className="font-mono">{(data.pre_mean * 100).toFixed(1)}%</span></div>
        <div>Post-mean: <span className="font-mono">{(data.post_mean * 100).toFixed(1)}%</span></div>
        <div>Δ: <span className="font-mono">{delta}pp</span></div>
      </HoverCardContent>
    </HoverCard>
  );
}




const TRADING_STYLES = [
  { value: "all", label: "All Signals" },
  { value: "scalping", label: "Scalping" },
  { value: "day", label: "Day Trading" },
  { value: "swing", label: "Swing Trading" },
  { value: "position", label: "Position Trading" },
];

function matchesTradingStyle(signal: Signal, style: string): boolean {
  if (style === "all") return true;
  const profile = (signal.stock_profile || "").toLowerCase();
  const strategy = (signal.strategy || "").toLowerCase();
  const confidence = signal.confidence;

  switch (style) {
    case "scalping":
      return profile.includes("volatile") || profile.includes("momentum") || strategy.includes("breakout");
    case "day":
      return profile.includes("growth") || profile.includes("momentum") || strategy.includes("mean_reversion") || strategy.includes("breakout");
    case "swing":
      return profile.includes("balanced") || profile.includes("growth") || strategy.includes("trend") || confidence >= 70;
    case "position":
      return profile.includes("stable") || profile.includes("value") || profile.includes("dividend") || confidence >= 75;
    default:
      return true;
  }
}

export function TradingTab({
  signals, signalsLoading, scanning, scanProgress,
  openPositions, closedPositions, currentPrices, pricesLoading,
  sellAlerts, portfolioHistory, showTradeLog, setShowTradeLog,
  user, tradingStyle, setTradingStyle,
  runScan, onClearSignals, fetchCurrentPrices, onRegisterSignal, onClosePosition, onDismissAlert, onSellAlertClose,
}: TradingTabProps) {
  const [exportOpen, setExportOpen] = useState(false);

  const buySignals = useMemo(() => signals.filter(s => s.signal_type === "BUY"), [signals]);


  const filteredSignals = useMemo(() => {
    return signals.filter(s => matchesTradingStyle(s, tradingStyle));
  }, [signals, tradingStyle]);

  // Danelfin AI Scores for visible signals + open positions (supporting badge).
  const danelfinTickers = useMemo(
    () => Array.from(new Set([...filteredSignals.map(s => s.ticker), ...openPositions.map(p => p.ticker)])),
    [filteredSignals, openPositions],
  );
  const danelfinScores = useDanelfinScores(danelfinTickers);


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

  // Profit factor folds in unrealized P&L on open positions so a massive
  // open drawdown can't be hidden behind a clean closed-trade ledger.
  const profitFactor = useMemo(() => {
    let grossProfit = closedPositions.filter(p => (Number(p.pnl) || 0) > 0).reduce((s, p) => s + Number(p.pnl), 0);
    let grossLoss = Math.abs(closedPositions.filter(p => (Number(p.pnl) || 0) < 0).reduce((s, p) => s + Number(p.pnl), 0));
    for (const pos of openPositions) {
      const price = currentPrices[pos.ticker];
      if (!price) continue;
      const u = pos.position_type === "long"
        ? (price - Number(pos.entry_price)) * Number(pos.shares)
        : (Number(pos.entry_price) - price) * Number(pos.shares);
      if (u > 0) grossProfit += u;
      else if (u < 0) grossLoss += Math.abs(u);
    }
    return grossLoss === 0 ? grossProfit > 0 ? Infinity : 0 : grossProfit / grossLoss;
  }, [closedPositions, openPositions, currentPrices]);

  const drawdownData = useMemo(() => {
    if (portfolioHistory.length < 2) return [];
    let peak = portfolioHistory[0].total_value;
    return portfolioHistory.map(snap => {
      if (snap.total_value > peak) peak = snap.total_value;
      const dd = peak > 0 ? ((snap.total_value - peak) / peak) * 100 : 0;
      return { date: snap.date, drawdown: dd };
    });
  }, [portfolioHistory]);

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

  // Performance metrics
  const bestTrade = useMemo(() => {
    if (closedPositions.length === 0) return null;
    return closedPositions.reduce((best, p) => (Number(p.pnl) || 0) > (Number(best.pnl) || 0) ? p : best, closedPositions[0]);
  }, [closedPositions]);

  const worstTrade = useMemo(() => {
    if (closedPositions.length === 0) return null;
    return closedPositions.reduce((worst, p) => (Number(p.pnl) || 0) < (Number(worst.pnl) || 0) ? p : worst, closedPositions[0]);
  }, [closedPositions]);

  const avgHoldTime = useMemo(() => {
    const withDates = closedPositions.filter(p => p.created_at && p.closed_at);
    if (withDates.length === 0) return null;
    const totalMs = withDates.reduce((sum, p) => {
      return sum + (new Date(p.closed_at!).getTime() - new Date(p.created_at).getTime());
    }, 0);
    const avgDays = totalMs / withDates.length / (1000 * 60 * 60 * 24);
    return avgDays;
  }, [closedPositions]);

  return (
    <AnimatePresence mode="wait">
      {signalsLoading ? (
        <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card p-12 text-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading signals & positions...</p>
        </motion.div>
      ) : (
        <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">

          {/* Market regime badge */}
          <MarketRegimeBadge />
          <DriftBadge />


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

          {/* Performance details moved below positions for better information hierarchy */}


          {/* Active Signals */}
          <Card className="glass-card">
            <div className="p-4 border-b border-border/30 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Active Signals</span>
                {filteredSignals.length > 0 && <Badge variant="secondary" className="text-[10px] px-1.5 h-4">{filteredSignals.length}</Badge>}
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                <Select value={tradingStyle} onValueChange={setTradingStyle}>
                  <SelectTrigger className="h-7 w-[120px] sm:w-[140px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRADING_STYLES.map(s => (
                      <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={runScan} disabled={scanning || !user} className="gap-1.5 text-xs h-7 px-2">
                  {scanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  Scan
                </Button>
                {signals.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={onClearSignals} disabled={!user} className="gap-1.5 text-xs h-7 px-2 text-destructive hover:text-destructive">
                    <Trash2 className="w-3 h-3" />
                    <span className="hidden sm:inline">Clear</span>
                  </Button>
                )}
              </div>
            </div>

            {filteredSignals.length === 0 ? (
              <div className="p-8 text-center">
                <Zap className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <h3 className="text-sm font-medium mb-1">{tradingStyle !== "all" ? "No Matching Signals" : "No Active Signals"}</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  {tradingStyle !== "all" ? `No signals match the ${TRADING_STYLES.find(s => s.value === tradingStyle)?.label} style. Try a different filter or scan again.` : 'Click "Scan Market" to analyze 6,000+ stocks across all sectors'}
                </p>
                {tradingStyle === "all" && (
                  <Button variant="glow" size="sm" onClick={runScan} disabled={scanning || !user}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Run First Scan
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border/20">
                {filteredSignals.map((signal, idx) => (
                  <motion.div key={signal.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.02 }} className="p-3 sm:p-4 hover:bg-muted/5 transition-colors">
                    <div className="flex items-start sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {signal.signal_type === "BUY" ? <ArrowUpRight className="w-4 h-4 sm:w-5 sm:h-5 text-success shrink-0" /> : <ArrowDownRight className="w-4 h-4 sm:w-5 sm:h-5 text-destructive shrink-0" />}
                        <TickerLink ticker={signal.ticker} className="text-base sm:text-lg font-bold font-mono" />
                        <Badge variant="outline" className={cn("text-[10px]", signal.signal_type === "BUY" ? "bg-success/10 text-success border-success/30" : "bg-destructive/10 text-destructive border-destructive/30")}>
                          {signal.signal_type}
                        </Badge>
                        {danelfinScores[signal.ticker.toUpperCase()] !== undefined && (
                          <DanelfinBadge row={danelfinScores[signal.ticker.toUpperCase()]} />
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={signal.signal_type === "BUY" ? "success" : "destructive"}
                        className="text-xs h-7 shrink-0"
                        onClick={() => onRegisterSignal(signal)}
                      >
                        Register
                      </Button>
                    </div>

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

                    <div className="mt-2 ml-6 sm:ml-0">
                      <div className="h-1 sm:h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", getConfidenceBg(signal.confidence))} style={{ width: `${signal.confidence}%` }} />
                      </div>
                    </div>

                    <div className="flex sm:hidden items-center gap-1.5 mt-2 ml-6 flex-wrap">
                      <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", getRegimeBadge(signal.regime))}>{signal.regime?.replace("_", " ")}</Badge>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">{signal.stock_profile}</Badge>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0">{signal.strategy}</Badge>
                    </div>

                    {signal.reasoning && (
                      <p className="text-[11px] sm:text-xs text-muted-foreground mt-2 border-t border-border/10 pt-2 ml-6 sm:ml-0 line-clamp-2 sm:line-clamp-none">{signal.reasoning}</p>
                    )}

                    {signal.explanation && (
                      <HoverCard openDelay={120} closeDelay={80}>
                        <HoverCardTrigger asChild>
                          <button
                            type="button"
                            className="mt-1.5 ml-6 sm:ml-0 inline-flex items-center gap-1 text-[10px] sm:text-[11px] text-primary/80 hover:text-primary underline-offset-2 hover:underline cursor-help"
                            aria-label="Why this signal fired"
                          >
                            <span className="font-mono">?</span>
                            <span>Why this signal</span>
                          </button>
                        </HoverCardTrigger>
                        <HoverCardContent className="w-72 p-3 text-xs leading-relaxed" align="start" side="top">
                          {signal.explanation}
                        </HoverCardContent>
                      </HoverCard>
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

              {/* Mobile */}
              <div className="sm:hidden divide-y divide-border/20">
                {openPositions.map((pos) => {
                  const unrealizedPnL = getUnrealizedPnL(pos);
                  const curPrice = currentPrices[pos.ticker];
                  const hasSellAlert = sellAlerts.some(a => a.ticker === pos.ticker);
                  return (
                    <div key={pos.id} className={cn("p-3 space-y-2", hasSellAlert && "bg-warning/5")}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <TickerLink ticker={pos.ticker} className="font-mono font-bold text-sm" />
                          {hasSellAlert && <AlertTriangle className="w-3 h-3 text-warning" />}
                          <Badge variant="outline" className={cn("text-[9px]", pos.position_type === "long" ? "text-success" : "text-destructive")}>{pos.position_type}</Badge>
                        </div>
                        <Button
                          size="sm"
                          variant={hasSellAlert ? "destructive" : "outline"}
                          className="text-xs h-7"
                          onClick={() => {
                            const alert = sellAlerts.find(a => a.ticker === pos.ticker);
                            onClosePosition(pos, alert ? alert.currentPrice.toFixed(2) : curPrice ? curPrice.toFixed(2) : "");
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

              {/* Desktop */}
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
                            <div className="flex items-center gap-2"><TickerLink ticker={pos.ticker} />{hasSellAlert && <AlertTriangle className="w-3 h-3 text-warning" />}</div>
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
                                const alert = sellAlerts.find(a => a.ticker === pos.ticker);
                                onClosePosition(pos, alert ? alert.currentPrice.toFixed(2) : curPrice ? curPrice.toFixed(2) : "");
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


          {/* === Performance details (moved below the actionable sections) === */}

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

          {/* Performance Summary Card */}
          {closedPositions.length >= 3 && (
            <Card className="glass-card p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Performance Summary</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <div className="text-muted-foreground mb-1">Best Trade</div>
                  <div className="font-mono font-bold text-success">
                    {bestTrade ? `${bestTrade.ticker} +$${Number(bestTrade.pnl).toFixed(2)}` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Worst Trade</div>
                  <div className="font-mono font-bold text-destructive">
                    {worstTrade ? `${worstTrade.ticker} $${Number(worstTrade.pnl).toFixed(2)}` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Avg Hold Time</div>
                  <div className="font-mono font-medium">
                    {avgHoldTime !== null ? (avgHoldTime < 1 ? `${(avgHoldTime * 24).toFixed(0)}h` : `${avgHoldTime.toFixed(1)}d`) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Total Realized</div>
                  <div className={cn("font-mono font-bold", totalRealizedPnL >= 0 ? "text-success" : "text-destructive")}>
                    {totalRealizedPnL >= 0 ? "+" : ""}${totalRealizedPnL.toFixed(2)}
                  </div>
                </div>
              </div>
            </Card>
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
                    <YAxis
                      tick={{ fontSize: 10 }}
                      className="fill-muted-foreground"
                      domain={[(dataMin: number) => dataMin * 0.95, (dataMax: number) => dataMax * 1.1]}
                      tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
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
                        contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "11px" }}
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

          {/* Empty state */}

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
                  {/* Mobile */}
                  <div className="sm:hidden divide-y divide-border/20">
                    {closedPositions.map((pos) => (
                      <div key={pos.id} className="p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <TickerLink ticker={pos.ticker} className="font-mono font-bold text-sm" />
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

                  {/* Desktop */}
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
                            <TableCell className="font-mono font-bold text-sm"><TickerLink ticker={pos.ticker} /></TableCell>
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
  );
}
