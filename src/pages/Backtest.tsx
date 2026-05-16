import { SEO } from "@/components/SEO";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, ComposedChart,
} from "recharts";
import { fetchWithErrorHandling, handleResponseError, showErrorToast } from "@/lib/api-error";
import {
  Activity, BarChart3, Brain, TrendingUp, TrendingDown, AlertTriangle,
  Play, Loader2, Target, Gauge, DollarSign, Percent, Shuffle, Calendar,
  Trophy, Shield, Download, Clock, Crosshair, ShieldAlert, Zap, FlaskConical,
  BarChart2, PieChart, Repeat, Layers, Scale, Signal, Sparkles, Lock, SlidersHorizontal,
} from "lucide-react";

interface BacktestReport {
  periods: { start: string; end: string; accuracy: number; returnPct: number; trades: number }[];
  totalTrades: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;
  directionalAccuracy: number;
  // Conviction-bucket hit rate (replaced the old MAE/RMSE/MAPE prediction-error metrics,
  // which were measured against a dummy linearly-rescaled "predictedReturn").
  convictionBuckets: { bucket: string; avgConviction: number; hitRate: number; avgReturn: number; count: number }[];
  avgWin: number;
  avgLoss: number;
  winLossRatio: number;
  avgTradeDuration: number;
  medianTradeDuration: number;
  maxTradeDuration: number;
  avgMAE: number;
  avgMFE: number;
  valueAtRisk: number;
  conditionalVaR: number;
  ulcerIndex: number;
  marketExposure: number;
  longExposure: number;
  shortExposure: number;
  cagr: number;
  timeToDouble: number;
  alpha: number;
  beta: number;
  portfolioTurnover: number;
  stabilityScore: number;
  signalPrecision: number;
  signalRecall: number;
  signalF1: number;
  regimePerformance: { regime: string; accuracy: number; avgReturn: number; trades: number }[];
  confidenceCalibration: { bucket: string; predictedConf: number; actualAccuracy: number; count: number }[];
  equityCurve: { date: string; value: number }[];
  drawdownCurve: { date: string; drawdown: number }[];
  tradeLog: { date: string; exitDate: string; ticker: string; action: string; entryPrice: number; exitPrice: number; returnPct: number; pnl: number; regime: string; confidence: number; duration: number; mae: number; mfe: number; strategy?: string; exitReason?: string }[];
  monteCarlo: { percentile5: number; percentile25: number; median: number; percentile75: number; percentile95: number } | null;
  robustnessSkipped?: boolean;
  benchmarkReturn: number;
  annualizedReturn: number;
  rollingSharpe: { index: number; value: number }[];
  rollingVolatility: { index: number; value: number }[];
  tradeDistribution: { bucket: string; count: number }[];
  monthlyReturns: { year: number; month: number; returnPct: number }[];
  robustness: {
    noiseInjection: { baseReturn: number; noisyReturn: number; impact: number; passed: boolean } | null;
    delayedExecution: { baseReturn: number; delayedReturn: number; impact: number; passed: boolean } | null;
    parameterSensitivity: { param: string; value: number; returnPct: number; sharpe: number }[];
    tradeDependency: { baseReturn: number; reducedReturn: number; impact: number; passed: boolean } | null;
  };
  stressTests: { period: string; startDate: string; endDate: string; strategyReturn: number; benchmarkReturn: number; maxDrawdown: number }[];
  metricsHealth?: {
    betaInRange: boolean;
    parameterSensitivityVaried: boolean;
    stressReturnsPlausible: boolean;
    notes: string[];
  };
  liquidityWarnings: number;
  // New institutional metrics
  maxDrawdownDuration: number;
  avgDrawdownDuration: number;
  recoveryTime: number;
  timeInDrawdownPct: number;
  skewness: number;
  kurtosis: number;
  kelly: number;
  expectancy: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  strategyCapacity: number;
  signalDecay: { day: number; accuracy: number }[];
  benchmarkEquity: { date: string; value: number }[];
  marketRegimePerformance: { regime: string; accuracy: number; avgReturn: number; trades: number }[];
  strategyPerformance?: { strategy: string; trades: number; winRate: number; avgReturn: number }[];
}

import { MetricCard } from "@/components/MetricCard";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function exportCSV(report: BacktestReport) {
  let csv = "=== BACKTEST SUMMARY ===\n";
  csv += `Total Trades,${report.totalTrades}\nWin Rate,${report.winRate}%\nTotal Return,${report.totalReturn}%\n`;
  csv += `Sharpe Ratio,${report.sharpeRatio}\nSortino Ratio,${report.sortinoRatio}\nCalmar Ratio,${report.calmarRatio}\n`;
  csv += `Max Drawdown,${report.maxDrawdown}%\nProfit Factor,${report.profitFactor}\nCAGR,${report.cagr}%\n`;
  csv += `Alpha,${report.alpha}%\nBeta,${report.beta}\nVaR (5%),${report.valueAtRisk}%\nCVaR,${report.conditionalVaR}%\n`;
  csv += `Avg Win,${report.avgWin}%\nAvg Loss,${report.avgLoss}%\nWin/Loss Ratio,${report.winLossRatio}\n`;
  csv += `Avg Duration,${report.avgTradeDuration} bars\nMarket Exposure,${report.marketExposure}%\n`;
  csv += `Expectancy,${report.expectancy}%\nKelly,${report.kelly}\nSkewness,${report.skewness}\nKurtosis,${report.kurtosis}\n`;
  csv += `Max Consec Wins,${report.maxConsecutiveWins}\nMax Consec Losses,${report.maxConsecutiveLosses}\n`;
  csv += `Time in Drawdown,${report.timeInDrawdownPct}%\nMax DD Duration,${report.maxDrawdownDuration} bars\nRecovery Time,${report.recoveryTime} bars\n`;
  csv += `Strategy Capacity,$${report.strategyCapacity?.toLocaleString() || 'N/A'}\n\n`;

  csv += "=== TRADE LOG ===\nDate,Exit Date,Ticker,Action,Strategy,Entry,Exit,Return%,PnL,Duration,MAE%,MFE%,Regime,Confidence\n";
  for (const t of report.tradeLog) {
    csv += `${t.date},${t.exitDate},${t.ticker},${t.action},${t.strategy || ""},${t.entryPrice.toFixed(2)},${t.exitPrice.toFixed(2)},${t.returnPct.toFixed(2)},${t.pnl.toFixed(2)},${t.duration},${t.mae},${t.mfe},${t.regime},${t.confidence}\n`;
  }

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backtest-report-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const Backtest = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [showTradeLog, setShowTradeLog] = useState(false);
  const [strategyMode, setStrategyMode] = useState<"adaptive" | "conservative" | "aggressive" | "custom">("adaptive");

  const [tickerInput, setTickerInput] = useState("AAPL");
  const [startYear, setStartYear] = useState(2020);
  const [endYear, setEndYear] = useState(2025);
  const [initialCapital, setInitialCapital] = useState(10000);
  const [positionSize, setPositionSize] = useState(10);
  const [stopLoss, setStopLoss] = useState(8);
  const [takeProfit, setTakeProfit] = useState(10);
  const [includeMonteCarlo, setIncludeMonteCarlo] = useState(true);
  const [buyThreshold, setBuyThreshold] = useState(65);
  const [adxThreshold, setAdxThreshold] = useState(25);
  const [rsiOversold, setRsiOversold] = useState(30);
  const [rsiOverbought, setRsiOverbought] = useState(70);
  const [trailingStopATRMult, setTrailingStopATRMult] = useState(2.0);
  const [maxHoldBars, setMaxHoldBars] = useState(20);
  const [riskPerTrade, setRiskPerTrade] = useState(1);

  const handleRunBacktest = async () => {
    if (!session?.access_token) {
      toast.error("Please sign in to run backtests");
      navigate("/auth");
      return;
    }

    const tickers = tickerInput.split(",").map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 5);
    if (tickers.length === 0) { toast.error("Enter at least one ticker"); return; }

    if (startYear < 2000 || startYear > 2026) {
      toast.error("Start year must be between 2000 and 2026");
      return;
    }
    if (endYear < 2000 || endYear > 2026) {
      toast.error("End year must be between 2000 and 2026");
      return;
    }
    if (endYear <= startYear) {
      toast.error("End year must be after start year");
      return;
    }

    setIsLoading(true);
    setReport(null);

    try {
      const endpoint = "backtest";
      const body = {
        tickers,
        startYear,
        endYear,
        initialCapital,
        positionSizePct: positionSize,
        stopLossPct: stopLoss,
        takeProfitPct: takeProfit,
        includeMonteCarlo,
        strategyMode,
        explicitOverride: strategyMode === "custom",
        ...(strategyMode === "custom" ? {
          buyThreshold,
          shortThreshold: -buyThreshold,
          adxThreshold,
          rsiOversold,
          rsiOverbought,
          trailingStopATRMult,
          maxHoldBars,
        } : {}),
        riskPerTrade: riskPerTrade / 100,
      };

      const resp = await fetchWithErrorHandling(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${endpoint}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(body),
          timeoutMs: 180000,
          retries: 1,
        }
      );

      if (!resp.ok) {
        await handleResponseError(resp, navigate);
      }

      const data: BacktestReport = await resp.json();
      setReport(data);
      toast.success(`Backtest complete: ${data.totalTrades} trades analyzed`);
    } catch (e: any) {
      console.error("Backtest error:", e);
      const isTimeout = e?.isTimeout || e?.isNetworkError || (e?.message && e.message.includes("timed out"));
      if (isTimeout) {
        showErrorToast(e, "Backtest timed out. Try fewer tickers or a shorter date range.");
      } else {
        showErrorToast(e, "Backtest failed. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Merge equity + benchmark for overlay chart
  const equityVsBenchmark = report?.equityCurve && report?.benchmarkEquity?.length > 0
    ? report.equityCurve.map(ec => {
        const bench = report.benchmarkEquity.reduce((closest, b) => {
          return Math.abs(new Date(b.date).getTime() - new Date(ec.date).getTime()) <
                 Math.abs(new Date(closest.date).getTime() - new Date(ec.date).getTime()) ? b : closest;
        }, report.benchmarkEquity[0]);
        return { date: ec.date, strategy: ec.value, benchmark: bench.value };
      })
    : null;

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Backtest AI Trading Strategies | StockAI"
        description="Institutional-grade strategy backtester with Sharpe, Sortino, Calmar, profit factor, walk-forward analysis, and Monte Carlo simulations."
        path="/backtest"
      />
      <Navbar />
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/2 rounded-full blur-[150px]" />
      </div>

      <main className="pt-20 pb-12 px-4 sm:px-6 relative z-10">
        <div className="container mx-auto max-w-7xl">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <h1 className="text-xl sm:text-2xl font-medium mb-1 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              Backtest Engine
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Institutional-grade walk-forward backtesting with anti-bias protection
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            {/* Config Panel */}
            <motion.div initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }} className="lg:col-span-4 xl:col-span-3">
              <div className="sticky top-20 space-y-4">
                <Card className="glass-card p-5 space-y-5">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Brain className="w-4 h-4 text-primary" />
                    Configuration
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bt-tickers" className="text-xs text-muted-foreground">Tickers (comma-separated, max 5)</Label>
                    <Input id="bt-tickers" value={tickerInput} onChange={e => setTickerInput(e.target.value.toUpperCase())} placeholder="AAPL, MSFT, GOOGL" variant="glass" />
                  </div>



                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="bt-start-year" className="text-xs text-muted-foreground">Start Year</Label>
                      <Input id="bt-start-year" type="number" value={startYear} onChange={e => { const v = Number(e.target.value); setStartYear(v); }} min={2000} max={2026} variant="glass" onBlur={() => { if (startYear < 2000) setStartYear(2010); if (startYear > 2026) setStartYear(2025); }} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bt-end-year" className="text-xs text-muted-foreground">End Year</Label>
                      <Input id="bt-end-year" type="number" value={endYear} onChange={e => setEndYear(Number(e.target.value))} min={2015} max={2026} variant="glass" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Initial Capital: ${initialCapital.toLocaleString()}</Label>
                    <Slider value={[initialCapital]} onValueChange={v => setInitialCapital(v[0])} min={1000} max={100000} step={1000} />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Risk Per Trade: {riskPerTrade}%</Label>
                    <Slider value={[riskPerTrade]} onValueChange={v => setRiskPerTrade(v[0])} min={0.5} max={3} step={0.5} />
                    <p className="text-[10px] text-muted-foreground/60">% of capital risked per trade (max 3%)</p>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Position Size Cap: {positionSize}%</Label>
                    <Slider value={[positionSize]} onValueChange={v => setPositionSize(v[0])} min={5} max={50} step={5} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Max Stop: {stopLoss}%</Label>
                      <Slider value={[stopLoss]} onValueChange={v => setStopLoss(v[0])} min={1} max={20} step={1} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Take Profit: {takeProfit}%</Label>
                      <Slider value={[takeProfit]} onValueChange={v => setTakeProfit(v[0])} min={2} max={30} step={1} />
                    </div>
                  </div>

                  <div className="border-t border-border/50 pt-4 mt-2 space-y-4">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Signal className="w-3 h-3" />
                      Strategy Mode
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { value: "adaptive" as const, label: "Adaptive", icon: Sparkles, desc: "Auto-optimized" },
                        { value: "conservative" as const, label: "Conservative", icon: Shield, desc: "Fewer trades" },
                        { value: "aggressive" as const, label: "Aggressive", icon: Zap, desc: "More trades" },
                        { value: "custom" as const, label: "Custom", icon: SlidersHorizontal, desc: "Manual tuning" },
                      ]).map(mode => (
                        <button
                          key={mode.value}
                          onClick={() => setStrategyMode(mode.value)}
                          className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs transition-all ${
                            strategyMode === mode.value
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border/50 bg-card/30 text-muted-foreground hover:border-border hover:bg-card/50"
                          }`}
                        >
                          <mode.icon className="w-3.5 h-3.5" />
                          <span className="font-medium">{mode.label}</span>
                          <span className="text-[9px] opacity-70">{mode.desc}</span>
                        </button>
                      ))}
                    </div>

                    {strategyMode === "adaptive" && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10">
                        <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Algorithm auto-detects each stock's behavior profile (momentum, value, index, volatile) and applies optimized parameters. <span className="text-primary font-medium">Recommended for most users.</span>
                        </p>
                      </div>
                    )}

                    {strategyMode === "conservative" && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border/50">
                        <Shield className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="text-[10px] text-muted-foreground leading-relaxed space-y-1">
                          <p>Higher conviction thresholds (+10), shorter holds (−20%), tighter trailing stops.</p>
                          <p className="opacity-60">Fewer trades, higher win rate, lower drawdowns.</p>
                        </div>
                      </div>
                    )}

                    {strategyMode === "aggressive" && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border/50">
                        <Zap className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="text-[10px] text-muted-foreground leading-relaxed space-y-1">
                          <p>Lower conviction (−5), longer holds (+25%), wider trailing stops.</p>
                          <p className="opacity-60">More trades, higher exposure, potentially larger gains and drawdowns.</p>
                        </div>
                      </div>
                    )}

                    {strategyMode === "custom" && (
                      <div className="space-y-4">
                        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/5 border border-destructive/10">
                          <AlertTriangle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                          <p className="text-[10px] text-destructive/80 leading-relaxed">
                            Custom overrides profile optimization. Bad combinations can hurt performance.
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Conviction Threshold: {buyThreshold}</Label>
                          <Slider value={[buyThreshold]} onValueChange={v => setBuyThreshold(v[0])} min={50} max={85} step={5} />
                          <p className={`text-[10px] ${buyThreshold < 55 ? "text-destructive" : buyThreshold < 60 ? "text-yellow-500" : "text-muted-foreground/60"}`}>
                            {buyThreshold < 55 ? "⚠ Very low — may generate many weak signals" : buyThreshold < 60 ? "⚡ Low — more trades but weaker signals" : "Higher = fewer but stronger signals"}
                          </p>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">ADX Threshold: {adxThreshold}</Label>
                          <Slider value={[adxThreshold]} onValueChange={v => setAdxThreshold(v[0])} min={18} max={35} step={1} />
                          <p className="text-[10px] text-muted-foreground/60">Trend vs Mean Reversion cutoff</p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">RSI Oversold: {rsiOversold}</Label>
                            <Slider value={[rsiOversold]} onValueChange={v => setRsiOversold(v[0])} min={20} max={35} step={1} />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">RSI Overbought: {rsiOverbought}</Label>
                            <Slider value={[rsiOverbought]} onValueChange={v => setRsiOverbought(v[0])} min={65} max={80} step={1} />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Trailing Stop: {trailingStopATRMult}× ATR</Label>
                          <Slider value={[trailingStopATRMult * 10]} onValueChange={v => setTrailingStopATRMult(v[0] / 10)} min={15} max={30} step={1} />
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Max Hold: {maxHoldBars} bars</Label>
                          <Slider value={[maxHoldBars]} onValueChange={v => setMaxHoldBars(v[0])} min={8} max={40} step={2} />
                        </div>

                        {rsiOversold > 33 && buyThreshold < 60 && (
                          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/10">
                            <AlertTriangle className="w-3 h-3 text-yellow-500 mt-0.5 shrink-0" />
                            <p className="text-[10px] text-yellow-600 dark:text-yellow-400 leading-relaxed">
                              High RSI oversold + low conviction may generate many low-quality mean-reversion signals.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Shuffle className="w-3 h-3" />
                      Monte Carlo (200 sims)
                    </Label>
                    <Switch checked={includeMonteCarlo} onCheckedChange={setIncludeMonteCarlo} />
                  </div>

                  <Button onClick={handleRunBacktest} disabled={isLoading} className="w-full gap-2">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {isLoading ? "Running Backtest..." : "Run Backtest"}
                  </Button>
                </Card>

                <Card className="glass-card p-4">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Anti-Bias Protection</div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span>Execution</span><span className="font-mono text-success">Next-bar open</span></div>
                    <div className="flex justify-between"><span>Commission</span><span className="font-mono">0.1%</span></div>
                    <div className="flex justify-between"><span>Spread</span><span className="font-mono">0.05%</span></div>
                    <div className="flex justify-between"><span>Slippage</span><span className="font-mono">±0.1%</span></div>
                    <div className="flex justify-between"><span>Robustness</span><span className="font-mono text-success">Noise + Delay</span></div>
                  </div>
                </Card>
              </div>
            </motion.div>

            {/* Results */}
            <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="lg:col-span-8 xl:col-span-9">
              <AnimatePresence mode="wait">
                {!report && !isLoading ? (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card p-8 text-center">
                    <BarChart3 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">Institutional-Grade Backtesting</h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6">
                      Walk-forward validation, realistic costs, robustness testing, and 40+ institutional metrics.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-lg mx-auto">
                      {[
                        { icon: Activity, label: "Walk-Forward" },
                        { icon: ShieldAlert, label: "Anti-Bias" },
                        { icon: FlaskConical, label: "Robustness" },
                        { icon: Trophy, label: "40+ Metrics" },
                      ].map(({ icon: Icon, label }) => (
                        <div key={label} className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-secondary/30">
                          <Icon className="w-4 h-4 text-primary" />
                          <span className="text-[10px] text-muted-foreground">{label}</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ) : isLoading ? (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card p-12 text-center">
                    <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">Running institutional backtest...</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Walk-forward + robustness + stress + trade dependency</p>
                  </motion.div>
                ) : report ? (
                  <motion.div key="report" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                    {/* CSV Export */}
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => exportCSV(report)}>
                        <Download className="w-3 h-3" /> Export CSV
                      </Button>
                    </div>

                    {/* Metrics Health Warning */}
                    {report.metricsHealth && report.metricsHealth.notes.length > 0 && (
                      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 flex gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-warning">Measurement health check failed</div>
                          <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc list-inside">
                            {report.metricsHealth.notes.map((n, i) => <li key={i}>{n}</li>)}
                          </ul>
                          <div className="text-[10px] text-muted-foreground/70 pt-1">
                            Some metrics below may be unreliable. Treat affected numbers (Beta/Alpha, parameter sensitivity, or stress periods) with caution.
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Primary Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricCard label="Total Return" value={`${report.totalReturn > 0 ? "+" : ""}${report.totalReturn}`} suffix="%" icon={TrendingUp}
                        color={report.totalReturn > 0 ? "text-success" : "text-destructive"} />
                      <MetricCard label="Win Rate" value={report.winRate} suffix="%" icon={Target}
                        color={report.winRate > 50 ? "text-success" : "text-destructive"} />
                      <MetricCard label="Max Drawdown" value={`-${report.maxDrawdown}`} suffix="%" icon={TrendingDown} color="text-destructive" />
                      <MetricCard label="CAGR" value={report.cagr} suffix="%" icon={TrendingUp}
                        color={report.cagr > 0 ? "text-success" : "text-destructive"} />
                    </div>

                    {/* Risk Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricCard label="Sharpe Ratio" value={report.sharpeRatio} icon={Gauge}
                        color={report.sharpeRatio > 1 ? "text-success" : report.sharpeRatio > 0 ? "text-warning" : "text-destructive"} />
                      <MetricCard label="Sortino Ratio" value={report.sortinoRatio} icon={Shield}
                        color={report.sortinoRatio > 1 ? "text-success" : "text-warning"} />
                      <MetricCard label="Profit Factor" value={report.profitFactor} icon={DollarSign}
                        color={report.profitFactor > 1 ? "text-success" : "text-destructive"} />
                      <MetricCard label="Calmar Ratio" value={report.calmarRatio} icon={Percent}
                        color={report.calmarRatio > 0.5 ? "text-success" : "text-warning"} />
                    </div>

                    {/* NEW: Expectancy, Kelly, Skewness, Kurtosis */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricCard label="Expectancy" value={report.expectancy} suffix="%" icon={Scale}
                        color={report.expectancy > 0 ? "text-success" : "text-destructive"} />
                      <MetricCard label="Kelly Criterion" value={report.kelly} icon={Layers}
                        color={report.kelly > 0 ? "text-success" : "text-destructive"} />
                      <MetricCard label="Skewness" value={report.skewness} icon={BarChart2}
                        color={report.skewness > 0 ? "text-success" : "text-warning"} />
                      <MetricCard label="Kurtosis" value={report.kurtosis} icon={BarChart2}
                        color={Math.abs(report.kurtosis) < 1 ? "text-success" : "text-warning"} />
                    </div>

                    {/* Advanced Risk */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricCard label="VaR (5%)" value={report.valueAtRisk} suffix="%" icon={ShieldAlert} color="text-destructive" />
                      <MetricCard label="CVaR" value={report.conditionalVaR} suffix="%" icon={ShieldAlert} color="text-destructive" />
                      <MetricCard label="Ulcer Index" value={report.ulcerIndex} icon={Activity} />
                      <MetricCard label="Stability" value={report.stabilityScore} icon={Zap}
                        color={report.stabilityScore < 3 ? "text-success" : "text-warning"} />
                    </div>

                    {/* Trade Stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricCard label="Avg Win" value={`+${report.avgWin}`} suffix="%" icon={TrendingUp} color="text-success" />
                      <MetricCard label="Avg Loss" value={report.avgLoss} suffix="%" icon={TrendingDown} color="text-destructive" />
                      <MetricCard label="Win/Loss Ratio" value={report.winLossRatio} icon={Target}
                        color={report.winLossRatio > 1 ? "text-success" : "text-destructive"} />
                      <MetricCard label="Total Trades" value={report.totalTrades} icon={Activity} />
                    </div>

                    {/* NEW: Clustering & Drawdown Duration */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricCard label="Max Consec Wins" value={report.maxConsecutiveWins} icon={TrendingUp} color="text-success" />
                      <MetricCard label="Max Consec Losses" value={report.maxConsecutiveLosses} icon={TrendingDown} color="text-destructive" />
                      <MetricCard label="Time in Drawdown" value={report.timeInDrawdownPct} suffix="%" icon={Clock}
                        color={report.timeInDrawdownPct < 40 ? "text-success" : "text-warning"} />
                      <MetricCard label="Recovery Time" value={report.recoveryTime} suffix=" bars" icon={Repeat} />
                    </div>

                    {/* Exposure & Duration + Capacity */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricCard label="Market Exposure" value={report.marketExposure} suffix="%" icon={PieChart} />
                      <MetricCard label="Avg Duration" value={report.avgTradeDuration} suffix=" bars" icon={Clock} />
                      <MetricCard label="Avg MAE" value={report.avgMAE} suffix="%" icon={Crosshair} color="text-destructive" />
                      <MetricCard label="Strategy Capacity" value={report.strategyCapacity ? `$${(report.strategyCapacity / 1e6).toFixed(1)}M` : "N/A"} icon={DollarSign} />
                    </div>

                    {/* Alpha/Beta & Signal Quality */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricCard label="Alpha" value={report.alpha} suffix="%" icon={Trophy}
                        color={report.alpha > 0 ? "text-success" : "text-destructive"} />
                      <MetricCard label="Beta" value={report.beta} icon={BarChart2} />
                      <MetricCard label="Signal Precision" value={report.signalPrecision} suffix="%" icon={Target}
                        color={report.signalPrecision > 50 ? "text-success" : "text-destructive"} />
                      <MetricCard label="Signal F1" value={report.signalF1} suffix="%" icon={Target}
                        color={report.signalF1 > 50 ? "text-success" : "text-destructive"} />
                    </div>

                    {/* Benchmark Comparison */}
                    <Card className="glass-card p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground">Strategy vs SPY Buy & Hold</div>
                          <div className="flex items-center gap-3 sm:gap-4 mt-1 flex-wrap">
                            <span className={`text-base sm:text-lg font-mono font-medium ${report.totalReturn > 0 ? "text-success" : "text-destructive"}`}>
                              Strategy: {report.totalReturn > 0 ? "+" : ""}{report.totalReturn}%
                            </span>
                            <span className="text-base sm:text-lg font-mono font-medium text-muted-foreground">
                              SPY: {report.benchmarkReturn > 0 ? "+" : ""}{report.benchmarkReturn}%
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Badge variant={report.totalReturn > report.benchmarkReturn ? "default" : "destructive"}>
                            {report.totalReturn > report.benchmarkReturn ? "Outperforms" : "Underperforms"}
                          </Badge>
                          {report.liquidityWarnings > 0 && (
                            <Badge variant="outline" className="text-warning border-warning/30">
                              {report.liquidityWarnings} liquidity flags
                            </Badge>
                          )}
                        </div>
                      </div>
                    </Card>

                    {/* Signal Quality by Conviction Bucket */}
                    <Card className="glass-card p-4 sm:p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <Target className="w-4 h-4 text-primary" />
                        <h3 className="text-sm font-semibold">Signal Quality by Conviction</h3>
                        <span className="text-xs text-muted-foreground ml-auto">
                          Higher conviction should yield higher hit rate
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <MetricCard
                          label="Dir. Accuracy"
                          value={report.directionalAccuracy}
                          suffix="%"
                          icon={Target}
                          color={report.directionalAccuracy > 50 ? "text-success" : "text-destructive"}
                        />
                        {(report.convictionBuckets || []).map((b) => (
                          <MetricCard
                            key={b.bucket}
                            label={`Conv ${b.bucket} (n=${b.count})`}
                            value={b.count > 0 ? b.hitRate : 0}
                            suffix="%"
                            icon={Activity}
                            color={
                              b.count === 0
                                ? "text-muted-foreground"
                                : b.hitRate >= 50
                                ? "text-success"
                                : "text-destructive"
                            }
                          />
                        ))}
                      </div>
                    </Card>

                    {/* Equity vs Benchmark Overlay */}
                    {equityVsBenchmark && equityVsBenchmark.length > 0 && (
                      <Card className="glass-card p-4 sm:p-6">
                        <div className="flex items-center gap-4 mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-0.5 bg-primary rounded" />
                            <span className="text-xs text-muted-foreground">Strategy</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-0.5 rounded" style={{ backgroundColor: "hsl(var(--muted-foreground))" }} />
                            <span className="text-xs text-muted-foreground">SPY Benchmark</span>
                          </div>
                        </div>
                        <div className="h-48 sm:h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={equityVsBenchmark}>
                              <defs>
                                <linearGradient id="equityGradOverlay" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                tickFormatter={v => v.substring(0, 7)} interval="preserveStartEnd" />
                              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                                formatter={(v: number, name: string) => [`$${v.toFixed(0)}`, name === "strategy" ? "Strategy" : "SPY"]} />
                              <ReferenceLine y={initialCapital} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                              <Area type="monotone" dataKey="strategy" stroke="hsl(var(--primary))" fill="url(#equityGradOverlay)" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="benchmark" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    )}

                    {/* Drawdown Curve */}
                    {report.drawdownCurve.length > 0 && (
                      <Card className="glass-card p-4 sm:p-6">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-2 h-2 rounded-full bg-destructive" />
                          <span className="text-sm font-medium">Drawdown</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mb-4">
                          Max duration: {report.maxDrawdownDuration} bars · Avg duration: {report.avgDrawdownDuration} bars
                        </div>
                        <div className="h-36 sm:h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={report.drawdownCurve}>
                              <defs>
                                <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                tickFormatter={v => v.substring(0, 7)} interval="preserveStartEnd" />
                              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                tickFormatter={v => `${v}%`} />
                              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                                formatter={(v: number) => [`${v}%`, "Drawdown"]} />
                              <Area type="monotone" dataKey="drawdown" stroke="hsl(var(--destructive))" fill="url(#ddGrad)" strokeWidth={1.5} dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    )}

                    {/* Signal Decay */}
                    {report.signalDecay?.length > 0 && (
                      <Card className="glass-card p-4 sm:p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <Signal className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">Signal Decay Curve</span>
                        </div>
                        <div className="h-40">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={report.signalDecay}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                tickFormatter={v => `Day ${v}`} />
                              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                tickFormatter={v => `${v}%`} domain={[0, 100]} />
                              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                                formatter={(v: number) => [`${v}%`, "Accuracy"]} />
                              <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                              <Line type="monotone" dataKey="accuracy" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: "hsl(var(--primary))", r: 4 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-2">How quickly signal predictive power fades over time</p>
                      </Card>
                    )}

                    {/* Rolling Sharpe */}
                    {report.rollingSharpe.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <Gauge className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">Rolling Sharpe Ratio (20-trade window)</span>
                        </div>
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={report.rollingSharpe}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="index" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                                formatter={(v: number) => [v.toFixed(2), "Sharpe"]} />
                              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                              <ReferenceLine y={1} stroke="hsl(var(--primary))" strokeDasharray="3 3" />
                              <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    )}

                    {/* Trade Distribution Histogram */}
                    {report.tradeDistribution.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <BarChart2 className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">Trade Return Distribution</span>
                        </div>
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={report.tradeDistribution}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                                {report.tradeDistribution.map((d, i) => (
                                  <Cell key={i} fill={d.bucket.startsWith("-") ? "hsl(var(--destructive))" : "hsl(var(--primary))"} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    )}

                    {/* Monthly Returns Heatmap */}
                    {report.monthlyReturns.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="text-sm font-medium mb-4">Monthly Returns Heatmap</div>
                        <div className="overflow-x-auto">
                          {(() => {
                            const years = [...new Set(report.monthlyReturns.map(m => m.year))].sort();
                            return (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-border/30">
                                    <th className="text-left py-1.5 text-muted-foreground font-normal">Year</th>
                                    {MONTHS.map(m => (
                                      <th key={m} className="text-center py-1.5 text-muted-foreground font-normal w-12">{m}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {years.map(yr => (
                                    <tr key={yr} className="border-b border-border/10">
                                      <td className="py-1.5 font-mono font-medium">{yr}</td>
                                      {Array.from({ length: 12 }, (_, mi) => {
                                        const entry = report.monthlyReturns.find(m => m.year === yr && m.month === mi + 1);
                                        const val = entry?.returnPct || 0;
                                        const intensity = Math.min(Math.abs(val) / 5, 1);
                                        const bg = val > 0
                                          ? `hsl(var(--primary) / ${0.1 + intensity * 0.5})`
                                          : val < 0
                                            ? `hsl(var(--destructive) / ${0.1 + intensity * 0.5})`
                                            : "transparent";
                                        return (
                                          <td key={mi} className="text-center py-1.5 font-mono" style={{ backgroundColor: bg }}>
                                            {entry ? `${val > 0 ? "+" : ""}${val.toFixed(1)}` : "—"}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            );
                          })()}
                        </div>
                      </Card>
                    )}

                    {/* Robustness Tests */}
                    {report.robustnessSkipped ? (
                      <Card className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-2">
                          <FlaskConical className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Robustness Tests</span>
                          <Badge variant="secondary" className="text-[10px]">SKIPPED</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Skipped due to computation budget. Try fewer tickers or a shorter date range for full robustness analysis.
                        </p>
                      </Card>
                    ) : report.robustness && (report.robustness.noiseInjection || report.robustness.delayedExecution || report.robustness.tradeDependency) ? (
                      <Card className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <FlaskConical className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">Robustness Tests</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {report.robustness.noiseInjection && (
                            <div className="p-3 rounded-lg bg-secondary/20 border border-border/20">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium">Noise Injection (±0.5%)</span>
                                <Badge variant={report.robustness.noiseInjection.passed ? "default" : "destructive"} className="text-[10px]">
                                  {report.robustness.noiseInjection.passed ? "PASS" : "FAIL"}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground space-y-0.5">
                                <div>Base: {report.robustness.noiseInjection.baseReturn}%</div>
                                <div>Noisy: {report.robustness.noiseInjection.noisyReturn}%</div>
                                <div>Impact: {report.robustness.noiseInjection.impact}%</div>
                              </div>
                            </div>
                          )}
                          {report.robustness.delayedExecution && (
                            <div className="p-3 rounded-lg bg-secondary/20 border border-border/20">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium">Delayed Execution (t+2)</span>
                                <Badge variant={report.robustness.delayedExecution.passed ? "default" : "destructive"} className="text-[10px]">
                                  {report.robustness.delayedExecution.passed ? "PASS" : "FAIL"}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground space-y-0.5">
                                <div>Base: {report.robustness.delayedExecution.baseReturn}%</div>
                                <div>Delayed: {report.robustness.delayedExecution.delayedReturn}%</div>
                                <div>Impact: {report.robustness.delayedExecution.impact}%</div>
                              </div>
                            </div>
                          )}
                          {report.robustness.tradeDependency && (
                            <div className="p-3 rounded-lg bg-secondary/20 border border-border/20">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium">Trade Dependency</span>
                                <Badge variant={report.robustness.tradeDependency.passed ? "default" : "destructive"} className="text-[10px]">
                                  {report.robustness.tradeDependency.passed ? "PASS" : "FAIL"}
                                </Badge>
                              </div>
                              <div className="text-xs text-muted-foreground space-y-0.5">
                                <div>Base: {report.robustness.tradeDependency.baseReturn}%</div>
                                <div>-10% trades: {report.robustness.tradeDependency.reducedReturn}%</div>
                                <div>Impact: {report.robustness.tradeDependency.impact}%</div>
                              </div>
                            </div>
                          )}
                        </div>
                      </Card>
                    ) : null}

                    {/* Parameter Sensitivity */}
                    {report.robustness?.parameterSensitivity?.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="text-sm font-medium mb-4">Parameter Sensitivity</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border/30">
                                <th className="text-left py-2 text-muted-foreground font-normal">Parameter</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Return</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Sharpe</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.robustness.parameterSensitivity.map(ps => (
                                <tr key={ps.param} className="border-b border-border/10">
                                  <td className="py-2 font-mono">{ps.param}</td>
                                  <td className={`text-right py-2 font-mono ${ps.returnPct > 0 ? "text-success" : "text-destructive"}`}>
                                    {ps.returnPct > 0 ? "+" : ""}{ps.returnPct}%
                                  </td>
                                  <td className={`text-right py-2 font-mono ${ps.sharpe > 1 ? "text-success" : ps.sharpe > 0 ? "text-warning" : "text-destructive"}`}>
                                    {ps.sharpe}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    )}

                    {/* Stress Tests */}
                    {report.stressTests?.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <AlertTriangle className="w-4 h-4 text-warning" />
                          <span className="text-sm font-medium">Stress Test Results</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border/30">
                                <th className="text-left py-2 text-muted-foreground font-normal">Period</th>
                                <th className="text-left py-2 text-muted-foreground font-normal">Dates</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Strategy</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Benchmark</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Max DD</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.stressTests.map(st => (
                                <tr key={st.period} className="border-b border-border/10">
                                  <td className="py-2 font-medium">{st.period}</td>
                                  <td className="py-2 font-mono text-muted-foreground">{st.startDate.substring(0, 7)}</td>
                                  <td className={`text-right py-2 font-mono ${st.strategyReturn > 0 ? "text-success" : "text-destructive"}`}>
                                    {st.strategyReturn > 0 ? "+" : ""}{st.strategyReturn}%
                                  </td>
                                  <td className={`text-right py-2 font-mono ${st.benchmarkReturn > 0 ? "text-success" : "text-destructive"}`}>
                                    {st.benchmarkReturn > 0 ? "+" : ""}{st.benchmarkReturn}%
                                  </td>
                                  <td className="text-right py-2 font-mono text-destructive">-{st.maxDrawdown}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    )}

                    {/* Market Regime Performance (SPY 200MA) */}
                    {report.marketRegimePerformance?.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <Layers className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">Market Regime Performance (SPY 200MA)</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border/30">
                                <th className="text-left py-2 text-muted-foreground font-normal">Regime</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Accuracy</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Avg Return</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Trades</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.marketRegimePerformance.map(rp => (
                                <tr key={rp.regime} className="border-b border-border/10">
                                  <td className="py-2 font-medium flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${
                                      rp.regime === "Bull" ? "bg-success" : rp.regime === "Bear" ? "bg-destructive" : "bg-warning"
                                    }`} />
                                    {rp.regime}
                                  </td>
                                  <td className={`text-right py-2 font-mono ${rp.accuracy > 50 ? "text-success" : "text-destructive"}`}>{rp.accuracy}%</td>
                                  <td className={`text-right py-2 font-mono ${rp.avgReturn > 0 ? "text-success" : "text-destructive"}`}>{rp.avgReturn > 0 ? "+" : ""}{rp.avgReturn}%</td>
                                  <td className="text-right py-2 font-mono text-muted-foreground">{rp.trades}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    )}

                    {/* Strategy Attribution */}
                    {report.strategyPerformance && report.strategyPerformance.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <Layers className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">Strategy Attribution</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {report.strategyPerformance.map(sp => (
                            <div key={sp.strategy} className="p-3 rounded-lg border border-border/20 bg-muted/10">
                              <div className="text-xs text-muted-foreground capitalize mb-1">{sp.strategy.replace(/_/g, " ")}</div>
                              <div className="text-lg font-bold">{sp.trades} <span className="text-xs font-normal text-muted-foreground">trades</span></div>
                              <div className="flex items-center gap-3 mt-1">
                                <span className={`text-xs font-mono ${sp.winRate >= 50 ? "text-success" : "text-destructive"}`}>{sp.winRate}% win</span>
                                <span className={`text-xs font-mono ${sp.avgReturn >= 0 ? "text-success" : "text-destructive"}`}>{sp.avgReturn > 0 ? "+" : ""}{sp.avgReturn}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}

                    {/* Exit Reason Distribution */}
                    {report.tradeLog.length > 0 && (() => {
                      const exitCounts: Record<string, number> = {};
                      report.tradeLog.forEach(t => {
                        const reason = (t.exitReason || "time_exit").replace(/_/g, " ");
                        exitCounts[reason] = (exitCounts[reason] || 0) + 1;
                      });
                      const exitData = Object.entries(exitCounts).map(([name, count]) => ({
                        name,
                        count,
                        pct: parseFloat(((count / report.tradeLog.length) * 100).toFixed(1)),
                      })).sort((a, b) => b.count - a.count);
                      return (
                        <Card className="glass-card p-6">
                          <div className="flex items-center gap-2 mb-4">
                            <Signal className="w-4 h-4 text-primary" />
                            <span className="text-sm font-medium">Exit Reason Distribution</span>
                          </div>
                          <div className="h-40">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={exitData} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                  tickFormatter={v => `${v}`} />
                                <YAxis dataKey="name" type="category" width={90}
                                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                                  formatter={(v: number, _: string, entry: any) => [`${v} (${entry.payload.pct}%)`, "Trades"]} />
                                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                                  {exitData.map((_, i) => (
                                    <Cell key={i} fill={["hsl(var(--destructive))", "hsl(var(--success))", "hsl(var(--primary))", "hsl(var(--muted-foreground))"][i % 4]} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </Card>
                      );
                    })()}

                    {report.regimePerformance.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="text-sm font-medium mb-4">Indicator Regime Performance</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border/30">
                                <th className="text-left py-2 text-muted-foreground font-normal">Regime</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Accuracy</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Avg Return</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Trades</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.regimePerformance.map(rp => (
                                <tr key={rp.regime} className="border-b border-border/10">
                                  <td className="py-2 capitalize font-medium">{rp.regime.replace(/_/g, " ")}</td>
                                  <td className={`text-right py-2 font-mono ${rp.accuracy > 50 ? "text-success" : "text-destructive"}`}>{rp.accuracy}%</td>
                                  <td className={`text-right py-2 font-mono ${rp.avgReturn > 0 ? "text-success" : "text-destructive"}`}>{rp.avgReturn > 0 ? "+" : ""}{rp.avgReturn}%</td>
                                  <td className="text-right py-2 font-mono text-muted-foreground">{rp.trades}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    )}

                    {/* Confidence Calibration UI removed — kept backend-only */}

                    {/* Walk-Forward Periods */}
                    {report.periods.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <Calendar className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">Walk-Forward Periods</span>
                        </div>
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={report.periods}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="start" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                tickFormatter={v => v.substring(0, 4)} />
                              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                tickFormatter={v => `${v}%`} />
                              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                                formatter={(v: number, name: string) => [`${v}%`, name === "accuracy" ? "Accuracy" : "Return"]} />
                              <Bar dataKey="accuracy" name="accuracy" radius={[4, 4, 0, 0]}>
                                {report.periods.map((p, i) => (
                                  <Cell key={i} fill={p.accuracy > 50 ? "hsl(var(--primary))" : "hsl(var(--destructive))"} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    )}

                    {/* Monte Carlo */}
                    {report.monteCarlo && (
                      <Card className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <Shuffle className="w-4 h-4 text-primary" />
                          <span className="text-sm font-medium">Monte Carlo Simulation (200 runs)</span>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
                          {[
                            { label: "5th %ile", value: report.monteCarlo.percentile5, worst: true },
                            { label: "25th %ile", value: report.monteCarlo.percentile25 },
                            { label: "Median", value: report.monteCarlo.median },
                            { label: "75th %ile", value: report.monteCarlo.percentile75 },
                            { label: "95th %ile", value: report.monteCarlo.percentile95, best: true },
                          ].map(({ label, value, worst, best }) => (
                            <div key={label} className="text-center">
                              <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
                              <div className={`text-sm font-mono font-medium ${
                                worst ? "text-destructive" : best ? "text-success" : value > 0 ? "text-success" : "text-destructive"
                              }`}>
                                {value > 0 ? "+" : ""}{value}%
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}

                    {/* Trade Log */}
                    <Card className="glass-card p-4">
                      <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setShowTradeLog(!showTradeLog)}>
                        {showTradeLog ? "Hide" : "Show"} Trade Log ({report.tradeLog.length} trades)
                      </Button>
                      {showTradeLog && (
                        <div className="mt-4 max-h-96 overflow-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                          <table className="w-full text-[10px] sm:text-xs min-w-[700px]">
                            <thead className="sticky top-0 bg-card">
                              <tr className="border-b border-border/30">
                                <th className="text-left py-1.5 text-muted-foreground font-normal">Date</th>
                                <th className="text-left py-1.5 text-muted-foreground font-normal">Ticker</th>
                                <th className="text-left py-1.5 text-muted-foreground font-normal">Action</th>
                                <th className="text-left py-1.5 text-muted-foreground font-normal">Strategy</th>
                                <th className="text-left py-1.5 text-muted-foreground font-normal">Exit Reason</th>
                                <th className="text-right py-1.5 text-muted-foreground font-normal">Entry $</th>
                                <th className="text-right py-1.5 text-muted-foreground font-normal">Exit $</th>
                                <th className="text-right py-1.5 text-muted-foreground font-normal">Return</th>
                                <th className="text-right py-1.5 text-muted-foreground font-normal">PnL</th>
                                <th className="text-right py-1.5 text-muted-foreground font-normal">Dur.</th>
                                <th className="text-right py-1.5 text-muted-foreground font-normal">MAE</th>
                                <th className="text-right py-1.5 text-muted-foreground font-normal">MFE</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.tradeLog.map((t, i) => (
                                <tr key={i} className="border-b border-border/5">
                                  <td className="py-1 font-mono text-muted-foreground">{t.date}</td>
                                  <td className="py-1 font-mono">{t.ticker}</td>
                                  <td className={`py-1 font-medium ${t.action === "BUY" ? "text-success" : "text-destructive"}`}>{t.action}</td>
                                  <td className="py-1 text-muted-foreground capitalize">{(t.strategy || "—").replace(/_/g, " ")}</td>
                                  <td className="py-1 text-muted-foreground capitalize text-[10px]">{(t.exitReason || "—").replace(/_/g, " ")}</td>
                                  <td className="py-1 text-right font-mono">${t.entryPrice.toFixed(2)}</td>
                                  <td className="py-1 text-right font-mono">${t.exitPrice.toFixed(2)}</td>
                                  <td className={`py-1 text-right font-mono ${t.returnPct > 0 ? "text-success" : "text-destructive"}`}>
                                    {t.returnPct > 0 ? "+" : ""}{t.returnPct.toFixed(2)}%
                                  </td>
                                  <td className={`py-1 text-right font-mono ${t.pnl > 0 ? "text-success" : "text-destructive"}`}>
                                    ${t.pnl.toFixed(0)}
                                  </td>
                                  <td className="py-1 text-right font-mono text-muted-foreground">{t.duration}d</td>
                                  <td className="py-1 text-right font-mono text-destructive">{t.mae}%</td>
                                  <td className="py-1 text-right font-mono text-success">{t.mfe}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </Card>

                    {/* Disclaimer */}
                    <div className="flex items-start gap-3 p-4 border border-border/30 rounded-lg">
                      <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Past performance does not guarantee future results. Backtests use historical data and may not reflect real trading conditions. This is not financial advice.
                      </p>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Backtest;
