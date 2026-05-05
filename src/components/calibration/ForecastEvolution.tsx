import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/MetricCard";
import { supabase } from "@/integrations/supabase/client";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { TrendingUp, Target, Activity, Loader2, RefreshCw, Calendar } from "lucide-react";
import { toast } from "sonner";

interface Snapshot {
  snapshot_date: string;
  closed_count: number;
  open_count: number;
  win_rate: number;
  avg_return_pct: number;
  sharpe: number;
  trades_per_week: number;
  projected_daily_pct: number;
  projected_weekly_pct: number;
  projected_monthly_pct: number;
  projected_quarterly_pct: number;
  projected_yearly_pct: number;
}

const HORIZONS = [
  { key: "projected_daily_pct", label: "Daily" },
  { key: "projected_weekly_pct", label: "Weekly" },
  { key: "projected_monthly_pct", label: "Monthly" },
  { key: "projected_quarterly_pct", label: "Quarterly" },
  { key: "projected_yearly_pct", label: "Yearly" },
] as const;

export function ForecastEvolution() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("calibration_snapshots")
      .select("*")
      .order("snapshot_date", { ascending: true })
      .limit(180);
    if (!error) setSnapshots((data ?? []) as any);
    setLoading(false);
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { error } = await supabase.functions.invoke("roll-calibration", { body: {} });
      if (error) throw error;
      toast.success("Snapshot updated");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to refresh snapshot");
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => { load(); }, []);

  const latest = snapshots[snapshots.length - 1];
  const earliest = snapshots[0];
  const chartData = snapshots.map(s => ({
    date: s.snapshot_date.slice(5), // MM-DD
    "Win rate %": Number(s.win_rate.toFixed(2)),
    "Sharpe": Number(s.sharpe.toFixed(2)),
    "Closed": s.closed_count,
    "Daily": Number(s.projected_daily_pct.toFixed(3)),
    "Weekly": Number(s.projected_weekly_pct.toFixed(3)),
    "Monthly": Number(s.projected_monthly_pct.toFixed(2)),
    "Quarterly": Number(s.projected_quarterly_pct.toFixed(2)),
    "Yearly": Number(s.projected_yearly_pct.toFixed(2)),
  }));

  const trendBadge = (latest && earliest && latest !== earliest)
    ? (latest.win_rate - earliest.win_rate)
    : null;

  return (
    <Card className="p-5 mb-6 bg-card/50 border-border/40">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
              Forecast evolution
            </h2>
            <Badge variant="outline" className="text-[10px]">Daily snapshots</Badge>
          </div>
          <p className="text-xs text-muted-foreground/70 mt-1">
            How accuracy, Sharpe and projected returns shift as more closed trades arrive.
            One snapshot per day. Forecasts are linear extrapolations of avg trade return × trade frequency.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={runNow} disabled={running}>
          {running ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
          Run rolling update
        </Button>
      </div>

      {loading && snapshots.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading snapshots…
        </div>
      ) : snapshots.length === 0 ? (
        <div className="py-10 text-center">
          <Calendar className="w-6 h-6 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No snapshots yet. Click "Run rolling update" to take the first one.</p>
        </div>
      ) : latest ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <MetricCard
              label="Latest win rate"
              value={`${latest.win_rate.toFixed(1)}%`}
              icon={Target}
              color={latest.win_rate >= 55 ? "text-primary" : latest.win_rate >= 45 ? "text-foreground" : "text-destructive"}
              subtext={trendBadge != null ? `${trendBadge >= 0 ? "+" : ""}${trendBadge.toFixed(1)}pp vs first snapshot` : undefined}
            />
            <MetricCard
              label="Sharpe (annualized)"
              value={latest.sharpe.toFixed(2)}
              icon={Activity}
              color={latest.sharpe >= 1 ? "text-primary" : latest.sharpe >= 0 ? "text-foreground" : "text-destructive"}
              subtext={`${latest.closed_count} closed · ${latest.trades_per_week.toFixed(1)}/wk`}
            />
            <MetricCard
              label="Projected monthly"
              value={`${latest.projected_monthly_pct >= 0 ? "+" : ""}${latest.projected_monthly_pct.toFixed(2)}%`}
              icon={TrendingUp}
              color={latest.projected_monthly_pct >= 0 ? "text-primary" : "text-destructive"}
            />
            <MetricCard
              label="Projected yearly"
              value={`${latest.projected_yearly_pct >= 0 ? "+" : ""}${latest.projected_yearly_pct.toFixed(1)}%`}
              icon={TrendingUp}
              color={latest.projected_yearly_pct >= 0 ? "text-primary" : "text-destructive"}
            />
          </div>

          {/* Win rate + Sharpe over time */}
          <div className="h-64 mb-6">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <ReferenceLine y={50} yAxisId="left" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" opacity={0.4} />
                <Line yAxisId="left" type="monotone" dataKey="Win rate %" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="Sharpe" stroke="hsl(var(--accent-foreground))" strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="Closed" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} dot={false} strokeDasharray="3 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Projected returns over time */}
          <div className="h-64">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Projected returns by horizon
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} unit="%" />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(v: any) => `${Number(v).toFixed(2)}%`}
                />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" opacity={0.4} />
                <Line type="monotone" dataKey="Daily" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Weekly" stroke="hsl(var(--accent-foreground))" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Monthly" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Quarterly" stroke="hsl(var(--chart-2, var(--primary)))" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                <Line type="monotone" dataKey="Yearly" stroke="hsl(var(--destructive))" strokeWidth={1.5} dot={false} strokeDasharray="6 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <p className="text-[10px] text-muted-foreground/60 mt-3">
            Snapshots auto-refresh daily at 02:00 UTC. Forecasts become more reliable as the closed-trade sample grows past ~500.
          </p>
        </>
      ) : null}
    </Card>
  );
}
