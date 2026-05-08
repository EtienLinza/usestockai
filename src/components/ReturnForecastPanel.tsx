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

const HORIZONS: { key: Horizon; label: string }[] = [
  { key: "daily", label: "1 Day" },
  { key: "weekly", label: "1 Week" },
  { key: "monthly", label: "1 Month" },
  { key: "quarterly", label: "1 Quarter" },
  { key: "yearly", label: "1 Year" },
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
    <Card className="glass-card p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <Telescope className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-medium tracking-wide uppercase">Return Forecasts</h3>
      </div>

      <div className="flex gap-2 mb-5">
        <Input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          placeholder="Ticker (AAPL, BTC-USD)"
          className="font-mono text-sm"
          maxLength={15}
        />
        <Button onClick={runForecast} disabled={loading} size="sm" className="gap-1.5">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Forecast
        </Button>
      </div>

      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {HORIZONS.map((h) => <Skeleton key={h.key} className="h-24" />)}
        </div>
      )}

      {!loading && !forecast && (
        <div className="text-xs text-muted-foreground py-8 text-center">
          Enter a ticker to project expected returns across 1d, 1w, 1m, 1q, and 1y horizons.
        </div>
      )}

      {!loading && forecast && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-3 text-[11px] text-muted-foreground">
            <span className="font-mono text-foreground">{forecast.ticker}</span>
            <span>${forecast.asOfPrice.toFixed(2)}</span>
            <span>μ ann: <span className={cn("font-mono", forecast.driftAnnualPct >= 0 ? "text-primary" : "text-destructive")}>{forecast.driftAnnualPct >= 0 ? "+" : ""}{forecast.driftAnnualPct.toFixed(2)}%</span></span>
            <span>σ ann: <span className="font-mono text-foreground">{forecast.daily.annualizedVolPct.toFixed(1)}%</span></span>
            <span>n={forecast.sampleSize}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {HORIZONS.map(({ key, label }) => {
              const f = forecast[key];
              const positive = f.expectedPct >= 0;
              return (
                <Card key={key} className="p-3 bg-secondary/20 border-border/40">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">
                    {label}
                  </div>
                  <div className={cn(
                    "text-lg font-mono font-medium flex items-center gap-1",
                    positive ? "text-primary" : "text-destructive"
                  )}>
                    {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                    {positive ? "+" : ""}{f.expectedPct.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1.5 font-mono">
                    1σ: {f.lowPct.toFixed(1)}% / +{f.highPct.toFixed(1)}%
                  </div>
                </Card>
              );
            })}
          </div>

          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            Drift + volatility (GBM) projection from 120 daily log returns. Expected return is the mean
            path; the 1σ band shows ~68% of likely outcomes. Not investment advice.
          </p>
        </motion.div>
      )}
    </Card>
  );
};
