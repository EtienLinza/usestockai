import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, ShieldCheck, FileClock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Entry {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  user_agent: string | null;
  created_at: string;
}

const ACTION_LABEL: Record<string, { label: string; tone: string }> = {
  login: { label: "Sign-in", tone: "text-sky-500 border-sky-500/30" },
  password_change: { label: "Password changed", tone: "text-amber-500 border-amber-500/30" },
  mfa_enabled: { label: "2FA enabled", tone: "text-emerald-500 border-emerald-500/30" },
  mfa_disabled: { label: "2FA disabled", tone: "text-rose-500 border-rose-500/30" },
  position_opened: { label: "Position opened", tone: "text-emerald-500 border-emerald-500/30" },
  position_closed_manual: { label: "Position closed", tone: "text-amber-500 border-amber-500/30" },
  autotrader_toggled: { label: "Autotrader toggled", tone: "text-primary border-primary/30" },
  settings_changed: { label: "Settings changed", tone: "text-muted-foreground border-border" },
  alert_created: { label: "Alert created", tone: "text-sky-500 border-sky-500/30" },
  alert_deleted: { label: "Alert removed", tone: "text-muted-foreground border-border" },
  api_key_rotated: { label: "API key rotated", tone: "text-amber-500 border-amber-500/30" },
  account_deleted: { label: "Account deleted", tone: "text-rose-500 border-rose-500/30" },
};

const SecurityActivity = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (!error) setEntries((data as Entry[]) ?? []);
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Security Activity — StockAI"
        description="Review recent sign-ins, MFA changes, trade actions, and other security-relevant events on your account."
        path="/settings/activity"
        noindex
      />
      <Navbar />
      <main className="container mx-auto px-4 sm:px-6 pt-20 md:pt-24 pb-24 md:pb-12 max-w-4xl">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
          <div className="space-y-2">
            <Button variant="ghost" size="sm" asChild className="-ml-2">
              <Link to="/settings"><ArrowLeft className="w-4 h-4 mr-1" /> Back to Settings</Link>
            </Button>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-medium tracking-tight">Security activity</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              The last 100 sensitive actions on your account. These records are immutable.
            </p>
          </div>

          {loading ? (
            <Card className="glass-card p-12 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </Card>
          ) : entries.length === 0 ? (
            <Card className="glass-card p-10 text-center space-y-2">
              <FileClock className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                No activity recorded yet. Sign-ins and account changes will appear here.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {entries.map((e) => {
                const meta = ACTION_LABEL[e.action] ?? { label: e.action, tone: "text-muted-foreground border-border" };
                return (
                  <Card key={e.id} className="glass-card p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={meta.tone}>{meta.label}</Badge>
                          {e.target_type && (
                            <span className="text-xs text-muted-foreground">
                              {e.target_type}{e.target_id ? `: ${e.target_id}` : ""}
                            </span>
                          )}
                        </div>
                        {e.metadata && Object.keys(e.metadata).length > 0 && (
                          <pre className="text-[11px] text-muted-foreground bg-muted/30 rounded p-2 overflow-x-auto">
{JSON.stringify(e.metadata, null, 2)}
                          </pre>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0 sm:text-right">
                        {new Date(e.created_at).toLocaleString()}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
};

export default SecurityActivity;
