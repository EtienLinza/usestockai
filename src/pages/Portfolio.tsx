import { useEffect, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/MetricCard";
import { TickerLink } from "@/components/TickerLink";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Loader2, Wallet, ShieldAlert, Layers, Activity, Percent, RefreshCw, Lightbulb } from "lucide-react";

interface Holding {
  id: string; ticker: string; sector: string; shares: number; entry: number; last: number; value: number;
  weightPct: number; pnl: number; pnlPct: number; stopDistPct: number | null; beta: number; riskSharePct: number; ageDays: number;
}
interface Rec { priority: number; kind: string; ticker?: string; title: string; reason: string }
interface Data {
  nav: number; cash: number; invested: number; startNav: number; n: number;
  metrics: { beta: number; effNames: number; effBets: number; avgCorr: number; heatPct: number; varWeek95: number; volAnnualPct: number; cashPct: number; targetPositions: number; sectorCap: number; singleCapPct: number };
  sectors: { sector: string; pct: number }[];
  holdings: Holding[];
  correlation: { tickers: string[]; matrix: (number | null)[][] };
  recommendations: Rec[];
  asOf: string;
}

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const KIND_LABEL: Record<string, string> = {
  trim: "Trim", stop: "Near stop", rotate: "Rotate", sector: "Sector", overlap: "Overlap",
  deploy: "Cash", diversify: "Diversify", beta: "Market risk",
};

export default function Portfolio() {
  const { user } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    const { data: d, error: e } = await supabase.functions.invoke("portfolio-analytics");
    if (e || (d as { error?: string })?.error) setError("Couldn't load your portfolio right now.");
    else setData(d as Data);
    setLoading(false);
  };
  useEffect(() => { if (user) load(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = data?.metrics;
  const ret = data ? (data.nav / data.startNav - 1) * 100 : 0;

  return (
    <div className="min-h-screen bg-background">
      <SEO title="Portfolio — StockAI" description="Your whole book at a glance: risk, diversification and recommended actions." />
      <Navbar />
      <main className="container max-w-6xl mx-auto px-4 pt-24 pb-24 md:pb-12 space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Portfolio</h1>
            <p className="text-sm text-muted-foreground">The whole book as one system — risk, balance, and what to do next.</p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />Refresh
          </Button>
        </div>

        {loading && !data && <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
        {error && <Card className="p-6 text-sm text-muted-foreground">{error}</Card>}

        {data && m && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard label="Account value" value={money(data.nav)} subtext={`${ret >= 0 ? "+" : ""}${ret.toFixed(2)}% all-time`} icon={Wallet} />
              <MetricCard label="Invested / cash" value={`${(100 - m.cashPct).toFixed(0)}% / ${m.cashPct.toFixed(0)}%`} subtext={`${data.n} of ~${m.targetPositions} holdings`} icon={Percent} />
              <MetricCard label="Money at risk" value={`${m.heatPct.toFixed(1)}%`} subtext={`Bad week (95%): −${m.varWeek95.toFixed(1)}%`} icon={ShieldAlert} />
              <MetricCard label="Independent bets" value={m.effBets.toFixed(1)} subtext={`Beta ${m.beta.toFixed(2)} · avg overlap ${m.avgCorr.toFixed(2)}`} icon={Layers} />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card className="p-5 space-y-3">
                <h2 className="text-sm font-medium">Sector balance</h2>
                {data.sectors.length === 0 && <p className="text-sm text-muted-foreground">No holdings yet.</p>}
                {data.sectors.map((s) => (
                  <div key={s.sector} className="space-y-1">
                    <div className="flex justify-between text-xs"><span>{s.sector}</span><span className={cn(s.pct > m.sectorCap && "text-destructive")}>{s.pct.toFixed(1)}%</span></div>
                    <div className="relative h-2 rounded-full bg-muted">
                      <div className={cn("h-2 rounded-full", s.pct > m.sectorCap ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(100, s.pct / 50 * 100)}%` }} />
                      <div className="absolute top-[-2px] h-3 w-px bg-foreground/60" style={{ left: `${m.sectorCap / 50 * 100}%` }} />
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">Line marks the {m.sectorCap}% sector limit.</p>
              </Card>

              <Card className="p-5 space-y-3 border-primary/40">
                <h2 className="text-sm font-medium flex items-center gap-2"><Lightbulb className="h-4 w-4 text-primary" />Recommended actions</h2>
                {data.recommendations.length === 0 && <p className="text-sm text-muted-foreground">Nothing needs attention. The book is balanced.</p>}
                <ol className="space-y-3">
                  {data.recommendations.map((r, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="text-xs text-muted-foreground w-4 pt-0.5">{i + 1}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{r.title}</span>
                          <Badge variant="outline" className="text-[10px]">{KIND_LABEL[r.kind] ?? r.kind}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{r.reason}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="text-[11px] text-muted-foreground">Suggestions only — the AutoTrader still makes the trades.</p>
              </Card>
            </div>

            <Card className="p-5 space-y-3">
              <h2 className="text-sm font-medium flex items-center gap-2"><Activity className="h-4 w-4" />Holdings</h2>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground"><tr className="text-left">
                    <th className="py-2">Ticker</th><th>Sector</th><th className="text-right">Value</th><th className="text-right">Weight</th>
                    <th className="text-right">P&amp;L</th><th className="text-right">To stop</th><th className="text-right">Beta</th><th className="text-right">Risk share</th>
                  </tr></thead>
                  <tbody>
                    {data.holdings.sort((a, b) => b.weightPct - a.weightPct).map((h) => (
                      <tr key={h.id} className="border-t border-border/50">
                        <td className="py-2"><TickerLink ticker={h.ticker} /></td>
                        <td className="text-muted-foreground">{h.sector}</td>
                        <td className="text-right">{money(h.value)}</td>
                        <td className={cn("text-right", h.weightPct > m.singleCapPct && "text-destructive")}>{h.weightPct.toFixed(1)}%</td>
                        <td className={cn("text-right", h.pnl >= 0 ? "text-primary" : "text-destructive")}>{money(h.pnl)} ({h.pnlPct.toFixed(1)}%)</td>
                        <td className={cn("text-right", h.stopDistPct != null && h.stopDistPct < 1.5 && "text-destructive")}>{h.stopDistPct == null ? "—" : `${h.stopDistPct.toFixed(1)}%`}</td>
                        <td className="text-right">{h.beta.toFixed(2)}</td>
                        <td className="text-right">{h.riskSharePct.toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden grid gap-2">
                {data.holdings.map((h) => (
                  <div key={h.id} className="rounded-md border border-border p-3 text-sm space-y-1">
                    <div className="flex justify-between"><TickerLink ticker={h.ticker} /><span>{h.weightPct.toFixed(1)}%</span></div>
                    <div className="flex justify-between text-xs text-muted-foreground"><span>{h.sector}</span><span className={h.pnl >= 0 ? "text-primary" : "text-destructive"}>{money(h.pnl)}</span></div>
                    <div className="flex justify-between text-xs text-muted-foreground"><span>To stop {h.stopDistPct == null ? "—" : `${h.stopDistPct.toFixed(1)}%`}</span><span>Risk {h.riskSharePct.toFixed(0)}%</span></div>
                  </div>
                ))}
              </div>
            </Card>

            {data.correlation.tickers.length > 1 && (
              <Card className="p-5 space-y-3">
                <h2 className="text-sm font-medium">Overlap map</h2>
                <p className="text-xs text-muted-foreground">Darker = the two holdings tend to move together (last 60 days).</p>
                <div className="overflow-x-auto">
                  <table className="text-[10px]">
                    <thead><tr><th />{data.correlation.tickers.map((t) => <th key={t} className="px-1 font-normal text-muted-foreground">{t}</th>)}</tr></thead>
                    <tbody>
                      {data.correlation.tickers.map((t, i) => (
                        <tr key={t}>
                          <td className="pr-2 text-muted-foreground">{t}</td>
                          {data.correlation.matrix[i].map((c, j) => (
                            <td key={j} className="w-9 h-7 text-center rounded-sm"
                              style={{ backgroundColor: c == null || i === j ? "hsl(var(--muted))" : `hsl(var(--primary) / ${Math.max(0.05, Math.min(1, c)).toFixed(2)})` }}>
                              {i === j || c == null ? "" : c.toFixed(1)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
            <p className="text-[11px] text-muted-foreground">Prices from the latest saved daily close · {new Date(data.asOf).toLocaleString()}</p>
          </>
        )}
      </main>
    </div>
  );
}
