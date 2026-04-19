import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Shield, Loader2, Info } from "lucide-react";
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

const DEFAULTS: PortfolioCaps = {
  sector_max_pct: 35,
  portfolio_beta_max: 1.5,
  max_correlated_positions: 3,
  enforcement_mode: "warn",
  enabled: true,
};

const Settings = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [caps, setCaps] = useState<PortfolioCaps>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("portfolio_caps")
        .select("sector_max_pct, portfolio_beta_max, max_correlated_positions, enforcement_mode, enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!error && data) {
        setCaps({
          sector_max_pct: Number(data.sector_max_pct),
          portfolio_beta_max: Number(data.portfolio_beta_max),
          max_correlated_positions: Number(data.max_correlated_positions),
          enforcement_mode: (data.enforcement_mode as "warn" | "block") ?? "warn",
          enabled: Boolean(data.enabled),
        });
      }
      setLoading(false);
    })();
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("portfolio_caps")
      .upsert({ user_id: user.id, ...caps }, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      toast.error("Failed to save settings");
    } else {
      toast.success("Portfolio caps updated");
    }
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
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-medium tracking-tight">Portfolio Risk Caps</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Personal limits enforced before any new virtual position is opened from a signal.
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
                    <Label className="text-sm">Enforcement</Label>
                    <p className="text-xs text-muted-foreground">
                      Turn portfolio gating on or off entirely.
                    </p>
                  </div>
                  <Switch
                    checked={caps.enabled}
                    onCheckedChange={(v) => setCaps({ ...caps, enabled: v })}
                  />
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
                <CapSlider
                  label="Max sector concentration"
                  hint="Maximum % of portfolio value any single sector can represent."
                  value={caps.sector_max_pct}
                  onChange={(v) => setCaps({ ...caps, sector_max_pct: v })}
                  min={5}
                  max={100}
                  step={1}
                  suffix="%"
                />

                <CapSlider
                  label="Max portfolio beta"
                  hint="Weighted beta vs SPY. Lower = more defensive, higher = more aggressive."
                  value={caps.portfolio_beta_max}
                  onChange={(v) => setCaps({ ...caps, portfolio_beta_max: v })}
                  min={0.3}
                  max={3.0}
                  step={0.1}
                  suffix=""
                  decimals={1}
                />

                <CapSlider
                  label="Max correlated positions per sector"
                  hint="Multiple stocks in the same sector behave like one leveraged bet."
                  value={caps.max_correlated_positions}
                  onChange={(v) => setCaps({ ...caps, max_correlated_positions: Math.round(v) })}
                  min={1}
                  max={10}
                  step={1}
                  suffix=""
                />
              </Card>

              <Card className="glass-card p-4 flex items-start gap-3 bg-primary/5 border-primary/20">
                <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Caps are evaluated against your <span className="text-foreground">currently open virtual positions</span> at
                  the moment you register a new one. Beta is computed from 60 trading days of returns vs SPY.
                  Sector buckets follow the SPDR sector ETF mapping (XLK, XLF, XLV, etc.).
                </p>
              </Card>

              <div className="flex justify-end">
                <Button onClick={save} disabled={saving} variant="success">
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Save Settings
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </main>
    </div>
  );
};

interface CapSliderProps {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  decimals?: number;
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
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
        <span>{min}{suffix}</span>
        <span>{max}{suffix}</span>
      </div>
    </div>
  );
}

export default Settings;
