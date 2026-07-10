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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Play, Loader2, XCircle, Clock, TrendingUp, TrendingDown, Trophy, Percent, DollarSign, RefreshCw, Trash2, Infinity as InfinityIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { UpgradeRequiredModal } from "@/components/UpgradeRequiredModal";
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

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  fetching_bars: "Fetching bars",
  simulating: "Simulating",
  finalizing: "Finalizing",
  done: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
};
const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "done" ? "default"
  : s === "failed" || s === "cancelled" ? "destructive"
  : "secondary";

export default function PortfolioBacktest() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isElite, loading: tierLoading } = useTier();
  const [gateOpen, setGateOpen] = useState<boolean>(false);
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
    const calDays = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (24 * 3600 * 1000)));
    const tradingDays = Math.max(1, Math.round(calDays * (252 / 365)));
    const tickers = unlimited ? 500 : parsedUniverse.length;
    // Sim throughput: ~120k ticker-days/min. First-run fetch: ~4s/ticker (cached after).
    const simMin = (tickers * tradingDays) / 120_000;
    const fetchMin = (tickers * 4) / 60; // upper bound; skipped when cached
    return Math.max(1, Math.round(simMin + fetchMin));
  }, [parsedUniverse.length, startDate, endDate, unlimited]);

  // Queue position: how many active jobs are ahead of ours (server processes one at a time).
  const [queueAhead, setQueueAhead] = useState<number>(0);
  useEffect(() => {
    if (!job || job.status !== "queued") { setQueueAhead(0); return; }
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("backtest_portfolio_jobs")
        .select("id", { count: "exact", head: true })
        .in("status", ["queued", "fetching_bars", "simulating", "finalizing"])
        .lt("created_at", job.created_at);
      if (!cancelled) setQueueAhead(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [job?.status, job?.created_at]);

  // NOTE: status/cancel/list previously went through edge functions that were
  // just RLS-gated table reads/updates. Moved to direct supabase-js calls to
  // eliminate per-poll edge-function invocations (every 3s × every open tab).
  async function loadHistory() {
    try {
      const { data, error } = await supabase
        .from("backtest_portfolio_jobs")
        .select("id,name,universe,start_date,end_date,starting_nav,status,stage,progress_pct,current_step_note,cpu_ms_spent,created_at,finished_at,error")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setHistory(data ?? []);
    } catch (e) { console.error(e); }
  }
  useEffect(() => { if (user) loadHistory(); }, [user]);

  async function pollJob(id: string) {
    try {
      // omit the large `state` blob during polling — only pull it when needed
      const { data, error } = await supabase
        .from("backtest_portfolio_jobs")
        .select("id,name,universe,start_date,end_date,starting_nav,status,stage,progress_pct,current_step_note,cpu_ms_spent,created_at,finished_at,error,report")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setJob(data);
        if (["done", "failed", "cancelled"].includes(data.status)) {
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
    if (!tierLoading && !isElite) { setGateOpen(true); return; }
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
      const { error } = await supabase
        .from("backtest_portfolio_jobs")
        .update({ status: "cancelled", finished_at: new Date().toISOString() })
        .eq("id", jobId)
        .in("status", ["queued", "fetching_bars", "simulating", "finalizing"]);
      if (error) throw error;
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
    try {
      const { data, error } = await supabase
        .from("backtest_portfolio_jobs")
        .select("id,name,universe,start_date,end_date,starting_nav,status,stage,progress_pct,current_step_note,cpu_ms_spent,created_at,finished_at,error,report")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (data) setJob(data);
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
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-24 pb-16 space-y-8">
        <motion.header initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="h-1 w-1 rounded-full bg-primary" />
            Portfolio Backtest
            <span className="ml-1 rounded-sm border border-primary/40 text-primary px-1.5 py-[1px] text-[10px] tracking-widest">ELITE</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-light tracking-tight">Run the live engine over history</h1>
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
            The same scan, gate, and management stack the autotrader uses live — replayed across your chosen universe and window. Jobs run in the background; you can close the tab.
          </p>
        </motion.header>

        {/* Setup card */}
        <Card className="p-6 sm:p-8 space-y-6">
          <label
            htmlFor="unlimited-mode"
            className="group flex items-start gap-3 p-4 rounded-lg border border-primary/25 bg-primary/[0.04] cursor-pointer transition-colors hover:bg-primary/[0.06]"
          >
            <Checkbox
              id="unlimited-mode"
              checked={unlimited}
              onCheckedChange={(v) => setUnlimited(Boolean(v))}
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">
                <InfinityIcon className="h-3.5 w-3.5 text-primary" />
                Unlimited mode — full S&amp;P 500, time-accurate
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                Trades every constituent that existed in your window. Membership is enforced per day, so a name only trades when it was actually in the index. First run fetches ~500 tickers; bars are cached globally forever after.
              </p>
            </div>
          </label>

          {!unlimited && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Universe</Label>
              <Textarea
                value={universeText}
                onChange={(e) => setUniverseText(e.target.value)}
                rows={4}
                className="font-mono text-xs resize-none"
                placeholder="AAPL, MSFT, NVDA…"
              />
              <div className="flex flex-wrap gap-1.5 items-center pt-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-1">Presets</span>
                {Object.keys(PRESETS).map(k => (
                  <Button key={k} type="button" size="sm" variant="outline" className="h-7 text-xs font-normal" onClick={() => setUniverseText(PRESETS[k].join(", "))}>
                    {k}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-xs pt-1">
                <span className="text-muted-foreground">{parsedUniverse.length} valid ticker{parsedUniverse.length === 1 ? "" : "s"}</span>
                {invalid.length > 0 && <span className="text-destructive">Invalid: {invalid.slice(0, 5).join(", ")}</span>}
              </div>
            </div>
          )}

          <Separator />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="[color-scheme:dark]" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">End date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="[color-scheme:dark]" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Starting capital</Label>
              <Input type="number" min={1000} step={1000} value={startingNav} onChange={(e) => setStartingNav(Number(e.target.value) || 100_000)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Run name</Label>
              <Input value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 pt-2 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Est. runtime <span className="text-foreground font-medium">~{estimateMinutes} min</span>
              <span className="opacity-40">·</span>
              Bars cached globally after first fetch
            </div>
            <Button onClick={startBacktest} disabled={loading || Boolean(isActive)} className="gap-2 min-w-[220px]">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {isActive ? "Run in progress…" : "Start backtest"}
            </Button>
          </div>
        </Card>

        {/* Live job progress */}
        {job && (
          <Card className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={statusVariant(job.status)} className="font-normal">
                    {STATUS_LABEL[job.status] ?? job.status}
                  </Badge>
                  <span className="text-sm font-medium truncate">{job.name}</span>
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
              <div className="mt-2 text-xs text-muted-foreground">
                {job.status === "queued"
                  ? (queueAhead > 0
                      ? `Waiting in queue — ${queueAhead} job${queueAhead === 1 ? "" : "s"} ahead of you.`
                      : "Queued — starting shortly…")
                  : (job.current_step_note || "Waiting…")}
              </div>
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
          <Card className="p-6">
            <div className="flex items-baseline justify-between mb-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">History</div>
              <div className="text-[11px] text-muted-foreground">{history.length} run{history.length === 1 ? "" : "s"}</div>
            </div>
            <div className="divide-y divide-border/50">
              {history.map(h => (
                <div key={h.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{h.name || `${h.universe.length} tickers`}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {h.universe.length} tickers · {h.start_date} → {h.end_date} · {new Date(h.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant={statusVariant(h.status)} className="font-normal">{STATUS_LABEL[h.status] ?? h.status}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => reopen(h.id)}>Open</Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteRun(h.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </main>
      <UpgradeRequiredModal
        open={gateOpen}
        onOpenChange={setGateOpen}
        requiredTier="elite"
        feature="Portfolio backtest"
      />
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
