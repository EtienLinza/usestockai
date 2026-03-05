import { useState } from "react";
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
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import {
  Activity, BarChart3, Brain, TrendingUp, TrendingDown, AlertTriangle,
  Play, Loader2, Target, Gauge, DollarSign, Percent, Shuffle, Calendar,
  Trophy, Shield,
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
  mae: number;
  rmse: number;
  regimePerformance: { regime: string; accuracy: number; avgReturn: number; trades: number }[];
  confidenceCalibration: { bucket: string; predictedConf: number; actualAccuracy: number; count: number }[];
  equityCurve: { date: string; value: number }[];
  drawdownCurve: { date: string; drawdown: number }[];
  tradeLog: { date: string; ticker: string; action: string; entryPrice: number; exitPrice: number; returnPct: number; pnl: number; regime: string; confidence: number }[];
  monteCarlo: { percentile5: number; percentile25: number; median: number; percentile75: number; percentile95: number } | null;
  benchmarkReturn: number;
  annualizedReturn: number;
}

const MetricCard = ({ label, value, suffix = "", icon: Icon, color = "text-foreground" }: {
  label: string; value: string | number; suffix?: string; icon: any; color?: string;
}) => (
  <Card className="glass-card p-4">
    <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
      <Icon className="w-2.5 h-2.5" />
      {label}
    </div>
    <div className={`text-lg font-mono font-medium ${color}`}>
      {value}{suffix}
    </div>
  </Card>
);

const Backtest = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [showTradeLog, setShowTradeLog] = useState(false);

  // Config state
  const [tickerInput, setTickerInput] = useState("AAPL");
  const [startYear, setStartYear] = useState(2020);
  const [endYear, setEndYear] = useState(2025);
  const [initialCapital, setInitialCapital] = useState(10000);
  const [positionSize, setPositionSize] = useState(10);
  const [stopLoss, setStopLoss] = useState(5);
  const [takeProfit, setTakeProfit] = useState(10);
  const [includeMonteCarlo, setIncludeMonteCarlo] = useState(true);

  const handleRunBacktest = async () => {
    if (!session?.access_token) {
      toast.error("Please sign in to run backtests");
      navigate("/auth");
      return;
    }

    const tickers = tickerInput.split(",").map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 5);
    if (tickers.length === 0) { toast.error("Enter at least one ticker"); return; }

    setIsLoading(true);
    setReport(null);

    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/backtest`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            tickers,
            startYear,
            endYear,
            initialCapital,
            positionSizePct: positionSize,
            stopLossPct: stopLoss,
            takeProfitPct: takeProfit,
            includeMonteCarlo,
          }),
        }
      );

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Backtest failed");
      }

      const data: BacktestReport = await resp.json();
      setReport(data);
      toast.success(`Backtest complete: ${data.totalTrades} trades analyzed`);
    } catch (e) {
      console.error("Backtest error:", e);
      toast.error(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
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
              Walk-forward backtesting with institutional-grade metrics
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

                  {/* Tickers */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Tickers (comma-separated, max 5)</Label>
                    <Input value={tickerInput} onChange={e => setTickerInput(e.target.value.toUpperCase())} placeholder="AAPL, MSFT, GOOGL" variant="glass" />
                  </div>

                  {/* Date Range */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Start Year</Label>
                      <Input type="number" value={startYear} onChange={e => setStartYear(Number(e.target.value))} min={2010} max={2025} variant="glass" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">End Year</Label>
                      <Input type="number" value={endYear} onChange={e => setEndYear(Number(e.target.value))} min={2015} max={2026} variant="glass" />
                    </div>
                  </div>

                  {/* Capital */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Initial Capital: ${initialCapital.toLocaleString()}</Label>
                    <Slider value={[initialCapital]} onValueChange={v => setInitialCapital(v[0])} min={1000} max={100000} step={1000} />
                  </div>

                  {/* Position Size */}
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Position Size: {positionSize}%</Label>
                    <Slider value={[positionSize]} onValueChange={v => setPositionSize(v[0])} min={5} max={50} step={5} />
                  </div>

                  {/* Stop Loss / Take Profit */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Stop Loss: {stopLoss}%</Label>
                      <Slider value={[stopLoss]} onValueChange={v => setStopLoss(v[0])} min={1} max={20} step={1} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Take Profit: {takeProfit}%</Label>
                      <Slider value={[takeProfit]} onValueChange={v => setTakeProfit(v[0])} min={2} max={30} step={1} />
                    </div>
                  </div>

                  {/* Monte Carlo Toggle */}
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Shuffle className="w-3 h-3" />
                      Monte Carlo (1,000 sims)
                    </Label>
                    <Switch checked={includeMonteCarlo} onCheckedChange={setIncludeMonteCarlo} />
                  </div>

                  <Button onClick={handleRunBacktest} disabled={isLoading} className="w-full gap-2">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    {isLoading ? "Running Backtest..." : "Run Backtest"}
                  </Button>
                </Card>

                {/* Trading Costs Info */}
                <Card className="glass-card p-4">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Realistic Trading Costs</div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex justify-between"><span>Commission</span><span className="font-mono">0.1%</span></div>
                    <div className="flex justify-between"><span>Spread</span><span className="font-mono">0.05%</span></div>
                    <div className="flex justify-between"><span>Slippage</span><span className="font-mono">±0.1%</span></div>
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
                      Test the quantitative prediction engine against historical data with walk-forward validation, realistic trading costs, and Monte Carlo simulation.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-lg mx-auto">
                      {[
                        { icon: Activity, label: "Walk-Forward" },
                        { icon: DollarSign, label: "Trading Costs" },
                        { icon: Shuffle, label: "Monte Carlo" },
                        { icon: Trophy, label: "Pro Metrics" },
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
                    <p className="text-sm text-muted-foreground">Running walk-forward backtest...</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Fetching historical data & simulating trades</p>
                  </motion.div>
                ) : report ? (
                  <motion.div key="report" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                    {/* Summary Metrics */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricCard label="Total Return" value={`${report.totalReturn > 0 ? "+" : ""}${report.totalReturn}`} suffix="%" icon={TrendingUp}
                        color={report.totalReturn > 0 ? "text-success" : "text-destructive"} />
                      <MetricCard label="Win Rate" value={report.winRate} suffix="%" icon={Target}
                        color={report.winRate > 50 ? "text-success" : "text-destructive"} />
                      <MetricCard label="Max Drawdown" value={`-${report.maxDrawdown}`} suffix="%" icon={TrendingDown} color="text-destructive" />
                      <MetricCard label="Total Trades" value={report.totalTrades} icon={Activity} />
                    </div>

                    {/* Pro Metrics */}
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

                    {/* Benchmark Comparison */}
                    <Card className="glass-card p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs text-muted-foreground">Strategy vs SPY Buy & Hold</div>
                          <div className="flex items-center gap-4 mt-1">
                            <span className={`text-lg font-mono font-medium ${report.totalReturn > 0 ? "text-success" : "text-destructive"}`}>
                              Strategy: {report.totalReturn > 0 ? "+" : ""}{report.totalReturn}%
                            </span>
                            <span className="text-lg font-mono font-medium text-muted-foreground">
                              SPY: {report.benchmarkReturn > 0 ? "+" : ""}{report.benchmarkReturn}%
                            </span>
                          </div>
                        </div>
                        <Badge variant={report.totalReturn > report.benchmarkReturn ? "default" : "destructive"}>
                          {report.totalReturn > report.benchmarkReturn ? "Outperforms" : "Underperforms"}
                        </Badge>
                      </div>
                    </Card>

                    {/* Prediction Accuracy */}
                    <div className="grid grid-cols-3 gap-3">
                      <MetricCard label="Dir. Accuracy" value={report.directionalAccuracy} suffix="%" icon={Target}
                        color={report.directionalAccuracy > 50 ? "text-success" : "text-destructive"} />
                      <MetricCard label="MAE" value={report.mae} suffix="%" icon={Activity} />
                      <MetricCard label="RMSE" value={report.rmse} suffix="%" icon={BarChart3} />
                    </div>

                    {/* Equity Curve */}
                    {report.equityCurve.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-2 h-2 rounded-full bg-primary" />
                          <span className="text-sm font-medium">Equity Curve</span>
                        </div>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={report.equityCurve}>
                              <defs>
                                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="hsl(143 35% 45%)" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="hsl(143 35% 45%)" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(0 0% 50%)" }}
                                tickFormatter={v => v.substring(0, 7)} interval="preserveStartEnd" />
                              <YAxis tick={{ fontSize: 10, fill: "hsl(0 0% 50%)" }}
                                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                              <Tooltip contentStyle={{ background: "hsl(0 0% 5%)", border: "1px solid hsl(0 0% 12%)", borderRadius: 8, fontSize: 12 }}
                                formatter={(v: number) => [`$${v.toFixed(0)}`, "Portfolio"]}
                                labelFormatter={l => l} />
                              <ReferenceLine y={initialCapital} stroke="hsl(0 0% 30%)" strokeDasharray="3 3" label={{ value: "Initial", fill: "hsl(0 0% 40%)", fontSize: 10 }} />
                              <Area type="monotone" dataKey="value" stroke="hsl(143 35% 45%)" fill="url(#equityGrad)" strokeWidth={2} dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    )}

                    {/* Drawdown Curve */}
                    {report.drawdownCurve.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-2 h-2 rounded-full bg-destructive" />
                          <span className="text-sm font-medium">Drawdown</span>
                        </div>
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={report.drawdownCurve}>
                              <defs>
                                <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="hsl(0 72% 51%)" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="hsl(0 72% 51%)" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(0 0% 50%)" }}
                                tickFormatter={v => v.substring(0, 7)} interval="preserveStartEnd" />
                              <YAxis tick={{ fontSize: 10, fill: "hsl(0 0% 50%)" }}
                                tickFormatter={v => `${v}%`} />
                              <Tooltip contentStyle={{ background: "hsl(0 0% 5%)", border: "1px solid hsl(0 0% 12%)", borderRadius: 8, fontSize: 12 }}
                                formatter={(v: number) => [`${v}%`, "Drawdown"]} />
                              <Area type="monotone" dataKey="drawdown" stroke="hsl(0 72% 51%)" fill="url(#ddGrad)" strokeWidth={1.5} dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </Card>
                    )}

                    {/* Regime Performance */}
                    {report.regimePerformance.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="text-sm font-medium mb-4">Regime Performance</div>
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

                    {/* Confidence Calibration */}
                    {report.confidenceCalibration.length > 0 && (
                      <Card className="glass-card p-6">
                        <div className="text-sm font-medium mb-4">Confidence Calibration</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border/30">
                                <th className="text-left py-2 text-muted-foreground font-normal">Bucket</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Predicted</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Actual</th>
                                <th className="text-right py-2 text-muted-foreground font-normal">Count</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.confidenceCalibration.map(cc => (
                                <tr key={cc.bucket} className="border-b border-border/10">
                                  <td className="py-2 font-mono">{cc.bucket}</td>
                                  <td className="text-right py-2 font-mono">{cc.predictedConf}%</td>
                                  <td className={`text-right py-2 font-mono ${
                                    Math.abs(cc.actualAccuracy - cc.predictedConf) < 10 ? "text-success" : "text-warning"
                                  }`}>{cc.actualAccuracy}%</td>
                                  <td className="text-right py-2 font-mono text-muted-foreground">{cc.count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Card>
                    )}

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
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 20%)" />
                              <XAxis dataKey="start" tick={{ fontSize: 10, fill: "hsl(0 0% 50%)" }}
                                tickFormatter={v => v.substring(0, 4)} />
                              <YAxis tick={{ fontSize: 10, fill: "hsl(0 0% 50%)" }}
                                tickFormatter={v => `${v}%`} />
                              <Tooltip contentStyle={{ background: "hsl(0 0% 5%)", border: "1px solid hsl(0 0% 12%)", borderRadius: 8, fontSize: 12 }}
                                formatter={(v: number, name: string) => [`${v}%`, name === "accuracy" ? "Accuracy" : "Return"]} />
                              <Bar dataKey="accuracy" name="accuracy" radius={[4, 4, 0, 0]}>
                                {report.periods.map((p, i) => (
                                  <Cell key={i} fill={p.accuracy > 50 ? "hsl(143 35% 45%)" : "hsl(0 72% 51%)"} />
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
                          <span className="text-sm font-medium">Monte Carlo Simulation (1,000 runs)</span>
                        </div>
                        <div className="grid grid-cols-5 gap-3">
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

                    {/* Trade Log Toggle */}
                    <Card className="glass-card p-4">
                      <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setShowTradeLog(!showTradeLog)}>
                        {showTradeLog ? "Hide" : "Show"} Trade Log ({report.tradeLog.length} trades)
                      </Button>
                      {showTradeLog && (
                        <div className="mt-4 max-h-96 overflow-y-auto scrollbar-thin">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-card">
                              <tr className="border-b border-border/30">
                                <th className="text-left py-1.5 text-muted-foreground font-normal">Date</th>
                                <th className="text-left py-1.5 text-muted-foreground font-normal">Ticker</th>
                                <th className="text-left py-1.5 text-muted-foreground font-normal">Action</th>
                                <th className="text-right py-1.5 text-muted-foreground font-normal">Entry</th>
                                <th className="text-right py-1.5 text-muted-foreground font-normal">Exit</th>
                                <th className="text-right py-1.5 text-muted-foreground font-normal">Return</th>
                                <th className="text-right py-1.5 text-muted-foreground font-normal">PnL</th>
                              </tr>
                            </thead>
                            <tbody>
                              {report.tradeLog.map((t, i) => (
                                <tr key={i} className="border-b border-border/5">
                                  <td className="py-1 font-mono text-muted-foreground">{t.date}</td>
                                  <td className="py-1 font-mono">{t.ticker}</td>
                                  <td className={`py-1 font-medium ${t.action === "BUY" ? "text-success" : "text-destructive"}`}>{t.action}</td>
                                  <td className="py-1 text-right font-mono">${t.entryPrice.toFixed(2)}</td>
                                  <td className="py-1 text-right font-mono">${t.exitPrice.toFixed(2)}</td>
                                  <td className={`py-1 text-right font-mono ${t.returnPct > 0 ? "text-success" : "text-destructive"}`}>
                                    {t.returnPct > 0 ? "+" : ""}{t.returnPct.toFixed(2)}%
                                  </td>
                                  <td className={`py-1 text-right font-mono ${t.pnl > 0 ? "text-success" : "text-destructive"}`}>
                                    ${t.pnl.toFixed(0)}
                                  </td>
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
                        Past performance does not guarantee future results. Backtests use historical data and may not reflect real trading conditions.
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
