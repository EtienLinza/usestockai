import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DollarSign, TrendingUp, TrendingDown, Sparkles, AlertCircle, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  ticker: string;
  confidence: number;          // 0-100
  currentPrice?: number | null;
  suggestedEntry?: number | null;
  suggestedTarget?: number | null;
  annualizedVolPct?: number | null; // e.g. 32 (=32%)
  kellyFraction?: number | null;    // 0..1
}

type HorizonKey =
  | "ultra_short" | "short" | "short_mid" | "mid"
  | "long_mid" | "long" | "extra_long" | "lifetime";

const HORIZONS: { key: HorizonKey; label: string; months: number; hint: string }[] = [
  { key: "ultra_short", label: "Ultra short term", months: 0.25, hint: "~1 week" },
  { key: "short",       label: "Short term",       months: 1,    hint: "~1 month" },
  { key: "short_mid",   label: "Short / mid term", months: 3,    hint: "~3 months" },
  { key: "mid",         label: "Mid term",         months: 6,    hint: "~6 months" },
  { key: "long_mid",    label: "Long / mid term",  months: 12,   hint: "1 year" },
  { key: "long",        label: "Long term",        months: 36,   hint: "3 years" },
  { key: "extra_long",  label: "Extra long term",  months: 60,   hint: "5 years" },
  { key: "lifetime",    label: "Lifetime hold",    months: 360,  hint: "30 years" },
];

const MIN_CONFIDENCE = 60;

const fmtMoney = (v: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;

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

    // Edge derived from confidence: 50% = no edge, 100% = +25% alpha vs market baseline.
    const baselineAnnual = 0.08;                                  // market-average drift
    const edgeAlpha = ((confidence - 50) / 50) * 0.25;            // 0..0.25
    // Kelly damping — if the engine wants to size small, trust the edge less.
    const kelly = Math.max(0, Math.min(1, kellyFraction ?? 0.5));
    const dampedAlpha = edgeAlpha * (0.5 + 0.5 * kelly);          // 0.5..1.0× weight
    let annualReturn = baselineAnnual + dampedAlpha;

    // Sanity check using the engine's own short-horizon target.
    if (suggestedTarget && entry > 0) {
      const tgtPct = (suggestedTarget - entry) / entry;
      // Engine targets are typically 1-month swing — annualize then blend.
      const tgtAnnual = Math.pow(1 + tgtPct, 12) - 1;
      annualReturn = 0.5 * annualReturn + 0.5 * Math.max(-0.5, Math.min(1.5, tgtAnnual));
    }

    const annualVol = Math.max(0.05, (annualizedVolPct ?? 25) / 100);
    const years = HORIZONS.find((h) => h.key === horizon)!.months / 12;

    // Compound growth across the horizon. Best/worst case = ±1 stdev band.
    // Scale band by sqrt(time) so longer horizons widen (Brownian-ish).
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
    };
  }, [lowConfidence, entry, principal, confidence, kellyFraction, suggestedTarget, annualizedVolPct, horizon]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.05 }}
    >
      <Card className="glass-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Simulate this trade</span>
            <Badge variant="outline" className="font-mono text-[10px]">{ticker}</Badge>
          </div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Step 2 · Projection
          </span>
        </div>

        {lowConfidence ? (
          <div className="flex items-start gap-2 text-xs bg-muted/30 border border-border/50 rounded-md p-3">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <div className="font-medium">Not confident enough to simulate.</div>
              <div className="text-muted-foreground leading-relaxed">
                Confidence is {Math.round(confidence)}% — below the {MIN_CONFIDENCE}% threshold needed for a
                meaningful growth projection. I can't give you a conclusive result on this one.
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="sim-amount" className="text-xs text-muted-foreground">
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
                    className="pl-9 font-mono bg-secondary/50 border-border/50"
                    min="0"
                    step="100"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Time frame</Label>
                <Select value={horizon} onValueChange={(v) => setHorizon(v as HorizonKey)}>
                  <SelectTrigger className="bg-secondary/50 border-border/50">
                    <Clock className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-50">
                    {HORIZONS.map((h) => (
                      <SelectItem key={h.key} value={h.key}>
                        <span className="flex items-center justify-between gap-3 w-full">
                          <span>{h.label}</span>
                          <span className="text-[10px] text-muted-foreground">{h.hint}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {projection ? (
              <div className="space-y-3">
                <div className="text-[11px] text-muted-foreground">
                  At {fmtMoney(entry!)}/share you'd own{" "}
                  <span className="font-mono text-foreground">{projection.shares.toFixed(4)}</span> shares.
                  Model assumes ~{(projection.annualReturn * 100).toFixed(1)}% expected annualized return
                  and ~{(projection.annualVol * 100).toFixed(1)}% vol.
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <ProjCard
                    label="Worst case"
                    value={projection.worst}
                    pct={projection.worstPct}
                    tone={projection.worstPct >= 0 ? "neutral" : "down"}
                  />
                  <ProjCard
                    label="Expected"
                    value={projection.expected}
                    pct={projection.expectedPct}
                    tone={projection.expectedPct >= 0 ? "up" : "down"}
                    emphasis
                  />
                  <ProjCard
                    label="Best case"
                    value={projection.best}
                    pct={projection.bestPct}
                    tone="up"
                  />
                </div>

                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  Projections compound the model's annualized return over your selected horizon; the best/worst band
                  scales with realized volatility. Real outcomes will differ — markets are stochastic and the engine
                  can be wrong. Not financial advice.
                </p>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Enter an amount to project growth.</div>
            )}
          </>
        )}
      </Card>
    </motion.div>
  );
};

const ProjCard = ({
  label, value, pct, tone, emphasis,
}: {
  label: string; value: number; pct: number;
  tone: "up" | "down" | "neutral"; emphasis?: boolean;
}) => {
  const color = tone === "up" ? "text-success" : tone === "down" ? "text-destructive" : "text-foreground";
  const bg =
    tone === "up" ? "bg-success/5 border-success/20"
    : tone === "down" ? "bg-destructive/5 border-destructive/20"
    : "bg-muted/20 border-border/40";
  const Arrow = tone === "down" ? TrendingDown : TrendingUp;
  return (
    <div className={cn("rounded-md p-3 border space-y-1", bg, emphasis && "ring-1 ring-primary/30")}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Arrow className={cn("w-3 h-3", color)} /> {label}
      </div>
      <div className={cn("font-mono font-semibold", emphasis ? "text-lg" : "text-base", color)}>
        {fmtMoney(value)}
      </div>
      <div className={cn("text-[10px] font-mono", color)}>{fmtPct(pct)}</div>
    </div>
  );
};
