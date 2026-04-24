import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Loader2, ArrowDownRight, ArrowUpRight, Pause, Ban } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface LogRow {
  id: string;
  ticker: string;
  action: "ENTRY" | "PARTIAL_EXIT" | "FULL_EXIT" | "HOLD" | "BLOCKED" | "ERROR";
  reason: string | null;
  price: number | null;
  shares: number | null;
  pnl_pct: number | null;
  conviction: number | null;
  strategy: string | null;
  profile: string | null;
  created_at: string;
}

const actionMeta: Record<LogRow["action"], { label: string; cls: string; Icon: typeof ArrowUpRight }> = {
  ENTRY: { label: "Entry", cls: "text-success border-success/30 bg-success/10", Icon: ArrowUpRight },
  FULL_EXIT: { label: "Exit", cls: "text-destructive border-destructive/30 bg-destructive/10", Icon: ArrowDownRight },
  PARTIAL_EXIT: { label: "Partial", cls: "text-primary border-primary/30 bg-primary/10", Icon: ArrowDownRight },
  HOLD: { label: "Hold", cls: "text-muted-foreground border-muted-foreground/30 bg-muted/40", Icon: Pause },
  BLOCKED: { label: "Blocked", cls: "text-amber-500 border-amber-500/30 bg-amber-500/10", Icon: Ban },
  ERROR: { label: "Error", cls: "text-destructive border-destructive/30 bg-destructive/10", Icon: Ban },
};

const AutotraderLog = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("autotrade_log")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      setRows((data ?? []) as LogRow[]);
      setLoading(false);
    })();
  }, [user]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container mx-auto px-6 pt-24 pb-12 max-w-5xl">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <div className="flex items-center gap-2 mb-1">
            <Bot className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-medium tracking-tight">AutoTrader Activity</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Every decision your automated trader makes — entries, exits, holds, and blocks.
            Auto-runs every 10 minutes during U.S. market hours.
          </p>

          {loading ? (
            <Card className="glass-card p-12 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </Card>
          ) : rows.length === 0 ? (
            <Card className="glass-card p-12 text-center text-sm text-muted-foreground">
              No automated activity yet. Enable AutoTrader from <span className="text-foreground">Settings</span> to get started.
            </Card>
          ) : (
            <Card className="glass-card overflow-hidden">
              <div className="divide-y divide-border/50">
                {rows.map((r) => {
                  const m = actionMeta[r.action];
                  const t = new Date(r.created_at);
                  return (
                    <div key={r.id} className="px-5 py-4 flex items-start gap-4 hover:bg-muted/20 transition-colors">
                      <div className={cn("rounded-md border w-9 h-9 flex items-center justify-center flex-shrink-0", m.cls)}>
                        <m.Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-medium">{r.ticker}</span>
                          <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wide", m.cls)}>
                            {m.label}
                          </Badge>
                          {r.strategy && (
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {r.strategy.replace("_", " ")}
                            </Badge>
                          )}
                          {r.conviction != null && (
                            <span className="text-[10px] font-mono text-muted-foreground">conv {r.conviction}</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 leading-snug">{r.reason ?? "—"}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        {r.price != null && (
                          <div className="font-mono text-sm">${Number(r.price).toFixed(2)}</div>
                        )}
                        {r.pnl_pct != null && (
                          <div className={cn("font-mono text-xs", Number(r.pnl_pct) >= 0 ? "text-success" : "text-destructive")}>
                            {Number(r.pnl_pct) >= 0 ? "+" : ""}{Number(r.pnl_pct).toFixed(2)}%
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {t.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </motion.div>
      </main>
    </div>
  );
};

export default AutotraderLog;
