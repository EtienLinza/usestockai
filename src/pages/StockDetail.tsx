import { SEO } from "@/components/SEO";
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/Navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricCard } from "@/components/MetricCard";
import { StockChart, type Candle } from "@/components/StockChart";
import { AddToWatchlistButton } from "@/components/AddToWatchlistButton";
import { PriceAlertModal } from "@/components/PriceAlertModal";
import {
  ArrowLeft, Bell, TrendingUp, TrendingDown, DollarSign, BarChart3,
  Activity, Building2, Newspaper, ExternalLink, Brain,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { UpgradeRequiredModal } from "@/components/UpgradeRequiredModal";
import { cn } from "@/lib/utils";

const RANGES = ["1D", "5D", "1M", "6M", "1Y", "5Y"] as const;
type Range = typeof RANGES[number];

interface ChartResponse {
  ticker: string;
  range: Range;
  candles: Candle[];
  name?: string | null;
  quote?: {
    price: number;
    previousClose: number | null;
    changePct: number | null;
    marketState: string | null;
    source: string;
  } | null;
  fundamentals?: {
    peRatio: number | null;
    marketCap: number | null;
    beta: number | null;
    week52High: number | null;
    week52Low: number | null;
    dividendYield: number | null;
    industry: string | null;
    exchange: string | null;
  } | null;
  news?: { title: string; source: string; url: string; publishedAt: string }[];
}

interface LatestSignal {
  signal_type: string;
  entry_price: number;
  confidence: number;
  regime: string;
  strategy: string;
  reasoning: string;
  created_at: string;
}

const formatMarketCap = (v: number | null): string => {
  if (v == null) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toFixed(0)}`;
};

const StockDetail = () => {
  const { ticker: rawTicker } = useParams<{ ticker: string }>();
  const ticker = (rawTicker ?? "").toUpperCase();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { canUse } = useTier();

  const [range, setRange] = useState<Range>("1M");
  const [overview, setOverview] = useState<ChartResponse | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingCandles, setLoadingCandles] = useState(true);
  const [alertOpen, setAlertOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [signal, setSignal] = useState<LatestSignal | null>(null);

  const invalidTicker = !ticker || !/^[A-Z]{1,10}(-[A-Z]{2,4})?$/.test(ticker);

  // Initial load: candles for default range + overview together
  useEffect(() => {
    if (invalidTicker) return;
    let cancelled = false;
    setLoadingOverview(true);
    setLoadingCandles(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke<ChartResponse>("fetch-stock-chart", {
          body: { ticker, range, overview: true },
        });
        if (cancelled) return;
        if (error) throw error;
        setOverview(data ?? null);
        setCandles(data?.candles ?? []);
      } catch (e) {
        console.error("fetch-stock-chart failed", e);
        if (!cancelled) toast.error("Failed to load stock data");
      } finally {
        if (!cancelled) { setLoadingOverview(false); setLoadingCandles(false); }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  // Subsequent range changes: only refetch candles
  useEffect(() => {
    if (invalidTicker || !overview) return;
    let cancelled = false;
    setLoadingCandles(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke<ChartResponse>("fetch-stock-chart", {
          body: { ticker, range, overview: false },
        });
        if (cancelled) return;
        if (error) throw error;
        setCandles(data?.candles ?? []);
      } catch (e) {
        console.error("range refetch failed", e);
      } finally {
        if (!cancelled) setLoadingCandles(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // Latest AI signal (if any)
  useEffect(() => {
    if (invalidTicker) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("live_signals")
        .select("signal_type, entry_price, confidence, regime, strategy, reasoning, created_at")
        .eq("ticker", ticker)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setSignal((data as LatestSignal | null) ?? null);
    })();
    return () => { cancelled = true; };
  }, [ticker, invalidTicker]);

  const quote = overview?.quote ?? null;
  const fundamentals = overview?.fundamentals ?? null;
  const news = overview?.news ?? [];
  const name = overview?.name ?? null;

  const priceChange = useMemo(() => {
    if (!quote || quote.previousClose == null) return null;
    return quote.price - quote.previousClose;
  }, [quote]);
  const priceUp = (priceChange ?? 0) >= 0;

  const handleCreateAlert = async (targetPrice: number, direction: "above" | "below") => {
    if (!user) { toast.error("Please sign in"); return; }
    if (!canUse("price_alerts")) { setUpgradeOpen(true); return; }
    const { error } = await supabase.from("price_alerts").insert({
      user_id: user.id, ticker, target_price: targetPrice, direction,
    });
    if (error) { toast.error("Failed to create alert"); throw error; }
    toast.success(`Alert set for ${ticker} ${direction} $${targetPrice.toFixed(2)}`);
  };

  if (invalidTicker) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-24 px-6 container mx-auto max-w-2xl text-center">
          <h1 className="text-xl font-medium mb-2">Invalid ticker</h1>
          <p className="text-sm text-muted-foreground mb-4">"{rawTicker}" is not a valid ticker symbol.</p>
          <Button onClick={() => navigate("/dashboard")}>Back to Dashboard</Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title={`${ticker}${name ? ` · ${name}` : ""} — Stock Analysis | StockAI`}
        description={`Interactive price chart, key stats, AI signal, and latest news for ${ticker}${name ? ` (${name})` : ""}. Free real-time market data.`}
        path={`/stock/${ticker}`}
      />
      <Navbar />

      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/2 rounded-full blur-[150px]" />
      </div>

      <main className="pt-20 pb-12 px-4 sm:px-6 relative z-10">
        <div className="container mx-auto max-w-5xl">
          {/* Back */}
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>

          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-mono text-3xl sm:text-4xl font-medium text-primary tracking-tight">{ticker}</h1>
                {fundamentals?.exchange && (
                  <Badge variant="outline" className="text-[10px] font-mono">{fundamentals.exchange}</Badge>
                )}
                {quote?.marketState && quote.marketState !== "REGULAR" && (
                  <Badge variant="outline" className="text-[10px]">{quote.marketState}</Badge>
                )}
              </div>
              {loadingOverview ? (
                <Skeleton className="h-4 w-48 mt-2" />
              ) : (
                <p className="text-sm text-muted-foreground mt-1 truncate">
                  {name ?? "—"}{fundamentals?.industry ? ` · ${fundamentals.industry}` : ""}
                </p>
              )}

              {/* Price */}
              {loadingOverview ? (
                <Skeleton className="h-10 w-40 mt-3" />
              ) : quote ? (
                <div className="flex items-baseline gap-3 mt-3">
                  <span className="font-mono text-3xl font-medium">${quote.price.toFixed(2)}</span>
                  {priceChange != null && (
                    <span className={cn("font-mono text-sm flex items-center gap-1", priceUp ? "text-success" : "text-destructive")}>
                      {priceUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {priceUp ? "+" : ""}{priceChange.toFixed(2)} ({priceUp ? "+" : ""}{(quote.changePct ?? 0).toFixed(2)}%)
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-3">Price unavailable</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <AddToWatchlistButton ticker={ticker} size="default" className="border border-border/50" />
              <Button variant="outline" size="sm" onClick={() => setAlertOpen(true)} className="gap-1.5">
                <Bell className="w-3.5 h-3.5" /> Alert
              </Button>
            </div>
          </motion.div>

          {/* Range selector */}
          <div className="flex items-center gap-1 mb-3 overflow-x-auto">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  "px-3 py-1.5 text-xs font-mono rounded-md transition-colors",
                  range === r
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent",
                )}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Chart */}
          <Card className="glass-card p-4 mb-6">
            <StockChart candles={candles} loading={loadingCandles} range={range} />
          </Card>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <MetricCard icon={BarChart3} label="P/E Ratio"
              value={fundamentals?.peRatio != null ? fundamentals.peRatio.toFixed(2) : "—"} />
            <MetricCard icon={DollarSign} label="Market Cap"
              value={formatMarketCap(fundamentals?.marketCap ?? null)} />
            <MetricCard icon={Activity} label="Beta"
              value={fundamentals?.beta != null ? fundamentals.beta.toFixed(2) : "—"} />
            <MetricCard icon={TrendingUp} label="52W High"
              value={fundamentals?.week52High != null ? `$${fundamentals.week52High.toFixed(2)}` : "—"} />
            <MetricCard icon={TrendingDown} label="52W Low"
              value={fundamentals?.week52Low != null ? `$${fundamentals.week52Low.toFixed(2)}` : "—"} />
            <MetricCard icon={Building2} label="Div Yield"
              value={fundamentals?.dividendYield != null ? `${fundamentals.dividendYield.toFixed(2)}%` : "—"} />
          </div>

          {/* Signal + News */}
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="glass-card p-4 md:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Latest AI Signal</span>
              </div>
              {signal ? (
                <div className="space-y-2">
                  <Badge
                    className={cn(
                      "text-xs",
                      signal.signal_type === "BUY"
                        ? "bg-success/20 text-success border-success/30"
                        : "bg-destructive/20 text-destructive border-destructive/30",
                    )}
                  >
                    {signal.signal_type} · {signal.confidence}%
                  </Badge>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>Entry <span className="font-mono text-foreground">${Number(signal.entry_price).toFixed(2)}</span></div>
                    <div>Strategy <span className="text-foreground capitalize">{(signal.strategy || "").replace(/_/g, " ")}</span></div>
                    <div>Regime <span className="text-foreground capitalize">{(signal.regime || "").replace(/_/g, " ")}</span></div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug pt-2 border-t border-border/40">
                    {signal.reasoning}
                  </p>
                  <Link to="/dashboard" className="text-xs text-primary hover:underline inline-block pt-1">
                    View all signals →
                  </Link>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No active signal for {ticker}. The scanner runs every 5–15 minutes during market hours.
                </p>
              )}
            </Card>

            <Card className="glass-card p-4 md:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <Newspaper className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">Recent News</span>
              </div>
              {loadingOverview ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
                </div>
              ) : news.length === 0 ? (
                <p className="text-xs text-muted-foreground">No recent news for {ticker}.</p>
              ) : (
                <ul className="space-y-2">
                  {news.slice(0, 8).map((n, i) => (
                    <li key={i}>
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-start gap-2 text-xs hover:text-primary transition-colors"
                      >
                        <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-50 group-hover:opacity-100" />
                        <span className="flex-1 leading-snug">
                          <span className="text-foreground/90">{n.title}</span>
                          <span className="text-muted-foreground/70 ml-1.5">
                            · {n.source} · {new Date(n.publishedAt).toLocaleDateString()}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </main>

      <PriceAlertModal
        isOpen={alertOpen}
        onClose={() => setAlertOpen(false)}
        onSubmit={handleCreateAlert}
        ticker={ticker}
        currentPrice={quote?.price}
      />
      <UpgradeRequiredModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        feature="Price Alerts"
        requiredTier="pro"
      />
    </div>
  );
};

export default StockDetail;
