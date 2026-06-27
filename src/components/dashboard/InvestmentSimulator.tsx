import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign, TrendingUp, TrendingDown, Sparkles, AlertCircle, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  ticker: string;
  confidence: number;
  currentPrice?: number | null;
  suggestedEntry?: number | null;
  suggestedTarget?: number | null;
  annualizedVolPct?: number | null;
  kellyFraction?: number | null;
}

type HorizonKey =
  | "ultra_short" | "short" | "short_mid" | "mid"
  | "long_mid" | "long" | "extra_long" | "lifetime";

const HORIZONS: { key: HorizonKey; short: string; long: string; months: number }[] = [
  { key: "ultra_short", short: "1W",  long: "1 week",   months: 0.25 },
  { key: "short",       short: "1M",  long: "1 month",  months: 1 },
  { key: "short_mid",   short: "3M",  long: "3 months", months: 3 },
  { key: "mid",         short: "6M",  long: "6 months", months: 6 },
  { key: "long_mid",    short: "1Y",  long: "1 year",   months: 12 },
  { key: "long",        short: "3Y",  long: "3 years",  months: 36 },
  { key: "extra_long",  short: "5Y",  long: "5 years",  months: 60 },
  { key: "lifetime",    short: "30Y", long: "Lifetime", months: 360 },
];

const AMOUNT_PRESETS = [100, 500, 1000, 5000, 10000];
const MIN_CONFIDENCE = 60;

const fmtMoney = (v: number, compact = false) => {
  const useCompact = compact && Math.abs(v) >= 10000;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    notation: useCompact ? "compact" : "standard",
    maximumFractionDigits: 2,
    minimumFractionDigits: useCompact ? 0 : 2,
  }).format(v);
};

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

export const InvestmentSimulator = ({
  ticker, confidence, currentPrice, suggestedEntry, suggestedTarget,
  annualizedVolPct, kellyFraction,
}: Props) => {
  const [amount, setAmount] = useState("1000");
  const [horizon, setHorizon] = useState<HorizonKey>("mid");

  const lowConfidence = confidence < MIN_CONFIDENCE;
  const principal = Math.max(0, parseFloat(amount) || 0);
  const entry = suggestedEntry ?? currentPrice ?? null;

  const projection = useMemo(() => {
    if (lowConfidence || !entry || principal <= 0) return null;
    const baselineAnnual = 0.08;
    const edgeAlpha = ((confidence - 50) / 50) * 0.25;
    const kelly = Math.max(0, Math.min(1, kellyFraction ?? 0.5));
    const dampedAlpha = edgeAlpha * (0.5 + 0.5 * kelly);
    let annualReturn = baselineAnnual + dampedAlpha;
    if (suggestedTarget && entry > 0) {
      const tgtPct = (suggestedTarget - entry) / entry;
      const tgtAnnual = Math.pow(1 + tgtPct, 12) - 1;
      annualReturn = 0.5 * annualReturn + 0.5 * Math.max(-0.5, Math.min(1.5, tgtAnnual));
    }
    const annualVol = Math.max(0.05, (annualizedVolPct ?? 25) / 100);
    const years = HORIZONS.find((h) => h.key === horizon)!.months / 12;
    const band = annualVol * Math.sqrt(years);
    const expected = principal * Math.pow(1 + annualReturn, years);
    const best     = principal * Math.pow(1 + annualReturn + band / years, years);
    const worst    = principal * Math.pow(1 + Math.max(-0.95, annualReturn - band / years), years);
    return {
      annualReturn, annualVol, years,
      expected, best, worst,
      expectedPct: (expected - principal) / principal,
      bestPct: (best - principal) / principal,
      worstPct: (worst - principal) / principal,
      shares: principal / entry,
      gain: expected - principal,
    };
  }, [lowConfidence, entry, principal, confidence, kellyFraction, suggestedTarget, annualizedVolPct, horizon]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.05 }}
    >
      <Card className="glass-card overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-border/50 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium leading-tight truncate">Simulate this trade</div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                Step 2 · {ticker} projection
              </div>
            </div>
          </div>
          <Badge variant="outline" className="font-mono text-[10px] shrink-0">
            {Math.round(confidence)}% conf
          </Badge>
        </div>

        {lowConfidence ? (
          <div className="p-4 sm:p-5">
            <div className="flex items-start gap-3 bg-muted/30 border border-border/50 rounded-lg p-4">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="space-y-1 text-xs">
                <div className="font-medium">Not confident enough to simulate</div>
                <div className="text-muted-foreground leading-relaxed">
                  Signal is {Math.round(confidence)}% — below the {MIN_CONFIDENCE}% threshold needed for a
                  meaningful projection. I can't give you a conclusive result on this one.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 sm:p-5 space-y-5">
            <div className="space-y-2.5">
              <Label htmlFor="sim-amount" className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Investment amount
              </Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="sim-amount"
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="1000"
                  className="pl-9 h-11 text-base font-mono bg-secondary/50 border-border/50 tabular-nums"
                  min="0"
                  step="100"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {AMOUNT_PRESETS.map((preset) => {
                  const active = parseFloat(amount) === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmount(String(preset))}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-[11px] font-mono border transition-colors",
                        active
                          ? "bg-primary/15 border-primary/40 text-primary"
                          : "bg-secondary/40 border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
                      )}
                    >
                      ${preset >= 1000 ? `${preset / 1000}k` : preset}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Time frame
              </Label>
              <div className="grid grid-cols-4 gap-1.5">
                {HORIZONS.map((h) => {
                  const active = horizon === h.key;
                  return (
                    <button
                      key={h.key}
                      type="button"
                      onClick={() => setHorizon(h.key)}
                      className={cn(
                        "flex items-center justify-center py-2 rounded-md border transition-all",
                        active
                          ? "bg-primary/15 border-primary/40 text-primary"
                          : "bg-secondary/40 border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
                      )}
                    >
                      <span className="text-xs font-mono font-semibold">{h.short}</span>
                    </button>
                  );
                })}
              </div>
              <div className="text-[10px] text-muted-foreground text-center">
                {HORIZONS.find((h) => h.key === horizon)!.long}
              </div>
            </div>

            {projection ? (
              <div className="space-y-3">
                <div className={cn(
                  "rounded-lg p-4 border space-y-1",
                  projection.expectedPct >= 0
                    ? "bg-success/5 border-success/20"
                    : "bg-destructive/5 border-destructive/20"
                )}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Expected value
                    </span>
                    <span className={cn(
                      "text-[11px] font-mono font-medium tabular-nums",
                      projection.expectedPct >= 0 ? "text-success" : "text-destructive"
                    )}>
                      {fmtPct(projection.expectedPct)}
                    </span>
                  </div>
                  <div className={cn(
                    "text-2xl sm:text-3xl font-mono font-semibold tabular-nums leading-tight",
                    projection.expectedPct >= 0 ? "text-success" : "text-destructive"
                  )}>
                    {fmtMoney(projection.expected, true)}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {projection.gain >= 0 ? "+" : "−"}{fmtMoney(Math.abs(projection.gain), true)}
                    {" · "}
                    {projection.shares.toFixed(4)} sh @ {fmtMoney(entry!)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <RangeCard
                    label="Worst"
                    value={projection.worst}
                    pct={projection.worstPct}
                    tone={projection.worstPct >= 0 ? "neutral" : "down"}
                  />
                  <RangeCard
                    label="Best"
                    value={projection.best}
                    pct={projection.bestPct}
                    tone="up"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground pt-1">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/60" />
                    {(projection.annualReturn * 100).toFixed(1)}% expected annual
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/60" />
                    {(projection.annualVol * 100).toFixed(0)}% vol
                  </span>
                </div>

                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  Projections compound the model's expected return over your horizon; best/worst scales with
                  realized volatility. Real outcomes will differ — not financial advice.
                </p>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground text-center py-2">
                Enter an amount to project growth.
              </div>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  );
};

const RangeCard = ({
  label, value, pct, tone,
}: {
  label: string; value: number; pct: number;
  tone: "up" | "down" | "neutral";
}) => {
  const color =
    tone === "up" ? "text-success"
    : tone === "down" ? "text-destructive"
    : "text-foreground";
  const bg =
    tone === "up" ? "bg-success/5 border-success/20"
    : tone === "down" ? "bg-destructive/5 border-destructive/20"
    : "bg-muted/20 border-border/40";
  const Arrow = tone === "down" ? TrendingDown : tone === "up" ? TrendingUp : Minus;
  return (
    <div className={cn("rounded-md p-3 border space-y-1", bg)}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Arrow className={cn("w-3 h-3", color)} /> {label}
      </div>
      <div className={cn("font-mono font-semibold text-base sm:text-lg tabular-nums leading-tight", color)}>
        {fmtMoney(value, true)}
      </div>
      <div className={cn("text-[10px] font-mono tabular-nums", color)}>{fmtPct(pct)}</div>
    </div>
  );
};
