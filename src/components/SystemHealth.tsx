import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, CheckCircle2, AlertTriangle, XCircle, Loader2, RefreshCw, Clock } from "lucide-react";
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

const STATUS_META: Record<JobHealth["status"], { label: string; icon: typeof CheckCircle2; tone: string; bg: string }> = {
  healthy: { label: "Healthy", icon: CheckCircle2, tone: "text-success", bg: "bg-success/10" },
  stale:   { label: "Stale",   icon: AlertTriangle, tone: "text-warning", bg: "bg-warning/10" },
  error:   { label: "Error",   icon: XCircle, tone: "text-destructive", bg: "bg-destructive/10" },
  unknown: { label: "No data", icon: AlertTriangle, tone: "text-muted-foreground", bg: "bg-muted" },
};

const OVERALL_META = {
  healthy:  { label: "All systems normal", tone: "text-success", badge: "default" as const, dot: "bg-success" },
  warn:     { label: "Some jobs delayed",  tone: "text-warning", badge: "secondary" as const, dot: "bg-warning" },
  degraded: { label: "Background errors",  tone: "text-destructive", badge: "destructive" as const, dot: "bg-destructive" },
};

function formatAge(min: number | null): string {
  if (min == null) return "—";
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatCheckedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const SystemHealth = () => {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    load();
    // Auto-refresh every 30 seconds while this component is mounted
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const overall = data ? OVERALL_META[data.overall] : null;

  return (
    <Card className="glass-card p-4 sm:p-5 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium">System Health</h3>
            <p className="text-xs text-muted-foreground truncate">
              Background job heartbeats. Updated on demand.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <AnimatePresence>
            {data && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums"
              >
                <Clock className="w-3 h-3" />
                {formatCheckedAt(data.checkedAt)}
              </motion.span>
            )}
          </AnimatePresence>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading} aria-label="Refresh" className="h-8 w-8 p-0">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </header>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : loading && !data ? (
        <div className="py-6 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : data ? (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className={cn("h-2.5 w-2.5 rounded-full shrink-0",
                overall?.dot,
              )} />
              <span className={cn("text-sm font-medium", overall?.tone)}>{overall?.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="sm:hidden inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
                <Clock className="w-3 h-3" />
                {formatCheckedAt(data.checkedAt)}
              </span>
              <Badge variant={data.marketOpen ? "default" : "secondary"} className="text-[10px]">
                {data.marketOpen ? "Market open" : "After hours"}
              </Badge>
            </div>
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
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-0 rounded-md px-3 py-2.5 hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn("flex items-center justify-center w-6 h-6 rounded-md shrink-0", meta.bg)}>
                      <Icon className={cn("w-3.5 h-3.5", meta.tone)} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-xs font-mono text-foreground truncate block">{job.name}</span>
                      {job.message && (
                        <span className="text-[10px] text-muted-foreground truncate block">{job.message}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums pl-8 sm:pl-0">
                    {job.durationMs != null && (
                      <span className="hidden sm:inline">{(job.durationMs / 1000).toFixed(1)}s</span>
                    )}
                    <span className={cn(meta.tone, "font-medium")}>{formatAge(job.ageMinutes)}</span>
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

