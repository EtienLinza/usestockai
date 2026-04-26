import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { SystemHealth } from "@/components/SystemHealth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Shield, Loader2, Info, Bot, Sparkles, Clock, Activity, TrendingUp, TrendingDown, Minus, Wallet, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { getMarketStatus } from "@/lib/market-hours";

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
  kill_switch: boolean;
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
  auto_add_watchlist: boolean;
  auto_watchlist_consideration_floor: number;
  auto_watchlist_stale_days: number;
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
  kill_switch: false,
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
  auto_add_watchlist: true,
  auto_watchlist_consideration_floor: 60,
  auto_watchlist_stale_days: 14,
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
  const [adaptiveState, setAdaptiveState] = useState<AutotraderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [capsRes, botRes, stateRes] = await Promise.all([
        supabase.from("portfolio_caps")
          .select("sector_max_pct, portfolio_beta_max, max_correlated_positions, enforcement_mode, enabled")
          .eq("user_id", user.id).maybeSingle(),
        supabase.from("autotrade_settings")
          .select("enabled, kill_switch, paper_mode, advanced_mode, adaptive_mode, risk_profile, scan_interval_minutes, min_conviction, max_positions, max_nav_exposure_pct, max_single_name_pct, daily_loss_limit_pct, starting_nav, last_scan_at, next_scan_at, auto_add_watchlist, auto_watchlist_consideration_floor, auto_watchlist_stale_days")
          .eq("user_id", user.id).maybeSingle(),
        supabase.from("autotrader_state")
          .select("effective_min_conviction, effective_max_positions, effective_max_nav_exposure_pct, effective_max_single_name_pct, vix_value, vix_regime, spy_trend, recent_pnl_pct, adjustments, reason, computed_at")
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
          kill_switch: Boolean(botRes.data.kill_switch),
          paper_mode: Boolean(botRes.data.paper_mode),
          advanced_mode: Boolean(botRes.data.advanced_mode),
          adaptive_mode: botRes.data.adaptive_mode ?? true,
          risk_profile: (botRes.data.risk_profile as RiskProfile) ?? "balanced",
          scan_interval_minutes: Number(botRes.data.scan_interval_minutes ?? 10),
          min_conviction: Number(botRes.data.min_conviction),
          max_positions: Number(botRes.data.max_positions),
          max_nav_exposure_pct: Number(botRes.data.max_nav_exposure_pct),
          max_single_name_pct: Number(botRes.data.max_single_name_pct),
          daily_loss_limit_pct: Number(botRes.data.daily_loss_limit_pct),
          starting_nav: Number(botRes.data.starting_nav),
          auto_add_watchlist: botRes.data.auto_add_watchlist ?? true,
          auto_watchlist_consideration_floor: Number(botRes.data.auto_watchlist_consideration_floor ?? 60),
          auto_watchlist_stale_days: Number(botRes.data.auto_watchlist_stale_days ?? 14),
        });
        setLastScanAt(botRes.data.last_scan_at as string | null);
        setNextScanAt(botRes.data.next_scan_at as string | null);
      }
      if (stateRes.data) {
        setAdaptiveState({
          effective_min_conviction: Number(stateRes.data.effective_min_conviction),
          effective_max_positions: Number(stateRes.data.effective_max_positions),
          effective_max_nav_exposure_pct: Number(stateRes.data.effective_max_nav_exposure_pct),
          effective_max_single_name_pct: Number(stateRes.data.effective_max_single_name_pct),
          vix_value: stateRes.data.vix_value != null ? Number(stateRes.data.vix_value) : null,
          vix_regime: stateRes.data.vix_regime as string | null,
          spy_trend: stateRes.data.spy_trend as string | null,
          recent_pnl_pct: stateRes.data.recent_pnl_pct != null ? Number(stateRes.data.recent_pnl_pct) : null,
          adjustments: (stateRes.data.adjustments as string[] | null) ?? null,
          reason: stateRes.data.reason as string | null,
          computed_at: stateRes.data.computed_at as string,
        });
      }
      setLoading(false);
    })();
  }, [user]);

  // Realtime: refresh adaptive state whenever the autotrader scan updates it
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`autotrader_state:${user.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "autotrader_state",
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const r = payload.new as Record<string, unknown>;
        if (!r) return;
        setAdaptiveState({
          effective_min_conviction: Number(r.effective_min_conviction),
          effective_max_positions: Number(r.effective_max_positions),
          effective_max_nav_exposure_pct: Number(r.effective_max_nav_exposure_pct),
          effective_max_single_name_pct: Number(r.effective_max_single_name_pct),
          vix_value: r.vix_value != null ? Number(r.vix_value) : null,
          vix_regime: (r.vix_regime as string | null) ?? null,
          spy_trend: (r.spy_trend as string | null) ?? null,
          recent_pnl_pct: r.recent_pnl_pct != null ? Number(r.recent_pnl_pct) : null,
          adjustments: (r.adjustments as string[] | null) ?? null,
          reason: (r.reason as string | null) ?? null,
          computed_at: r.computed_at as string,
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
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
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-sm">Risk profile</Label>
                        <p className="text-xs text-muted-foreground">
                          {RISK_PROFILE_LABEL[bot.risk_profile].hint}
                        </p>
                      </div>
                      <Select
                        value={bot.risk_profile}
                        onValueChange={(v: RiskProfile) => setBot({ ...bot, risk_profile: v })}
                      >
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(RISK_PROFILE_LABEL) as RiskProfile[]).map((k) => (
                            <SelectItem key={k} value={k}>{RISK_PROFILE_LABEL[k].label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm">Adaptive mode</Label>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                          <Activity className="w-2.5 h-2.5" /> live
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Auto-tune conviction floor, position cap, and exposure to live VIX, SPY trend, and your recent P&L.
                      </p>
                    </div>
                    <Switch checked={bot.adaptive_mode} onCheckedChange={(v) => setBot({ ...bot, adaptive_mode: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm">Advanced mode</Label>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">manual control</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Reveal scan interval and manual caps. Adaptive mode (when on) still layers on top.
                      </p>
                    </div>
                    <Switch checked={bot.advanced_mode} onCheckedChange={(v) => setBot({ ...bot, advanced_mode: v })} />
                  </div>
                </Card>

                {/* Emergency Stop — visually distinct, dangerous-looking on purpose */}
                <Card className={cn(
                  "p-5 space-y-3 border-2 transition-colors",
                  bot.kill_switch
                    ? "border-destructive bg-destructive/10"
                    : "border-destructive/30 bg-destructive/5",
                )}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={cn("w-4 h-4", bot.kill_switch ? "text-destructive" : "text-destructive/70")} />
                        <Label className="text-sm font-semibold">Emergency Stop</Label>
                        {bot.kill_switch && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">ACTIVE</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Freezes the autotrader: no new entries AND no automated exits will run.
                        Your existing positions stay open until you close them manually.
                        Use this if you suspect bad data, want to take manual control, or just need a breather.
                      </p>
                    </div>
                    <Switch
                      checked={bot.kill_switch}
                      onCheckedChange={(v) => setBot({ ...bot, kill_switch: v })}
                      className="data-[state=checked]:bg-destructive"
                    />
                  </div>
                </Card>

                <Card className="glass-card p-5 space-y-5">
                  {/* (continued — the original card is split here so the kill switch sits between sections) */}
                  <div className="space-y-3 rounded-lg border border-border/50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <Label className="text-sm">Auto-discover tickers</Label>
                        <p className="text-xs text-muted-foreground">
                          Automatically add promising tickers from the live signal feed to your watchlist. Auto-added tickers are removed if no qualifying signal appears for {bot.auto_watchlist_stale_days} days (held positions are never removed).
                        </p>
                      </div>
                      <Switch
                        checked={bot.auto_add_watchlist}
                        onCheckedChange={(v) => setBot({ ...bot, auto_add_watchlist: v })}
                      />
                    </div>
                    {bot.auto_add_watchlist && (
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Consideration floor</Label>
                          <Input
                            type="number"
                            min={50}
                            max={95}
                            value={bot.auto_watchlist_consideration_floor}
                            onChange={(e) => setBot({
                              ...bot,
                              auto_watchlist_consideration_floor: Math.max(50, Math.min(95, Number(e.target.value) || 60)),
                            })}
                            className="h-8 text-sm"
                          />
                          <p className="text-[10px] text-muted-foreground">Min signal conviction (50–95)</p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Stale after (days)</Label>
                          <Input
                            type="number"
                            min={1}
                            max={90}
                            value={bot.auto_watchlist_stale_days}
                            onChange={(e) => setBot({
                              ...bot,
                              auto_watchlist_stale_days: Math.max(1, Math.min(90, Number(e.target.value) || 14)),
                            })}
                            className="h-8 text-sm"
                          />
                          <p className="text-[10px] text-muted-foreground">Auto-remove window (1–90)</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={bot.enabled ? "default" : "secondary"}>
                      {bot.enabled ? "Active" : "Paused"}
                    </Badge>
                    {bot.paper_mode && <Badge variant="outline">Paper</Badge>}
                    <Badge variant="outline" className="gap-1 capitalize">
                      <Sparkles className="w-3 h-3" /> {bot.risk_profile}
                    </Badge>
                    {bot.adaptive_mode && (
                      <Badge variant="outline" className="gap-1 text-primary border-primary/30">
                        <Activity className="w-3 h-3" /> Adaptive
                      </Badge>
                    )}
                  </div>
                </Card>

                <StartingCapitalCard
                  value={bot.starting_nav}
                  onChange={(v) => setBot({ ...bot, starting_nav: v })}
                />

                <AdaptiveStatusCard
                  state={adaptiveState}
                  enabled={bot.enabled}
                  adaptive={bot.adaptive_mode}
                  lastScanAt={lastScanAt}
                  nextScanAt={nextScanAt}
                />

                {bot.advanced_mode && (
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
                      effective={bot.adaptive_mode ? adaptiveState?.effective_min_conviction : undefined}
                    />
                    <CapSlider
                      label="Max open positions"
                      hint="Maximum simultaneous trades."
                      value={bot.max_positions}
                      onChange={(v) => setBot({ ...bot, max_positions: Math.round(v) })}
                      min={1} max={20} step={1}
                      effective={bot.adaptive_mode ? adaptiveState?.effective_max_positions : undefined}
                    />
                    <CapSlider
                      label="Max NAV exposure"
                      hint="Total % of starting capital that can be deployed at once."
                      value={bot.max_nav_exposure_pct}
                      onChange={(v) => setBot({ ...bot, max_nav_exposure_pct: v })}
                      min={20} max={100} step={5} suffix="%"
                      effective={bot.adaptive_mode ? adaptiveState?.effective_max_nav_exposure_pct : undefined}
                    />
                    <CapSlider
                      label="Max per single name"
                      hint="No single ticker can exceed this % of starting NAV."
                      value={bot.max_single_name_pct}
                      onChange={(v) => setBot({ ...bot, max_single_name_pct: v })}
                      min={5} max={50} step={1} suffix="%"
                      effective={bot.adaptive_mode ? adaptiveState?.effective_max_single_name_pct : undefined}
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

          <section className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-5 h-5 text-primary" />
                <h2 className="text-2xl font-medium tracking-tight">System Health</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Live status of background scanners, alerts, and digests.
              </p>
            </div>
            <SystemHealth />
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

interface AdaptiveStatusCardProps {
  state: AutotraderState | null;
  enabled: boolean;
  adaptive: boolean;
  lastScanAt: string | null;
  nextScanAt: string | null;
}

function AdaptiveStatusCard({ state, enabled, adaptive, lastScanAt, nextScanAt }: AdaptiveStatusCardProps) {
  const lastLabel = useMemo(() => formatRelative(lastScanAt, "past"), [lastScanAt]);

  if (!adaptive) {
    return (
      <Card className="glass-card p-5 space-y-3 bg-muted/20 border-border/50">
        <div className="flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="text-sm text-foreground font-medium">Adaptive mode is off</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Limits stay fixed at your <span className="text-foreground capitalize">risk profile</span> baseline (or your manual values in advanced mode).
              Turn on Adaptive mode to let the system tighten in volatile markets and ease up in calm ones.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const TrendIcon =
    state?.spy_trend === "up" ? TrendingUp :
    state?.spy_trend === "down" ? TrendingDown : Minus;
  const trendCls =
    state?.spy_trend === "up" ? "text-success" :
    state?.spy_trend === "down" ? "text-destructive" : "text-muted-foreground";

  const vixCls =
    state?.vix_regime === "calm" ? "text-success border-success/30 bg-success/10" :
    state?.vix_regime === "elevated" ? "text-amber-500 border-amber-500/30 bg-amber-500/10" :
    state?.vix_regime === "crisis" ? "text-destructive border-destructive/30 bg-destructive/10" :
    "text-muted-foreground border-muted-foreground/30 bg-muted/40";

  const pnlCls =
    state?.recent_pnl_pct == null ? "text-muted-foreground" :
    state.recent_pnl_pct >= 0 ? "text-success" : "text-destructive";

  return (
    <Card className="glass-card p-5 space-y-4 bg-primary/5 border-primary/20">
      <div className="flex items-start gap-3">
        <Activity className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <div className="space-y-1 flex-1">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-foreground font-medium">Currently in effect</p>
            <p className="text-[10px] text-muted-foreground font-mono">
              {state ? `updated ${formatRelative(state.computed_at, "past")}` : "awaiting first scan"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Live limits derived from your risk profile, market regime, and recent P&L. Daily loss kill-switch ({bot_daily_loss_label_helper(state)}) stays fixed as a hard floor.
          </p>
        </div>
      </div>

      {/* Live regime context */}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/40">
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">VIX</p>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-mono">{state?.vix_value?.toFixed(1) ?? "—"}</span>
            {state?.vix_regime && (
              <Badge variant="outline" className={cn("text-[9px] capitalize px-1.5 py-0", vixCls)}>
                {state.vix_regime}
              </Badge>
            )}
          </div>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">SPY trend</p>
          <div className={cn("flex items-center gap-1 text-sm font-mono", trendCls)}>
            <TrendIcon className="w-3.5 h-3.5" />
            <span className="capitalize">{state?.spy_trend ?? "—"}</span>
          </div>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">7-day P&L</p>
          <span className={cn("text-sm font-mono", pnlCls)}>
            {state?.recent_pnl_pct != null
              ? `${state.recent_pnl_pct >= 0 ? "+" : ""}${state.recent_pnl_pct.toFixed(2)}%`
              : "—"}
          </span>
        </div>
      </div>

      {/* Effective limits */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border/40">
        <EffectiveCell label="Conviction floor" value={state?.effective_min_conviction} />
        <EffectiveCell label="Max positions" value={state?.effective_max_positions} />
        <EffectiveCell label="Max NAV" value={state?.effective_max_nav_exposure_pct} suffix="%" />
        <EffectiveCell label="Max single" value={state?.effective_max_single_name_pct} suffix="%" />
      </div>

      {/* Why */}
      {state?.adjustments && state.adjustments.length > 0 && (
        <div className="pt-2 border-t border-border/40 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Why these limits</p>
          <ul className="space-y-1">
            {state.adjustments.map((a, i) => (
              <li key={i} className="text-xs text-muted-foreground/90 leading-snug flex gap-2">
                <span className="text-primary/60 mt-0.5">•</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cadence */}
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40">
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Last scan</p>
          <p className="text-sm font-mono">{enabled ? lastLabel : "—"}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Next scan</p>
          <p className="text-sm font-mono">{enabled ? nextScanDisplay(nextScanAt) : "—"}</p>
        </div>
      </div>
    </Card>
  );
}

/**
 * Returns a friendly "next scan" label that respects US market hours.
 * The autotrader cron fires every 10 min but the function early-exits on
 * weekends/holidays/after-hours, so a stale next_scan_at would otherwise
 * show a misleading countdown.
 */
function nextScanDisplay(nextScanAt: string | null): string {
  const status = getMarketStatus();
  if (status.isOpen) {
    return formatRelative(nextScanAt, "future");
  }
  return status.label;
}

function bot_daily_loss_label_helper(_s: AutotraderState | null): string {
  // Daily loss limit isn't on the state row — it's always the user's chosen value.
  // Kept as a small helper so the JSX above stays readable.
  return "user-controlled, default 3%";
}

function EffectiveCell({ label, value, suffix = "" }: { label: string; value: number | null | undefined; suffix?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-mono font-medium text-primary tabular-nums">
        {value != null ? `${value}${suffix}` : "—"}
      </p>
    </div>
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
  effective?: number;
}

function CapSlider({ label, hint, value, onChange, min, max, step, suffix = "", decimals = 0, effective }: CapSliderProps) {
  const showEffective = effective != null && Math.abs(effective - value) > 0.01;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm">{label}</Label>
          <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
          {showEffective && (
            <p className="text-[10px] text-primary/80 font-mono mt-1">
              Adaptive override → currently {Number(effective).toFixed(decimals)}{suffix}
            </p>
          )}
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

interface StartingCapitalCardProps {
  value: number;
  onChange: (v: number) => void;
}

function StartingCapitalCard({ value, onChange }: StartingCapitalCardProps) {
  // Local string state so the user can clear/type freely without React clobbering input
  const [draft, setDraft] = useState<string>(
    Number.isFinite(value) && value > 0 ? String(Math.round(value)) : "",
  );

  // Re-sync local draft if parent value changes (e.g. after data load)
  useEffect(() => {
    if (Number.isFinite(value) && value > 0) {
      setDraft(String(Math.round(value)));
    } else {
      setDraft("");
    }
  }, [value]);

  const handleAmountChange = (raw: string) => {
    // Strip commas and any non-digit/decimal characters
    const cleaned = raw.replace(/[^0-9.]/g, "");
    setDraft(cleaned);
    const parsed = parseFloat(cleaned);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      onChange(parsed);
    } else if (cleaned === "") {
      onChange(0);
    }
  };

  const formatted = Number.isFinite(value) && value > 0
    ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : null;

  return (
    <Card className="glass-card p-5 space-y-5">
      <div className="flex items-start gap-3">
        <Wallet className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <div className="space-y-1 flex-1">
          <Label className="text-sm">Starting capital</Label>
          <p className="text-xs text-muted-foreground leading-relaxed">
            How much money you have available. Position size and exposure caps are calculated from this amount.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="starting-nav-input" className="text-xs uppercase tracking-wider text-muted-foreground">
          Amount (USD)
        </Label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-mono pointer-events-none">
            $
          </span>
          <Input
            id="starting-nav-input"
            inputMode="decimal"
            value={draft}
            onChange={(e) => handleAmountChange(e.target.value)}
            placeholder="100000"
            className="pl-8 font-mono tabular-nums"
          />
        </div>
        {formatted && (
          <p className="text-[11px] text-muted-foreground font-mono">
            ${formatted}
          </p>
        )}
      </div>
    </Card>
  );
}

export default Settings;
