import { useState } from "react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Telescope, TrendingUp, TrendingDown, Search, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Horizon = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

interface ForecastEntry {
  expectedPct: number;
  medianPct?: number;
  lowPct: number;
  highPct: number;
  probUpPct?: number;
  annualizedVolPct: number;
}

interface Forecast {
  ticker: string;
  asOfPrice: number;
  driftAnnualPct: number;
  sampleSize: number;
  daily: ForecastEntry;
  weekly: ForecastEntry;
  monthly: ForecastEntry;
  quarterly: ForecastEntry;
  yearly: ForecastEntry;
}

const HORIZONS: { key: Horizon; label: string; short: string }[] = [
  { key: "daily", label: "1 Day", short: "1D" },
  { key: "weekly", label: "1 Week", short: "1W" },
  { key: "monthly", label: "1 Month", short: "1M" },
  { key: "quarterly", label: "1 Quarter", short: "1Q" },
  { key: "yearly", label: "1 Year", short: "1Y" },
];

const TICKER_RE = /^[A-Z]{1,10}(-[A-Z]{2,4})?$/;

interface Props {
  initialTicker?: string;
}

export const ReturnForecastPanel = ({ initialTicker = "" }: Props) => {
  const [ticker, setTicker] = useState(initialTicker);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(false);

  const runForecast = async () => {
    const t = ticker.trim().toUpperCase();
    if (!TICKER_RE.test(t)) {
      toast.error("Enter a valid ticker (e.g. AAPL, BTC-USD)");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("forecast-returns", {
        body: { ticker: t },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setForecast(data as Forecast);
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate forecast");
      setForecast(null);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") runForecast();
  };

  return (
    <Card className="glass-card p-3 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 sm:mb-4">
        <Telescope className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary shrink-0" />
        <h3 className="text-xs sm:text-sm font-medium tracking-wide uppercase">Return Forecasts</h3>
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-4 sm:mb-5">
        <Input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          placeholder="AAPL, BTC-USD"
          className="font-mono text-sm h-9"
          maxLength={15}
        />
        <Button onClick={runForecast} disabled={loading} size="sm" className="gap-1.5 h-9 shrink-0">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">Forecast</span>
        </Button>
      </div>

      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {HORIZONS.map((h) => <Skeleton key={h.key} className="h-[88px]" />)}
        </div>
      )}

      {!loading && !forecast && (
        <div className="text-[11px] sm:text-xs text-muted-foreground py-8 text-center px-4 leading-relaxed">
          Enter a ticker to project expected returns across 1D, 1W, 1M, 1Q, and 1Y horizons.
        </div>
      )}

      {!loading && forecast && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Summary header — matches MetricCard aesthetic */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            <SummaryStat label="Ticker" value={forecast.ticker} mono />
            <SummaryStat label="Price" value={`$${forecast.asOfPrice.toFixed(2)}`} mono />
            <SummaryStat
              label="μ Annual"
              value={`${forecast.driftAnnualPct >= 0 ? "+" : ""}${forecast.driftAnnualPct.toFixed(1)}%`}
              mono
              color={forecast.driftAnnualPct >= 0 ? "text-primary" : "text-destructive"}
            />
            <SummaryStat
              label="σ Annual"
              value={`${forecast.daily.annualizedVolPct.toFixed(1)}%`}
              mono
              subtext={`n=${forecast.sampleSize}`}
            />
          </div>

          {/* Horizon grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {HORIZONS.map(({ key, label, short }) => {
              const f = forecast[key];
              const positive = f.expectedPct >= 0;
              return (
                <Card key={key} className="glass-card p-2.5 sm:p-3 min-w-0">
                  <div className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wide mb-1 flex items-center justify-between">
                    <span className="truncate">{label}</span>
                    <span className="font-mono opacity-60 sm:hidden">{short}</span>
                  </div>
                  <div className={cn(
                    "text-base sm:text-lg font-mono font-medium flex items-center gap-1 truncate",
                    positive ? "text-primary" : "text-destructive"
                  )}>
                    {positive
                      ? <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                      : <TrendingDown className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />}
                    <span className="truncate">{positive ? "+" : ""}{f.expectedPct.toFixed(2)}%</span>
                  </div>
                  {f.probUpPct != null && (
                    <div className="text-[9px] sm:text-[10px] text-muted-foreground mt-1 font-mono truncate">
                      P(up): <span className={cn(f.probUpPct >= 50 ? "text-primary" : "text-destructive")}>
                        {f.probUpPct.toFixed(0)}%
                      </span>
                    </div>
                  )}
                  <div className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5 font-mono truncate">
                    1σ: {f.lowPct.toFixed(1)}% / +{f.highPct.toFixed(1)}%
                  </div>
                </Card>
              );
            })}
          </div>

          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            GBM projection — blended-window drift (60d/252d, Bayesian-shrunk) with EWMA volatility (λ=0.94).
            P(up) is the model probability of a positive return; the 1σ band covers ~68% of outcomes. Not investment advice.
          </p>
        </motion.div>
      )}
    </Card>
  );
};

const SummaryStat = ({
  label, value, mono, color, subtext,
}: { label: string; value: string; mono?: boolean; color?: string; subtext?: string }) => (
  <Card className="glass-card p-2.5 min-w-0">
    <div className="text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wide mb-1 truncate">
      {label}
    </div>
    <div className={cn("text-sm sm:text-base font-medium truncate", mono && "font-mono", color)}>
      {value}
    </div>
    {subtext && (
      <div className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5 truncate font-mono">{subtext}</div>
    )}
  </Card>
);
