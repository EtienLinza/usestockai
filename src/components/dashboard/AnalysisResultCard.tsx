import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AddToWatchlistButton } from "@/components/AddToWatchlistButton";
import {
  TrendingUp, TrendingDown, Minus, Target, Shield, DollarSign,
  Brain, ExternalLink, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface AnalysisStats {
  changePct?: number | null;
  rsi?: number | null;
  macdHist?: number | null;
  macdLine?: number | null;
  macdSignal?: number | null;
  sma20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  adx?: number | null;
  atr?: number | null;
  atrPctDaily?: number | null;
  annualizedVolPct?: number | null;
  high52w?: number | null;
  low52w?: number | null;
  rangePosition?: number | null;
  volume?: number | null;
  avgVolume20?: number | null;
  volRatio?: number | null;
  trend?: string | null;
  bars?: number | null;
}

export interface AnalysisResult {
  ticker: string;
  decision: "BUY" | "SELL" | "HOLD";
  confidence: number;
  currentPrice?: number | null;
  suggestedEntry?: number | null;
  suggestedStop?: number | null;
  suggestedTarget?: number | null;
  regime?: string | null;
  strategy?: string | null;
  profile?: string | null;
  weeklyBias?: string | null;
  weeklyAllocation?: number | null;
  atrPct?: number | null;
  kellyFraction?: number | null;
  reasoning?: string | null;
  insufficientData?: boolean;
  stats?: AnalysisStats | null;
}

interface Props {
  result: AnalysisResult | null;
  loading?: boolean;
  onSetAlert?: () => void;
}

const decisionStyle = (d: "BUY" | "SELL" | "HOLD") => {
  if (d === "BUY")  return { Icon: TrendingUp,   color: "text-success",     bg: "bg-success/15 border-success/30" };
  if (d === "SELL") return { Icon: TrendingDown, color: "text-destructive", bg: "bg-destructive/15 border-destructive/30" };
  return            { Icon: Minus,        color: "text-muted-foreground", bg: "bg-muted/30 border-border" };
};

const fmt = (n: number | null | undefined, prefix = "$", digits = 2) =>
  n == null || !isFinite(n) ? "—" : `${prefix}${n.toFixed(digits)}`;

export const AnalysisResultCard = ({ result, loading, onSetAlert }: Props) => {
  if (loading) {
    return (
      <Card className="glass-card p-5 space-y-3">
        <Skeleton className="h-8 w-32" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
        <Skeleton className="h-16 w-full" />
      </Card>
    );
  }
  if (!result) return null;

  const { Icon, color, bg } = decisionStyle(result.decision);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="glass-card p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border", bg)}>
              <Icon className={cn("w-4 h-4", color)} />
              <span className={cn("font-mono text-sm font-semibold", color)}>{result.decision}</span>
            </div>
            <div>
              <div className="font-mono text-lg font-medium">{result.ticker}</div>
              {result.currentPrice != null && (
                <div className="text-xs text-muted-foreground font-mono">
                  {fmt(result.currentPrice)} current
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AddToWatchlistButton ticker={result.ticker} size="sm" className="border border-border/50" />
            {onSetAlert && (
              <Button variant="outline" size="sm" onClick={onSetAlert}>
                Set alert
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to={`/stock/${encodeURIComponent(result.ticker)}`} className="gap-1.5">
                <ExternalLink className="w-3.5 h-3.5" /> Full page
              </Link>
            </Button>
          </div>
        </div>

        {result.insufficientData ? (
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/20 p-3 rounded-md">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{result.reasoning ?? "Insufficient data to run a full analysis."}</span>
          </div>
        ) : (
          <>
            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Confidence" icon={Brain}
                value={`${Math.round(result.confidence)}%`}
                color={result.confidence >= 70 ? "text-success" : result.confidence >= 50 ? "text-foreground" : "text-muted-foreground"} />
              <Stat label="Entry" icon={DollarSign}
                value={fmt(result.suggestedEntry ?? result.currentPrice)} />
              <Stat label="Stop" icon={Shield}
                value={fmt(result.suggestedStop)} color="text-destructive/80" />
              <Stat label="Target" icon={Target}
                value={fmt(result.suggestedTarget)} color="text-success/80" />
            </div>

            {/* Context tags */}
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {result.strategy && result.strategy !== "none" && (
                <Badge variant="outline" className="capitalize">{result.strategy.replace(/_/g, " ")}</Badge>
              )}
              {result.regime && (
                <Badge variant="outline" className="capitalize">{result.regime.replace(/_/g, " ")} regime</Badge>
              )}
              {result.profile && (
                <Badge variant="outline" className="capitalize">{result.profile} profile</Badge>
              )}
              {result.weeklyBias && (
                <Badge variant="outline" className="capitalize">Weekly: {result.weeklyBias}</Badge>
              )}
            </div>

            {/* Reasoning */}
            {result.reasoning && (
              <p className="text-xs text-muted-foreground leading-relaxed pt-2 border-t border-border/40">
                {result.reasoning}
              </p>
            )}
          </>
        )}
      </Card>
    </motion.div>
  );
};

const Stat = ({
  label, value, icon: Icon, color = "text-foreground",
}: { label: string; value: string; icon: React.ElementType; color?: string }) => (
  <div className="bg-muted/20 rounded-md p-2.5">
    <div className="text-[9px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-1">
      <Icon className="w-2.5 h-2.5" /> {label}
    </div>
    <div className={cn("font-mono text-sm font-medium", color)}>{value}</div>
  </div>
);
