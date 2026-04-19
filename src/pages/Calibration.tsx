import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/MetricCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fetchWithErrorHandling, showErrorToast } from "@/lib/api-error";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, LineChart, Line, Legend,
} from "recharts";
import { Brain, Target, Activity, TrendingUp, Loader2, RefreshCw, AlertCircle } from "lucide-react";

interface CalibrationData {
  windowDays: number;
  summary: {
    totalClosed: number;
    totalOpen: number;
    winRate: number;
    avgReturnPct: number;
    avgMFE: number;
    avgMAE: number;
  };
  convictionBuckets: {
    bucket: string;
    count: number;
    winRate: number;
    avgReturnPct: number;
    expectedWinRate: number;
  }[];
  byStrategy: { strategy: string; count: number; winRate: number; avgReturnPct: number }[];
  byRegime: { regime: string; count: number; winRate: number; avgReturnPct: number }[];
  exitMix: { reason: string; count: number }[];
  recentOpen: any[];
}

export default function Calibration() {
  const [data, setData] = useState<CalibrationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(90);

  const load = async (days: number) => {
    setLoading(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const url = `https://${projectId}.supabase.co/functions/v1/calibration-stats?days=${days}`;
      const res = await fetchWithErrorHandling(url);
      const json = await res.json();
      setData(json);
    } catch (e) {
      showErrorToast(e, "Failed to load calibration data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(windowDays); }, [windowDays]);

  const hasData = !!data && data.summary.totalClosed > 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-20 pb-16 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Brain className="w-5 h-5 text-primary" />
                  <h1 className="text-2xl font-light tracking-tight">Calibration</h1>
                  <Badge variant="outline" className="ml-2 text-xs">Phase A</Badge>
                </div>
                <p className="text-sm text-muted-foreground max-w-2xl">
                  The real conviction → win-rate curve from live signals. If the algorithm says "80",
                  does it actually win 80% of the time? This is the substrate the adaptive layer will read.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {[30, 90, 180, 365].map(d => (
                  <Button
                    key={d}
                    size="sm"
                    variant={windowDays === d ? "secondary" : "ghost"}
                    onClick={() => setWindowDays(d)}
                  >
                    {d}d
                  </Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => load(windowDays)} disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </motion.div>

          {loading && !data && (
            <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading outcomes…
            </div>
          )}

          {!loading && !hasData && (
            <Card className="p-10 text-center bg-card/50 border-border/40">
              <AlertCircle className="w-8 h-8 mx-auto mb-4 text-muted-foreground/60" />
              <h2 className="text-lg font-light mb-2">No closed outcomes yet</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Outcomes are created when the market scanner emits a signal, and closed when a sell alert
                fires (stop loss, take profit, weekly reversal). Once a few signals have run their full
                cycle, you'll see the calibration curve here.
              </p>
              {data && (
                <p className="text-xs text-muted-foreground/70 mt-4">
                  Open outcomes being tracked: <span className="text-primary">{data.summary.totalOpen}</span>
                </p>
              )}
            </Card>
          )}

          {hasData && data && (
            <>
              {/* Top metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <MetricCard
                  label="Closed signals"
                  value={data.summary.totalClosed.toString()}
                  icon={Activity}
                />
                <MetricCard
                  label="Realized win rate"
                  value={`${data.summary.winRate.toFixed(1)}%`}
                  icon={Target}
                  trend={data.summary.winRate >= 55 ? "up" : data.summary.winRate >= 45 ? "neutral" : "down"}
                />
                <MetricCard
                  label="Avg return"
                  value={`${data.summary.avgReturnPct >= 0 ? "+" : ""}${data.summary.avgReturnPct.toFixed(2)}%`}
                  icon={TrendingUp}
                  trend={data.summary.avgReturnPct > 0 ? "up" : "down"}
                />
                <MetricCard
                  label="Open positions"
                  value={data.summary.totalOpen.toString()}
                  icon={Brain}
                />
              </div>

              {/* Calibration curve */}
              <Card className="p-6 mb-6 bg-card/50 border-border/40">
                <div className="mb-4">
                  <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
                    Conviction → realized win rate
                  </h2>
                  <p className="text-xs text-muted-foreground/70 mt-1">
                    Dashed line = perfect calibration (conviction 80 wins 80% of the time). Bars above the line mean the algorithm is under-confident; below means over-confident.
                  </p>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.convictionBuckets}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                      <XAxis dataKey="bucket" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} domain={[0, 100]} unit="%" />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(val: any, name: string) => {
                          if (name === "winRate") return [`${Number(val).toFixed(1)}%`, "Realized"];
                          if (name === "expectedWinRate") return [`${Number(val).toFixed(0)}%`, "Expected"];
                          return val;
                        }}
                      />
                      <Bar dataKey="winRate" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]}>
                        {data.convictionBuckets.map((b, i) => (
                          <Cell
                            key={i}
                            fill={
                              b.winRate >= b.expectedWinRate
                                ? "hsl(var(--primary))"
                                : "hsl(var(--destructive) / 0.7)"
                            }
                          />
                        ))}
                      </Bar>
                      <Line
                        type="monotone"
                        dataKey="expectedWinRate"
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="4 4"
                        dot={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4 text-xs">
                  {data.convictionBuckets.map(b => (
                    <div key={b.bucket} className="p-3 rounded-md bg-background/50 border border-border/30">
                      <div className="text-muted-foreground">{b.bucket}</div>
                      <div className="text-foreground font-medium mt-1">
                        {b.winRate.toFixed(1)}% win
                      </div>
                      <div className="text-muted-foreground/70">
                        {b.count} signals · {b.avgReturnPct >= 0 ? "+" : ""}{b.avgReturnPct.toFixed(2)}% avg
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Strategy + regime breakdown */}
              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <Card className="p-6 bg-card/50 border-border/40">
                  <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground mb-4">
                    By strategy
                  </h2>
                  {data.byStrategy.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No data</p>
                  ) : (
                    <div className="space-y-2">
                      {data.byStrategy.map(s => (
                        <div key={s.strategy} className="flex items-center justify-between p-3 rounded-md bg-background/50 border border-border/30">
                          <div>
                            <div className="text-sm font-medium capitalize">{s.strategy.replace(/_/g, " ")}</div>
                            <div className="text-xs text-muted-foreground">{s.count} closed</div>
                          </div>
                          <div className="text-right">
                            <div className={`text-sm font-medium ${s.winRate >= 55 ? "text-primary" : s.winRate >= 45 ? "text-foreground" : "text-destructive"}`}>
                              {s.winRate.toFixed(1)}%
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {s.avgReturnPct >= 0 ? "+" : ""}{s.avgReturnPct.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card className="p-6 bg-card/50 border-border/40">
                  <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground mb-4">
                    By regime
                  </h2>
                  {data.byRegime.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No data</p>
                  ) : (
                    <div className="space-y-2">
                      {data.byRegime.map(r => (
                        <div key={r.regime} className="flex items-center justify-between p-3 rounded-md bg-background/50 border border-border/30">
                          <div>
                            <div className="text-sm font-medium capitalize">{r.regime.replace(/_/g, " ")}</div>
                            <div className="text-xs text-muted-foreground">{r.count} closed</div>
                          </div>
                          <div className="text-right">
                            <div className={`text-sm font-medium ${r.winRate >= 55 ? "text-primary" : r.winRate >= 45 ? "text-foreground" : "text-destructive"}`}>
                              {r.winRate.toFixed(1)}%
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {r.avgReturnPct >= 0 ? "+" : ""}{r.avgReturnPct.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              {/* Exit mix + MFE/MAE */}
              <div className="grid md:grid-cols-2 gap-4">
                <Card className="p-6 bg-card/50 border-border/40">
                  <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground mb-4">
                    Exit reasons
                  </h2>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.exitMix} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                        <YAxis type="category" dataKey="reason" stroke="hsl(var(--muted-foreground))" fontSize={11} width={110} />
                        <Tooltip
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                        />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card className="p-6 bg-card/50 border-border/40">
                  <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground mb-4">
                    Excursion analysis
                  </h2>
                  <div className="space-y-4">
                    <div className="p-4 rounded-md bg-background/50 border border-border/30">
                      <div className="text-xs text-muted-foreground mb-1">Avg max favorable excursion</div>
                      <div className="text-2xl font-light text-primary">
                        +{data.summary.avgMFE.toFixed(2)}%
                      </div>
                      <div className="text-xs text-muted-foreground/70 mt-1">
                        Best unrealized gain before exit. Gap vs avg return = profit left on the table.
                      </div>
                    </div>
                    <div className="p-4 rounded-md bg-background/50 border border-border/30">
                      <div className="text-xs text-muted-foreground mb-1">Avg max adverse excursion</div>
                      <div className="text-2xl font-light text-destructive">
                        {data.summary.avgMAE.toFixed(2)}%
                      </div>
                      <div className="text-xs text-muted-foreground/70 mt-1">
                        Worst drawdown during life. Tells you where stops are getting hit.
                      </div>
                    </div>
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
