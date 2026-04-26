import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, CheckCircle2, AlertTriangle, XCircle, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface JobHealth {
  name: string;
  status: "healthy" | "stale" | "error" | "unknown";
  lastRunAt: string | null;
  ageMinutes: number | null;
  durationMs: number | null;
  message: string | null;
}

interface HealthResponse {
  overall: "healthy" | "warn" | "degraded";
  marketOpen: boolean;
  checkedAt: string;
  jobs: JobHealth[];
}

const STATUS_META: Record<JobHealth["status"], { label: string; icon: typeof CheckCircle2; tone: string }> = {
  healthy: { label: "Healthy", icon: CheckCircle2, tone: "text-success" },
  stale:   { label: "Stale",   icon: AlertTriangle, tone: "text-warning" },
  error:   { label: "Error",   icon: XCircle, tone: "text-destructive" },
  unknown: { label: "No data", icon: AlertTriangle, tone: "text-muted-foreground" },
};

const OVERALL_META = {
  healthy:  { label: "All systems normal", tone: "text-success", badge: "default" as const },
  warn:     { label: "Some jobs delayed",  tone: "text-warning", badge: "secondary" as const },
  degraded: { label: "Background errors",  tone: "text-destructive", badge: "destructive" as const },
};

function formatAge(min: number | null): string {
  if (min == null) return "—";
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const SystemHealth = () => {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: res, error: invokeErr } = await supabase.functions.invoke("health-check", {
        body: {},
      });
      if (invokeErr) throw invokeErr;
      setData(res as HealthResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load health");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const overall = data ? OVERALL_META[data.overall] : null;

  return (
    <Card className="glass-card p-5 space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <div>
            <h3 className="text-sm font-medium">System Health</h3>
            <p className="text-xs text-muted-foreground">
              Background job heartbeats. Updated on demand.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} aria-label="Refresh">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
      </header>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : loading && !data ? (
        <div className="py-6 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : data ? (
        <>
          <div className="flex items-center justify-between rounded-md border border-border/50 bg-muted/20 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full",
                data.overall === "healthy" && "bg-success",
                data.overall === "warn" && "bg-warning",
                data.overall === "degraded" && "bg-destructive",
              )} />
              <span className={cn("text-sm font-medium", overall?.tone)}>{overall?.label}</span>
            </div>
            <Badge variant={data.marketOpen ? "default" : "secondary"} className="text-[10px]">
              {data.marketOpen ? "Market open" : "After hours"}
            </Badge>
          </div>

          <ul className="space-y-1.5">
            {data.jobs.map((job, i) => {
              const meta = STATUS_META[job.status];
              const Icon = meta.icon;
              return (
                <motion.li
                  key={job.name}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={cn("w-3.5 h-3.5 shrink-0", meta.tone)} />
                    <span className="text-xs font-mono text-foreground truncate">{job.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                    {job.durationMs != null && (
                      <span>{(job.durationMs / 1000).toFixed(1)}s</span>
                    )}
                    <span className={cn(meta.tone)}>{formatAge(job.ageMinutes)}</span>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        </>
      ) : null}
    </Card>
  );
};
