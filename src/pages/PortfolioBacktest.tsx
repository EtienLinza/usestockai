// ============================================================================
// PORTFOLIO BACKTEST PAGE
//
// Runs the LIVE autotrader gate stack over a user-picked universe and date
// range. Long-running: work is chunked server-side into resumable ticks so
// runs that take minutes-to-hours reliably complete even if the browser
// closes. Poll status every 3s while a job is active.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Play, Loader2, XCircle, Clock, TrendingUp, TrendingDown, Trophy, Percent, DollarSign, RefreshCw, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

type JobStatus = "queued" | "fetching_bars" | "simulating" | "finalizing" | "done" | "failed" | "cancelled";

interface JobRow {
  id: string;
  name: string | null;
  universe: string[];
  start_date: string;
  end_date: string;
  starting_nav: number;
  status: JobStatus;
  stage: string;
  progress_pct: number;
  current_step_note: string | null;
  cpu_ms_spent: number;
  created_at: string;
  finished_at: string | null;
  error: string | null;
  report?: any;
}

const PRESETS: Record<string, string[]> = {
  "S&P 30 (Blue chip)": ["AAPL","MSFT","GOOGL","AMZN","META","NVDA","TSLA","JPM","V","JNJ","WMT","PG","XOM","UNH","MA","HD","CVX","BAC","ABBV","PFE","KO","AVGO","LLY","COST","MRK","PEP","TMO","DIS","MCD","CSCO"],
  "Nasdaq 25 (Tech-heavy)": ["AAPL","MSFT","NVDA","GOOG","AMZN","META","TSLA","AVGO","COST","NFLX","ADBE","PEP","AMD","INTC","QCOM","INTU","AMAT","BKNG","CSCO","TXN","HON","SBUX","GILD","MDLZ","ADI"],
  "Small basket (5)": ["AAPL","MSFT","NVDA","TSLA","AMD"],
};

export default function PortfolioBacktest() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [universeText, setUniverseText] = useState<string>(PRESETS["S&P 30 (Blue chip)"].join(", "));
  const [startDate, setStartDate] = useState<string>("2023-01-01");
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [startingNav, setStartingNav] = useState<number>(100_000);
  const [runName, setRunName] = useState<string>("");
  const [unlimited, setUnlimited] = useState<boolean>(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobRow | null>(null);
  const [history, setHistory] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => { if (!user) navigate("/auth"); }, [user, navigate]);

  const parsedUniverse = useMemo(() => {
    return Array.from(new Set(
      universeText.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
    ));
  }, [universeText]);

  const invalid = useMemo(() => parsedUniverse.filter(t => !/^[A-Z]{1,10}(-[A-Z]{2,4})?$/.test(t)), [parsedUniverse]);

  const estimateMinutes = useMemo(() => {
    const days = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (24 * 3600 * 1000)));
    const tickerDays = parsedUniverse.length * days;
    // rough: ~40k ticker-days per minute of server compute
    return Math.max(1, Math.round(tickerDays / 40_000));
  }, [parsedUniverse.length, startDate, endDate]);

  async function loadHistory() {
    try {
      const { data, error } = await supabase.functions.invoke("backtest-portfolio-status", {
        method: "GET" as any,
      });
      // The functions client doesn't support query strings well; call fetch directly.
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      const url = `${(import.meta as any).env.VITE_SUPABASE_URL || ""}/functions/v1/backtest-portfolio-status?list=1`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, apikey: (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY || "" } });
      const j = await r.json();
      if (j?.jobs) setHistory(j.jobs);
      void data; void error;
    } catch (e) { console.error(e); }
  }
  useEffect(() => { if (user) loadHistory(); }, [user]);

  async function pollJob(id: string) {
    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      const url = `${(import.meta as any).env.VITE_SUPABASE_URL || ""}/functions/v1/backtest-portfolio-status?job_id=${id}&omit_state=1`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, apikey: (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY || "" } });
      const j = await r.json();
      if (j?.job) {
        setJob(j.job);
        if (["done", "failed", "cancelled"].includes(j.job.status)) {
          if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
          loadHistory();
        }
      }
    } catch (e) { console.error(e); }
  }

  useEffect(() => {
    if (!jobId) return;
    pollJob(jobId);
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(() => pollJob(jobId), 3000);
    return () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function startBacktest() {
    if (!unlimited) {
      if (parsedUniverse.length === 0) return toast.error("Add at least one ticker");
      if (invalid.length > 0) return toast.error(`Invalid tickers: ${invalid.slice(0, 5).join(", ")}`);
      if (parsedUniverse.length > 250) return toast.error("Universe capped at 250 tickers — enable Unlimited mode for the full index");
    }
    if (startDate >= endDate) return toast.error("Start must be before end");
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        name: runName || (unlimited
          ? `S&P 500 (Unlimited) · ${startDate} → ${endDate}`
          : `${parsedUniverse.length} tickers · ${startDate} → ${endDate}`),
        start_date: startDate,
        end_date: endDate,
        starting_nav: startingNav,
      };
      if (unlimited) { payload.unlimited = true; payload.index_name = "SP500"; }
      else payload.universe = parsedUniverse;
      const { data, error } = await supabase.functions.invoke("backtest-portfolio-start", { body: payload });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setJobId(data.job_id);
      setJob(null);
      toast.success(unlimited
        ? "Unlimited backtest queued — first run fetches ~500 tickers, then cached forever."
        : "Backtest queued — this may take a while. You can safely close this tab.");
    } catch (e: any) {
      toast.error(e?.message || "Failed to start backtest");
    } finally {
      setLoading(false);
    }
  }

  async function cancelJob() {
    if (!jobId) return;
    try {
      await supabase.functions.invoke("backtest-portfolio-cancel", { body: { job_id: jobId } });
      toast.success("Backtest cancelled");
      pollJob(jobId);
    } catch (e: any) { toast.error(e?.message || "Cancel failed"); }
  }

  async function deleteRun(id: string) {
    if (!confirm("Delete this backtest run?")) return;
    try {
      await supabase.from("backtest_portfolio_jobs").delete().eq("id", id);
      if (jobId === id) { setJobId(null); setJob(null); }
      loadHistory();
      toast.success("Deleted");
    } catch (e: any) { toast.error(e?.message || "Delete failed"); }
  }

  async function reopen(id: string) {
    setJobId(id);
    // fetch full report
    try {
      const sessionRes = await supabase.auth.getSession();
      const token = sessionRes.data.session?.access_token;
      const url = `${(import.meta as any).env.VITE_SUPABASE_URL || ""}/functions/v1/backtest-portfolio-status?job_id=${id}&omit_state=1`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, apikey: (import.meta as any).env.VITE_SUPABASE_PUBLISHABLE_KEY || "" } });
      const j = await r.json();
      if (j?.job) setJob(j.job);
    } catch (e) { console.error(e); }
  }

  const report = job?.report;
  const isActive = job && !["done", "failed", "cancelled"].includes(job.status);

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Portfolio Backtest — Run the live autotrader over history"
        description="Backtest your entire trading strategy across a universe of tickers with the same gate stack we use live."
        path="/portfolio-backtest"
      />
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <h1 className="text-3xl font-light tracking-tight">Portfolio Backtest</h1>
          <p className="text-sm text-muted-foreground">
            Run the live autotrader (scan → gates → open → manage) over history. Long-running jobs are safe to leave —
            the backtest continues in the background and results are archived to your history.
          </p>
        </motion.div>

        {/* Setup card */}
        <Card className="p-6 space-y-5">
          <div className="space-y-2">
            <Label>Universe (comma or newline separated tickers)</Label>
            <Textarea
              value={universeText}
              onChange={(e) => setUniverseText(e.target.value)}
              rows={4}
              className="font-mono text-xs"
              placeholder="AAPL, MSFT, NVDA…"
            />
            <div className="flex flex-wrap gap-2 items-center text-xs">
              <span className="text-muted-foreground">Presets:</span>
              {Object.keys(PRESETS).map(k => (
                <Button key={k} type="button" size="sm" variant="ghost" onClick={() => setUniverseText(PRESETS[k].join(", "))}>
                  {k}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">{parsedUniverse.length} valid ticker{parsedUniverse.length === 1 ? "" : "s"}</span>
              {invalid.length > 0 && <span className="text-destructive">Invalid: {invalid.slice(0, 5).join(", ")}</span>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>End date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Starting capital ($)</Label>
              <Input type="number" min={1000} step={1000} value={startingNav} onChange={(e) => setStartingNav(Number(e.target.value) || 100_000)} />
            </div>
            <div className="space-y-2">
              <Label>Run name (optional)</Label>
              <Input value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="e.g. 'Tech 2023'" />
            </div>
          </div>

          <div className="p-3 rounded-md border bg-muted/30 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <Clock className="h-3.5 w-3.5" />
              Estimated runtime: ~{estimateMinutes} minute{estimateMinutes === 1 ? "" : "s"}
            </div>
            <p className="mt-1">
              Bars are fetched once and cached globally so repeat runs on the same tickers skip that step.
              You can close this tab — the backtest continues on the server. Cap: 250 tickers per run.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button onClick={startBacktest} disabled={loading || Boolean(isActive)} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {isActive ? "A run is in progress" : "Start portfolio backtest"}
            </Button>
          </div>
        </Card>

        {/* Live job progress */}
        {job && (
          <Card className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant={job.status === "done" ? "default" : job.status === "failed" || job.status === "cancelled" ? "destructive" : "secondary"}>
                    {job.status}
                  </Badge>
                  <span className="text-sm font-medium">{job.name}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {job.universe.length} tickers · {job.start_date} → {job.end_date} · started {new Date(job.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-2">
                {isActive && <Button size="sm" variant="outline" onClick={cancelJob} className="gap-2"><XCircle className="h-4 w-4" />Cancel</Button>}
                {jobId && <Button size="sm" variant="ghost" onClick={() => pollJob(jobId)} className="gap-2"><RefreshCw className="h-4 w-4" />Refresh</Button>}
              </div>
            </div>
            <div>
              <Progress value={Number(job.progress_pct) || 0} className="h-2" />
              <div className="mt-2 text-xs text-muted-foreground">{job.current_step_note || "Waiting…"}</div>
            </div>
            {job.error && <div className="p-3 text-xs rounded-md bg-destructive/10 text-destructive border border-destructive/30">{job.error}</div>}
          </Card>
        )}

        {/* Report */}
        {report && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric icon={<DollarSign className="h-4 w-4" />} label="Final NAV" value={`$${report.finalNav.toLocaleString()}`} />
              <Metric icon={report.totalReturn >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-500" /> : <TrendingDown className="h-4 w-4 text-destructive" />} label="Total return" value={`${report.totalReturn.toFixed(2)}%`} />
              <Metric icon={<Percent className="h-4 w-4" />} label="CAGR" value={`${report.cagr.toFixed(2)}%`} />
              <Metric icon={<Trophy className="h-4 w-4" />} label="Sharpe" value={report.sharpeRatio.toFixed(2)} />
              <Metric icon={<Percent className="h-4 w-4" />} label="Win rate" value={`${report.winRate.toFixed(1)}%`} />
              <Metric icon={<TrendingDown className="h-4 w-4" />} label="Max drawdown" value={`${report.maxDrawdown.toFixed(2)}%`} />
              <Metric label="Profit factor" value={report.profitFactor.toFixed(2)} />
              <Metric label="Trades" value={String(report.totalTrades)} />
            </div>

            {report.equityCurve?.length > 0 && (
              <Card className="p-4">
                <div className="text-sm font-medium mb-3">Equity curve</div>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={report.equityCurve}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                    <Tooltip formatter={(v: any) => `$${Number(v).toLocaleString()}`} />
                    <ReferenceLine y={report.startNav} strokeDasharray="3 3" opacity={0.4} />
                    <Area type="monotone" dataKey="nav" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            )}

            {report.strategyBreakdown?.length > 0 && (
              <Card className="p-4">
                <div className="text-sm font-medium mb-3">Strategy breakdown</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  {report.strategyBreakdown.map((s: any) => (
                    <div key={s.strategy} className="p-3 rounded-md border">
                      <div className="font-medium capitalize">{s.strategy}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {s.trades} trades · {s.winRate}% win · ${s.pnl.toLocaleString()} PnL
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {report.trades?.length > 0 && (
              <Card className="p-4">
                <div className="text-sm font-medium mb-3">Trades ({report.trades.length})</div>
                <div className="max-h-96 overflow-auto text-xs">
                  <table className="w-full">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left p-2">Ticker</th>
                        <th className="text-left p-2">Side</th>
                        <th className="text-left p-2">Entry</th>
                        <th className="text-left p-2">Exit</th>
                        <th className="text-right p-2">PnL</th>
                        <th className="text-right p-2">%</th>
                        <th className="text-right p-2">R</th>
                        <th className="text-left p-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.trades.slice(0, 500).map((t: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-muted/30">
                          <td className="p-2 font-mono">{t.ticker}</td>
                          <td className="p-2">{t.side}</td>
                          <td className="p-2">{t.entryDate}</td>
                          <td className="p-2">{t.exitDate}</td>
                          <td className={`p-2 text-right ${t.pnl >= 0 ? "text-emerald-500" : "text-destructive"}`}>${t.pnl.toFixed(2)}</td>
                          <td className={`p-2 text-right ${t.pnlPct >= 0 ? "text-emerald-500" : "text-destructive"}`}>{t.pnlPct.toFixed(2)}%</td>
                          <td className="p-2 text-right">{t.rMultiple.toFixed(2)}</td>
                          <td className="p-2 text-muted-foreground">{t.exitReason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report.trades.length > 500 && <div className="p-2 text-center text-muted-foreground">Showing first 500 of {report.trades.length}.</div>}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <Card className="p-4">
            <div className="text-sm font-medium mb-3">Your backtest history</div>
            <div className="space-y-2">
              {history.map(h => (
                <div key={h.id} className="flex items-center justify-between p-3 border rounded-md hover:bg-muted/30">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{h.name || `${h.universe.length} tickers`}</div>
                    <div className="text-xs text-muted-foreground">
                      {h.universe.length} tickers · {h.start_date} → {h.end_date} · {new Date(h.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={h.status === "done" ? "default" : h.status === "failed" || h.status === "cancelled" ? "destructive" : "secondary"}>{h.status}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => reopen(h.id)}>Open</Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteRun(h.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}

function Metric({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-xl font-light mt-1">{value}</div>
    </Card>
  );
}
