import { useEffect, useMemo, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/MetricCard";
import { TickerLink } from "@/components/TickerLink";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface Pos {
  id: string; ticker: string; status: string; shares: number; original_shares: number | null;
  entry_price: number; hard_stop_price: number | null; pnl: number | null; campaign_id: string | null;
  exit_reason: string | null; exit_cause: string | null; stop_slippage_pct: number | null;
  created_at: string; closed_at: string | null; position_type: string;
}
interface Bars { ticker: string; as_of: string; updated_at: string; bars: { close?: number[] } }

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
function ageLabel(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6;
  return h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
}

export default function Reconciliation() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<Pos[]>([]);
  const [bars, setBars] = useState<Map<string, Bars>>(new Map());
  const [startNav, setStartNav] = useState(100000);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [invariants, setInvariants] = useState(0);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: pos }, { data: s }, { data: log }, { count }] = await Promise.all([
        supabase.from("virtual_positions").select("*").eq("user_id", user.id).limit(2000),
        supabase.from("autotrade_settings").select("starting_nav, last_scan_at").eq("user_id", user.id).maybeSingle(),
        supabase.from("autotrade_log").select("created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1),
        supabase.from("autotrade_log").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("action", "INVARIANT"),
      ]);
      const list = (pos ?? []) as unknown as Pos[];
      setPositions(list);
      setStartNav(Number(s?.starting_nav ?? 100000));
      setLastScan(s?.last_scan_at ?? log?.[0]?.created_at ?? null);
      setInvariants(count ?? 0);
      const held = [...new Set(list.filter((p) => p.status === "open").map((p) => p.ticker.toUpperCase()))];
      if (held.length) {
        const { data: b } = await supabase.from("ticker_bars_cache").select("ticker, as_of, updated_at, bars")
          .in("ticker", held).order("as_of", { ascending: false });
        const m = new Map<string, Bars>();
        for (const r of (b ?? []) as unknown as Bars[]) if (!m.has(r.ticker)) m.set(r.ticker, r);
        setBars(m);
      }
      setLoading(false);
    })();
  }, [user]);

  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status === "closed");

  const campaigns = useMemo(() => {
    const g = new Map<string, { ticker: string; pnl: number; legs: number }>();
    for (const p of closed) {
      const k = p.campaign_id ?? p.id;
      const c = g.get(k) ?? { ticker: p.ticker, pnl: 0, legs: 0 };
      c.pnl += Number(p.pnl ?? 0); c.legs++; g.set(k, c);
    }
    const arr = [...g.values()];
    const wins = arr.filter((c) => c.pnl > 0);
    const losses = arr.filter((c) => c.pnl <= 0);
    const grossW = wins.reduce((s, c) => s + c.pnl, 0);
    const grossL = Math.abs(losses.reduce((s, c) => s + c.pnl, 0));
    const rowWins = closed.filter((p) => Number(p.pnl ?? 0) > 0).length;
    return {
      n: arr.length, rows: closed.length,
      winRate: arr.length ? wins.length / arr.length : 0,
      rowWinRate: closed.length ? rowWins / closed.length : 0,
      expectancy: arr.length ? (grossW - grossL) / arr.length : 0,
      avgWin: wins.length ? grossW / wins.length : 0,
      avgLoss: losses.length ? grossL / losses.length : 0,
      pf: grossL > 0 ? grossW / grossL : Infinity,
    };
  }, [closed]);

  const realized = closed.reduce((s, p) => s + Number(p.pnl ?? 0), 0);
  const nav = startNav + realized;

  const rows = open.map((p) => {
    const b = bars.get(p.ticker.toUpperCase());
    const closes = b?.bars?.close ?? [];
    const mark = closes.length ? Number(closes[closes.length - 1]) : Number(p.entry_price);
    const stop = p.hard_stop_price != null ? Number(p.hard_stop_price) : null;
    const isLong = p.position_type !== "short";
    const toStop = stop ? (isLong ? (mark - stop) / mark : (stop - mark) / mark) * 100 : null;
    const value = mark * Number(p.shares);
    return { p, mark, stop, toStop, value, navPct: (value / nav) * 100, age: b?.updated_at ?? null };
  }).sort((a, b) => b.value - a.value);

  const staleCount = rows.filter((r) => !r.age || Date.now() - new Date(r.age).getTime() > 36 * 3.6e6).length;
  const belowStop = rows.filter((r) => r.toStop != null && r.toStop < 0).length;
  const causes = closed.reduce<Record<string, number>>((m, p) => {
    if (p.exit_cause) m[p.exit_cause] = (m[p.exit_cause] ?? 0) + 1; return m;
  }, {});

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Reconciliation — StockAI" description="Data freshness, stop distance and true trade-level performance." path="/reconciliation" />
      <Navbar />
      <main className="container max-w-6xl mx-auto px-4 pt-24 pb-16 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Reconciliation</h1>
          <p className="text-sm text-muted-foreground mt-1">An honest check of the books: how fresh the data is, how close each holding is to its stop, and performance counted by whole trade.</p>
        </header>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Health</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Last scan" value={lastScan ? `${ageLabel(lastScan)} ago` : "—"} />
                <MetricCard label="Stale price data" value={`${staleCount} / ${rows.length}`} />
                <MetricCard label="Below stop" value={String(belowStop)} />
                <MetricCard label="Share mismatches" value={String(invariants)} />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">True performance (by whole trade)</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Trades" value={`${campaigns.n}`} />
                <MetricCard label="Win rate" value={`${(campaigns.winRate * 100).toFixed(1)}%`} />
                <MetricCard label="Avg per trade" value={money(campaigns.expectancy)} />
                <MetricCard label="Profit factor" value={Number.isFinite(campaigns.pf) ? campaigns.pf.toFixed(2) : "—"} />
              </div>
              <p className="text-xs text-muted-foreground">
                Counting every partial sale separately gives {campaigns.rows} rows and a {(campaigns.rowWinRate * 100).toFixed(1)}% win rate.
                Grouped into whole trades: avg win {money(campaigns.avgWin)}, avg loss −{money(campaigns.avgLoss).replace("−", "")}.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Open positions</h2>
              {rows.length === 0 ? <p className="text-sm text-muted-foreground">No open positions.</p> : (
                <>
                  <div className="hidden md:block">
                    <Card className="overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground border-b border-border/30">
                          <tr>{["Ticker", "Shares", "Mark", "Stop", "To stop", "% of account", "Data age"].map((h) => <th key={h} className="text-left font-medium px-4 py-2">{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.p.id} className="border-b border-border/10 last:border-0">
                              <td className="px-4 py-2"><TickerLink ticker={r.p.ticker} /></td>
                              <td className="px-4 py-2">{Number(r.p.shares)}{r.p.original_shares && Number(r.p.original_shares) !== Number(r.p.shares) ? <span className="text-muted-foreground"> / {Number(r.p.original_shares)}</span> : null}</td>
                              <td className="px-4 py-2">${r.mark.toFixed(2)}</td>
                              <td className="px-4 py-2">{r.stop ? `$${r.stop.toFixed(2)}` : "—"}</td>
                              <td className={cn("px-4 py-2", r.toStop != null && r.toStop < 0 ? "text-destructive" : r.toStop != null && r.toStop < 2 ? "text-warning" : "")}>{r.toStop != null ? `${r.toStop.toFixed(1)}%` : "—"}</td>
                              <td className={cn("px-4 py-2", r.navPct > 15 ? "text-warning" : "")}>{r.navPct.toFixed(1)}%</td>
                              <td className="px-4 py-2 text-muted-foreground">{r.age ? ageLabel(r.age) : "none"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Card>
                  </div>
                  <div className="grid gap-2 md:hidden">
                    {rows.map((r) => (
                      <Card key={r.p.id} className="p-3 flex items-center justify-between text-sm">
                        <div><TickerLink ticker={r.p.ticker} /><div className="text-xs text-muted-foreground">{Number(r.p.shares)} sh · {r.navPct.toFixed(1)}% of account</div></div>
                        <div className={cn("text-right", r.toStop != null && r.toStop < 0 ? "text-destructive" : "")}>{r.toStop != null ? `${r.toStop.toFixed(1)}% to stop` : "no stop"}</div>
                      </Card>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Stop-loss fills</h2>
              <div className="flex flex-wrap gap-2">
                {Object.keys(causes).length === 0 ? <p className="text-sm text-muted-foreground">No stop-loss sales recorded yet.</p> :
                  Object.entries(causes).map(([k, v]) => (
                    <Badge key={k} variant="outline" className="text-xs">
                      {k === "gap_through" ? "Gapped past stop" : k === "slippage" ? "Small slippage" : "Filled at stop"}: {v}
                    </Badge>
                  ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
