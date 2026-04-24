import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Shield, Loader2, Info, Bot, Sparkles, Clock, Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface PortfolioCaps {
  sector_max_pct: number;
  portfolio_beta_max: number;
  max_correlated_positions: number;
  enforcement_mode: "warn" | "block";
  enabled: boolean;
}

type RiskProfile = "conservative" | "balanced" | "aggressive";

interface AutoTradeSettings {
  enabled: boolean;
  paper_mode: boolean;
  advanced_mode: boolean;
  adaptive_mode: boolean;
  risk_profile: RiskProfile;
  scan_interval_minutes: number;
  min_conviction: number;
  max_positions: number;
  max_nav_exposure_pct: number;
  max_single_name_pct: number;
  daily_loss_limit_pct: number;
  starting_nav: number;
  use_news_sentiment: boolean;
}

interface AutotraderState {
  effective_min_conviction: number;
  effective_max_positions: number;
  effective_max_nav_exposure_pct: number;
  effective_max_single_name_pct: number;
  vix_value: number | null;
  vix_regime: string | null;
  spy_trend: string | null;
  recent_pnl_pct: number | null;
  adjustments: string[] | null;
  reason: string | null;
  computed_at: string;
}

const SCAN_INTERVAL_OPTIONS = [5, 10, 15, 30, 60] as const;

const CAPS_DEFAULTS: PortfolioCaps = {
  sector_max_pct: 35,
  portfolio_beta_max: 1.5,
  max_correlated_positions: 3,
  enforcement_mode: "warn",
  enabled: true,
};

const AUTOTRADE_DEFAULTS: AutoTradeSettings = {
  enabled: false,
  paper_mode: true,
  advanced_mode: false,
  adaptive_mode: true,
  risk_profile: "balanced",
  scan_interval_minutes: 10,
  min_conviction: 70,
  max_positions: 8,
  max_nav_exposure_pct: 80,
  max_single_name_pct: 20,
  daily_loss_limit_pct: 3,
  starting_nav: 100000,
  use_news_sentiment: true,
};

const RISK_PROFILE_LABEL: Record<RiskProfile, { label: string; hint: string }> = {
  conservative: { label: "Conservative", hint: "Higher conviction floor, fewer & smaller positions, lower exposure." },
  balanced:     { label: "Balanced",     hint: "Default. Calibrated for steady risk-adjusted returns." },
  aggressive:   { label: "Aggressive",   hint: "Lower floor, more positions, larger sizes. Higher variance." },
};

const Settings = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [caps, setCaps] = useState<PortfolioCaps>(CAPS_DEFAULTS);
  const [bot, setBot] = useState<AutoTradeSettings>(AUTOTRADE_DEFAULTS);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [nextScanAt, setNextScanAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [capsRes, botRes] = await Promise.all([
        supabase.from("portfolio_caps")
          .select("sector_max_pct, portfolio_beta_max, max_correlated_positions, enforcement_mode, enabled")
          .eq("user_id", user.id).maybeSingle(),
        supabase.from("autotrade_settings")
          .select("enabled, paper_mode, advanced_mode, scan_interval_minutes, min_conviction, max_positions, max_nav_exposure_pct, max_single_name_pct, daily_loss_limit_pct, starting_nav, last_scan_at, next_scan_at, use_news_sentiment")
          .eq("user_id", user.id).maybeSingle(),
      ]);
      if (capsRes.data) {
        setCaps({
          sector_max_pct: Number(capsRes.data.sector_max_pct),
          portfolio_beta_max: Number(capsRes.data.portfolio_beta_max),
          max_correlated_positions: Number(capsRes.data.max_correlated_positions),
          enforcement_mode: (capsRes.data.enforcement_mode as "warn" | "block") ?? "warn",
          enabled: Boolean(capsRes.data.enabled),
        });
      }
      if (botRes.data) {
        setBot({
          enabled: Boolean(botRes.data.enabled),
          paper_mode: Boolean(botRes.data.paper_mode),
          advanced_mode: Boolean(botRes.data.advanced_mode),
          scan_interval_minutes: Number(botRes.data.scan_interval_minutes ?? 10),
          min_conviction: Number(botRes.data.min_conviction),
          max_positions: Number(botRes.data.max_positions),
          max_nav_exposure_pct: Number(botRes.data.max_nav_exposure_pct),
          max_single_name_pct: Number(botRes.data.max_single_name_pct),
          daily_loss_limit_pct: Number(botRes.data.daily_loss_limit_pct),
          starting_nav: Number(botRes.data.starting_nav),
          use_news_sentiment: botRes.data.use_news_sentiment ?? true,
        });
        setLastScanAt(botRes.data.last_scan_at as string | null);
        setNextScanAt(botRes.data.next_scan_at as string | null);
      }
      setLoading(false);
    })();
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const [capsRes, botRes] = await Promise.all([
      supabase.from("portfolio_caps").upsert({ user_id: user.id, ...caps }, { onConflict: "user_id" }),
      supabase.from("autotrade_settings").upsert({ user_id: user.id, ...bot }, { onConflict: "user_id" }),
    ]);
    setSaving(false);
    if (capsRes.error || botRes.error) toast.error("Failed to save settings");
    else toast.success("Settings updated");
  };

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
      <main className="container mx-auto px-6 pt-24 pb-12 max-w-3xl">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
          {/* AutoTrader section */}
          <section className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Bot className="w-5 h-5 text-primary" />
                <h1 className="text-2xl font-medium tracking-tight">AutoTrader</h1>
              </div>
              <p className="text-sm text-muted-foreground">
                Hands-off scanner that opens, holds, and closes positions on its own.
                Win exits use 5-signal peak detection; loss exits use thesis invalidation.
              </p>
            </div>

            {loading ? (
              <Card className="glass-card p-12 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </Card>
            ) : (
              <>
                <Card className="glass-card p-5 space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Enable AutoTrader</Label>
                      <p className="text-xs text-muted-foreground">
                        When on, the system scans your watchlist and trades on your behalf.
                      </p>
                    </div>
                    <Switch checked={bot.enabled} onCheckedChange={(v) => setBot({ ...bot, enabled: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Paper mode</Label>
                      <p className="text-xs text-muted-foreground">
                        Simulate fills against your virtual portfolio. Live broker support coming later.
                      </p>
                    </div>
                    <Switch checked={bot.paper_mode} onCheckedChange={(v) => setBot({ ...bot, paper_mode: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm">Advanced mode</Label>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">manual control</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Reveal scan interval, conviction floor, exposure caps, and the daily kill-switch.
                      </p>
                    </div>
                    <Switch checked={bot.advanced_mode} onCheckedChange={(v) => setBot({ ...bot, advanced_mode: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Use news sentiment</Label>
                      <p className="text-xs text-muted-foreground">
                        AI reads recent headlines before every entry. Vetoes trades on extreme negative news; nudges conviction otherwise.
                      </p>
                    </div>
                    <Switch checked={bot.use_news_sentiment} onCheckedChange={(v) => setBot({ ...bot, use_news_sentiment: v })} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={bot.enabled ? "default" : "secondary"}>
                      {bot.enabled ? "Active" : "Paused"}
                    </Badge>
                    {bot.paper_mode && <Badge variant="outline">Paper</Badge>}
                    {!bot.advanced_mode && (
                      <Badge variant="outline" className="gap-1">
                        <Sparkles className="w-3 h-3" /> Autopilot
                      </Badge>
                    )}
                  </div>
                </Card>

                {!bot.advanced_mode ? (
                  <AutopilotStatusCard lastScanAt={lastScanAt} nextScanAt={nextScanAt} enabled={bot.enabled} />
                ) : (
                  <Card className="glass-card p-5 space-y-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5 text-primary" />
                            Scan interval
                          </Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            How often the bot re-evaluates entries and exits during market hours.
                          </p>
                        </div>
                        <Select
                          value={String(bot.scan_interval_minutes)}
                          onValueChange={(v) => setBot({ ...bot, scan_interval_minutes: Number(v) })}
                        >
                          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {SCAN_INTERVAL_OPTIONS.map((m) => (
                              <SelectItem key={m} value={String(m)}>
                                Every {m} min
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <CapSlider
                      label="Min conviction to enter"
                      hint="0–100. Only signals at or above this score open positions."
                      value={bot.min_conviction}
                      onChange={(v) => setBot({ ...bot, min_conviction: Math.round(v) })}
                      min={50} max={95} step={1}
                    />
                    <CapSlider
                      label="Max open positions"
                      hint="Maximum simultaneous trades."
                      value={bot.max_positions}
                      onChange={(v) => setBot({ ...bot, max_positions: Math.round(v) })}
                      min={1} max={20} step={1}
                    />
                    <CapSlider
                      label="Max NAV exposure"
                      hint="Total % of starting capital that can be deployed at once."
                      value={bot.max_nav_exposure_pct}
                      onChange={(v) => setBot({ ...bot, max_nav_exposure_pct: v })}
                      min={20} max={100} step={5} suffix="%"
                    />
                    <CapSlider
                      label="Max per single name"
                      hint="No single ticker can exceed this % of starting NAV."
                      value={bot.max_single_name_pct}
                      onChange={(v) => setBot({ ...bot, max_single_name_pct: v })}
                      min={5} max={50} step={1} suffix="%"
                    />
                    <CapSlider
                      label="Daily loss kill-switch"
                      hint="When today's combined P&L drops below this, no new entries until tomorrow."
                      value={bot.daily_loss_limit_pct}
                      onChange={(v) => setBot({ ...bot, daily_loss_limit_pct: v })}
                      min={1} max={10} step={0.5} suffix="%" decimals={1}
                    />
                  </Card>
                )}
              </>
            )}
          </section>

          {/* Portfolio Risk Caps section (existing) */}
          <section className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-5 h-5 text-primary" />
                <h2 className="text-2xl font-medium tracking-tight">Portfolio Risk Caps</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Personal limits enforced before any new virtual position is opened from a manual signal.
              </p>
            </div>

            {!loading && (
              <>
                <Card className="glass-card p-5 space-y-5">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Enforcement</Label>
                      <p className="text-xs text-muted-foreground">Turn portfolio gating on or off entirely.</p>
                    </div>
                    <Switch checked={caps.enabled} onCheckedChange={(v) => setCaps({ ...caps, enabled: v })} />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm">Mode</Label>
                      <Select
                        value={caps.enforcement_mode}
                        onValueChange={(v: "warn" | "block") => setCaps({ ...caps, enforcement_mode: v })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="warn">Warn — show alert, allow override</SelectItem>
                          <SelectItem value="block">Block — prevent registration</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm">Status</Label>
                      <div className="h-10 flex items-center">
                        <Badge variant={caps.enabled ? "default" : "secondary"}>
                          {caps.enabled ? `Active (${caps.enforcement_mode})` : "Disabled"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card className="glass-card p-5 space-y-6">
                  <CapSlider label="Max sector concentration"
                    hint="Maximum % of portfolio value any single sector can represent."
                    value={caps.sector_max_pct}
                    onChange={(v) => setCaps({ ...caps, sector_max_pct: v })}
                    min={5} max={100} step={1} suffix="%" />
                  <CapSlider label="Max portfolio beta"
                    hint="Weighted beta vs SPY. Lower = more defensive, higher = more aggressive."
                    value={caps.portfolio_beta_max}
                    onChange={(v) => setCaps({ ...caps, portfolio_beta_max: v })}
                    min={0.3} max={3.0} step={0.1} decimals={1} />
                  <CapSlider label="Max correlated positions per sector"
                    hint="Multiple stocks in the same sector behave like one leveraged bet."
                    value={caps.max_correlated_positions}
                    onChange={(v) => setCaps({ ...caps, max_correlated_positions: Math.round(v) })}
                    min={1} max={10} step={1} />
                </Card>

                <Card className="glass-card p-4 flex items-start gap-3 bg-primary/5 border-primary/20">
                  <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Caps are evaluated against your <span className="text-foreground">currently open virtual positions</span> at
                    the moment you register a new one. Beta is computed from 60 trading days of returns vs SPY.
                  </p>
                </Card>
              </>
            )}
          </section>

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving} variant="success">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Settings
            </Button>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

interface AutopilotStatusCardProps {
  lastScanAt: string | null;
  nextScanAt: string | null;
  enabled: boolean;
}

function AutopilotStatusCard({ lastScanAt, nextScanAt, enabled }: AutopilotStatusCardProps) {
  const lastLabel = useMemo(() => formatRelative(lastScanAt, "past"), [lastScanAt]);
  const nextLabel = useMemo(() => formatRelative(nextScanAt, "future"), [nextScanAt]);

  return (
    <Card className="glass-card p-5 space-y-4 bg-primary/5 border-primary/20">
      <div className="flex items-start gap-3">
        <Sparkles className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="text-sm text-foreground font-medium">Algorithm in control</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Conviction floor, exposure caps, position count, and scan cadence all adapt to live market conditions.
            Tighter rules in bear regimes; faster scans around the open and during high volatility.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Last scan</p>
          <p className="text-sm font-mono">{enabled ? lastLabel : "—"}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Next scan</p>
          <p className="text-sm font-mono">{enabled ? nextLabel : "—"}</p>
        </div>
      </div>
    </Card>
  );
}

function formatRelative(iso: string | null, dir: "past" | "future"): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  const absMin = Math.round(Math.abs(ms) / 60000);
  if (absMin < 1) return dir === "past" ? "just now" : "any moment";
  if (absMin < 60) return dir === "past" ? `${absMin} min ago` : `in ${absMin} min`;
  const hrs = Math.round(absMin / 60);
  return dir === "past" ? `${hrs}h ago` : `in ${hrs}h`;
}

interface CapSliderProps {
  label: string; hint: string; value: number;
  onChange: (v: number) => void;
  min: number; max: number; step: number;
  suffix?: string; decimals?: number;
}

function CapSlider({ label, hint, value, onChange, min, max, step, suffix = "", decimals = 0 }: CapSliderProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm">{label}</Label>
          <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
        </div>
        <div className="font-mono text-sm font-medium text-primary tabular-nums">
          {value.toFixed(decimals)}{suffix}
        </div>
      </div>
      <Slider value={[value]} onValueChange={([v]) => onChange(v)} min={min} max={max} step={step} />
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
        <span>{min}{suffix}</span>
        <span>{max}{suffix}</span>
      </div>
    </div>
  );
}

export default Settings;
