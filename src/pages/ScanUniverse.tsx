import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/MetricCard";
import { supabase } from "@/integrations/supabase/client";
import { Layers, Database, Filter, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

interface ScanRun {
  id: string;
  created_at: string;
  total_tickers: number;
  index_count: number;
  screener_count: number;
  overlap_count: number;
  fallback_used: boolean;
  source_breakdown: Record<string, number>;
  sample_tickers: { index: string[]; screeners: Record<string, string[]> };
}

const SCREENER_LABEL: Record<string, string> = {
  most_actives: "Most Actives",
  day_gainers: "Day Gainers",
  day_losers: "Day Losers",
  undervalued_growth_stocks: "Undervalued Growth",
  undervalued_large_caps: "Undervalued Large Caps",
  growth_technology_stocks: "Growth Tech",
  aggressive_small_caps: "Aggressive Small Caps",
  small_cap_gainers: "Small Cap Gainers",
  high_yield_bond: "High Yield Bond",
  portfolio_anchors: "Portfolio Anchors",
  solid_large_growth_funds: "Large Growth",
  top_mutual_funds: "Top Mutual Funds",
};

export default function ScanUniverse() {
  const [runs, setRuns] = useState<ScanRun[]>([]);
  const [selected, setSelected] = useState<ScanRun | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("scan_universe_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (!error && data) {
      const rows = data as unknown as ScanRun[];
      setRuns(rows);
      setSelected(rows[0] ?? null);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const breakdownData = selected
    ? Object.entries(selected.source_breakdown)
        .map(([k, v]) => ({ name: SCREENER_LABEL[k] ?? k, key: k, count: Number(v) || 0 }))
        .sort((a, b) => b.count - a.count)
    : [];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-20 pb-16 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 flex items-center justify-between gap-4 flex-wrap"
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Layers className="w-5 h-5 text-primary" />
                <h1 className="text-2xl font-light tracking-tight">Scan Universe</h1>
                <Badge variant="outline" className="ml-2 text-xs">Per-run attribution</Badge>
              </div>
              <p className="text-sm text-muted-foreground max-w-2xl">
                What drove each market scan: how many tickers came from index constituents
                (S&P 500, Nasdaq) vs each Yahoo screener.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </Button>
          </motion.div>

          {loading && !selected && (
            <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading scan history…
            </div>
          )}

          {!loading && runs.length === 0 && (
            <Card className="p-10 text-center bg-card/50 border-border/40">
              <AlertCircle className="w-8 h-8 mx-auto mb-4 text-muted-foreground/60" />
              <h2 className="text-lg font-light mb-2">No scan runs logged yet</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                The market scanner will log a breakdown on its next run (every cycle, batch 0).
              </p>
            </Card>
          )}

          {selected && (
            <>
              {/* Run selector */}
              <Card className="p-4 mb-6 bg-card/50 border-border/40">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Recent runs
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {runs.map((r) => {
                    const isSel = r.id === selected.id;
                    return (
                      <Button
                        key={r.id}
                        size="sm"
                        variant={isSel ? "secondary" : "ghost"}
                        onClick={() => setSelected(r)}
                        className="shrink-0 text-xs"
                      >
                        {new Date(r.created_at).toLocaleString([], {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                        <span className="ml-2 text-muted-foreground">{r.total_tickers}</span>
                      </Button>
                    );
                  })}
                </div>
              </Card>

              {/* Top metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <MetricCard label="Total universe" value={selected.total_tickers.toString()} icon={Layers} />
                <MetricCard label="From index" value={selected.index_count.toString()} icon={Database} color="text-primary" />
                <MetricCard label="From screeners" value={selected.screener_count.toString()} icon={Filter} />
                <MetricCard label="Overlap" value={selected.overlap_count.toString()} icon={Layers} />
              </div>

              {selected.fallback_used && (
                <Card className="p-3 mb-6 border-destructive/40 bg-destructive/5">
                  <p className="text-xs text-destructive flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Fallback list was used — dynamic discovery returned fewer than 50 tickers.
                  </p>
                </Card>
              )}

              {/* Per-screener breakdown */}
              <Card className="p-6 mb-6 bg-card/50 border-border/40">
                <div className="mb-4">
                  <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
                    Tickers per screener (post-filter)
                  </h2>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Counts after equity-only, market cap ≥ $1B, avg volume ≥ 500k filters.
                  </p>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={breakdownData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        width={140}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {breakdownData.map((_, i) => (
                          <Cell key={i} fill="hsl(var(--primary))" />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Sample tickers */}
              <div className="grid md:grid-cols-2 gap-4">
                <Card className="p-6 bg-card/50 border-border/40">
                  <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground mb-3">
                    Index sample
                  </h2>
                  <div className="flex flex-wrap gap-1.5">
                    {(selected.sample_tickers?.index ?? []).map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px] font-mono">{t}</Badge>
                    ))}
                    {(!selected.sample_tickers?.index || selected.sample_tickers.index.length === 0) && (
                      <p className="text-xs text-muted-foreground">No samples</p>
                    )}
                  </div>
                </Card>
                <Card className="p-6 bg-card/50 border-border/40">
                  <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground mb-3">
                    Screener samples
                  </h2>
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {Object.entries(selected.sample_tickers?.screeners ?? {}).map(([k, list]) => (
                      <div key={k} className="text-xs">
                        <div className="text-muted-foreground mb-1">{SCREENER_LABEL[k] ?? k}</div>
                        <div className="flex flex-wrap gap-1">
                          {list.map((t) => (
                            <Badge key={`${k}-${t}`} variant="outline" className="text-[10px] font-mono">
                              {t}
                            </Badge>
                          ))}
                          {list.length === 0 && (
                            <span className="text-muted-foreground/60">none passed filter</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
