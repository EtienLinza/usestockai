import { useEffect, useState } from "react";
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
import { Shield, Loader2, Info, Bot } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface PortfolioCaps {
  sector_max_pct: number;
  portfolio_beta_max: number;
  max_correlated_positions: number;
  enforcement_mode: "warn" | "block";
  enabled: boolean;
}

interface AutoTradeSettings {
  enabled: boolean;
  min_conviction: number;
  max_positions: number;
  max_nav_exposure_pct: number;
  max_single_name_pct: number;
  daily_loss_limit_pct: number;
  starting_nav: number;
  paper_mode: boolean;
}

const CAPS_DEFAULTS: PortfolioCaps = {
  sector_max_pct: 35,
  portfolio_beta_max: 1.5,
  max_correlated_positions: 3,
  enforcement_mode: "warn",
  enabled: true,
};

const AUTOTRADE_DEFAULTS: AutoTradeSettings = {
  enabled: false,
  min_conviction: 70,
  max_positions: 8,
  max_nav_exposure_pct: 80,
  max_single_name_pct: 20,
  daily_loss_limit_pct: 3,
  starting_nav: 100000,
  paper_mode: true,
};

const Settings = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [caps, setCaps] = useState<PortfolioCaps>(CAPS_DEFAULTS);
  const [bot, setBot] = useState<AutoTradeSettings>(AUTOTRADE_DEFAULTS);
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
          .select("enabled, min_conviction, max_positions, max_nav_exposure_pct, max_single_name_pct, daily_loss_limit_pct, starting_nav, paper_mode")
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
          min_conviction: Number(botRes.data.min_conviction),
          max_positions: Number(botRes.data.max_positions),
          max_nav_exposure_pct: Number(botRes.data.max_nav_exposure_pct),
          max_single_name_pct: Number(botRes.data.max_single_name_pct),
          daily_loss_limit_pct: Number(botRes.data.daily_loss_limit_pct),
          starting_nav: Number(botRes.data.starting_nav),
          paper_mode: Boolean(botRes.data.paper_mode),
        });
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
                Hands-off scanner that opens, holds, and closes positions every 10 minutes during market hours.
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
                        When on, the system scans your watchlist every 10 minutes and trades for you.
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
                  <div className="flex items-center gap-2">
                    <Badge variant={bot.enabled ? "default" : "secondary"}>
                      {bot.enabled ? "Active" : "Paused"}
                    </Badge>
                    {bot.paper_mode && <Badge variant="outline">Paper</Badge>}
                  </div>
                </Card>

                <Card className="glass-card p-5 space-y-6">
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
