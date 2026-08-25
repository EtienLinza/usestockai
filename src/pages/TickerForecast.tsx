import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useParams, Link, Navigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { SEO_TICKERS, SEO_TICKER_MAP } from "@/data/seo-tickers";
import { Brain, ArrowRight, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface ActiveSignal {
  signal_type: string;
  entry_price: number;
  confidence: number;
  regime: string;
  strategy: string;
  reasoning: string | null;
  explanation: string | null;
  created_at: string;
  expires_at: string;
}

interface Quote {
  price: number | null;
  changePct: number | null;
}

const TickerForecast = () => {
  const { ticker: rawTicker } = useParams<{ ticker: string }>();
  const ticker = (rawTicker ?? "").toUpperCase();
  const meta = SEO_TICKER_MAP[ticker];

  const [signal, setSignal] = useState<ActiveSignal | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ticker || !meta) return;
    let cancelled = false;
    (async () => {
      const [{ data: sig }, priceRes] = await Promise.all([
        supabase
          .from("live_signals")
          .select("signal_type,entry_price,confidence,regime,strategy,reasoning,explanation,created_at,expires_at")
          .eq("ticker", ticker)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle(),
        supabase.functions.invoke("fetch-stock-price", { body: { ticker } }).catch(() => null),
      ]);
      if (cancelled) return;
      setSignal((sig as ActiveSignal | null) ?? null);
      const p = priceRes?.data;
      if (p && typeof p.price === "number") {
        setQuote({ price: p.price, changePct: typeof p.changePct === "number" ? p.changePct : null });
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [ticker, meta]);

  const related = useMemo(
    () => SEO_TICKERS.filter((t) => t.sector === meta?.sector && t.symbol !== ticker).slice(0, 6),
    [ticker, meta],
  );

  if (!ticker || !meta) return <Navigate to="/stocks" replace />;

  const basePath = `/stocks/${encodeURIComponent(ticker)}/ai-forecast`;
  const stance = signal ? signal.signal_type : "NO ACTIVE SIGNAL";
  const headline = `${meta.name} (${ticker}) AI Forecast`;
  const desc = signal
    ? `${headline}: StockAI's engine currently rates ${ticker} ${signal.signal_type} with ${signal.confidence} conviction in a ${signal.regime} regime. Live quote, rationale, and methodology.`
    : `${headline}: no active StockAI signal on ${ticker} right now — see the live quote, the latest analysis stance, and how the AI engine rates this stock when a setup qualifies.`;

  const jsonLd: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline,
      description: desc,
      author: { "@type": "Organization", name: "StockAI" },
      publisher: { "@type": "Organization", name: "StockAI" },
      dateModified: new Date().toISOString().slice(0, 10),
      mainEntityOfPage: `https://usestockai.lovable.app${basePath}`,
      about: {
        "@type": "FinancialProduct",
        tickerSymbol: ticker,
        name: meta.name,
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://usestockai.lovable.app/" },
        { "@type": "ListItem", position: 2, name: "Stocks", item: "https://usestockai.lovable.app/stocks" },
        { "@type": "ListItem", position: 3, name: headline, item: `https://usestockai.lovable.app${basePath}` },
      ],
    },
  ];

  const stanceColor =
    stance === "BUY" ? "text-emerald-500" : stance === "SELL" ? "text-rose-500" : "text-muted-foreground";
  const StanceIcon = stance === "BUY" ? TrendingUp : stance === "SELL" ? TrendingDown : Minus;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title={`${ticker} AI Forecast & Signal — ${meta.name}`}
        description={desc}
        path={basePath}
        type="article"
        jsonLd={jsonLd}
      />
      <Navbar />

      <main className="flex-1 container mx-auto px-4 sm:px-6 pt-20 md:pt-24 pb-16 max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-10"
        >
          <header className="space-y-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary/80">
              <Brain className="w-3.5 h-3.5" /> AI forecast · {meta.sector}
            </div>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight">
              {ticker} AI Forecast
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              StockAI's engine scores {meta.name} daily on trend, momentum, volatility regime, volume,
              and relative strength. Below is the current stance and the data behind it.
            </p>
          </header>

          <Card className="glass-card p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <StanceIcon className={`w-5 h-5 ${stanceColor}`} />
              <span className={`text-2xl font-medium tracking-tight ${stanceColor}`}>{stance}</span>
              {signal && <Badge variant="outline">conviction {signal.confidence}</Badge>}
              {quote?.price != null && (
                <span className="ml-auto text-sm text-muted-foreground font-mono">
                  ${quote.price.toFixed(2)}
                  {quote.changePct != null && (
                    <span className={quote.changePct >= 0 ? "text-emerald-500" : "text-rose-500"}>
                      {" "}({quote.changePct >= 0 ? "+" : ""}{quote.changePct.toFixed(2)}%)
                    </span>
                  )}
                </span>
              )}
            </div>

            {signal ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Entry reference</div>
                    <div className="font-mono">${signal.entry_price?.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Regime</div>
                    <div>{signal.regime}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Strategy</div>
                    <div>{signal.strategy}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Fired</div>
                    <div>{new Date(signal.created_at).toLocaleDateString()}</div>
                  </div>
                </div>
                {(signal.explanation || signal.reasoning) && (
                  <p className="text-sm text-muted-foreground leading-relaxed border-t border-border/50 pt-3">
                    {signal.explanation || signal.reasoning}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {loaded
                  ? `No active signal on ${ticker} right now. The scanner only publishes a signal when the setup clears every gate — trend confirmation, volume, regime fit, and conviction floor. Absence of a signal is itself the honest answer.`
                  : "Checking the live signal feed…"}
              </p>
            )}
          </Card>

          <section className="space-y-3">
            <h2 className="text-2xl font-medium tracking-tight">How this forecast is produced</h2>
            <p className="text-muted-foreground leading-relaxed">
              Every ticker in the StockAI universe is scored by the same engine: a regime classifier
              establishes market context, technical and relative-strength features are computed over
              multiple windows, an ensemble produces a raw conviction, and that conviction is calibrated
              nightly against realized outcomes. Signals expire automatically — a forecast that has not
              resolved within its horizon is removed rather than allowed to linger.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Read the{" "}
              <Link to="/ai-stock-trading" className="text-primary hover:underline">full AI stock trading guide</Link>{" "}
              for the complete methodology, or{" "}
              <Link to={`/stock/${encodeURIComponent(ticker)}`} className="text-primary hover:underline">
                open the interactive {ticker} chart
              </Link>.
            </p>
          </section>

          {related.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-2xl font-medium tracking-tight">More {meta.sector} forecasts</h2>
              <div className="flex flex-wrap gap-2">
                {related.map((t) => (
                  <Button key={t.symbol} asChild variant="outline" size="sm">
                    <Link to={`/stocks/${encodeURIComponent(t.symbol)}/ai-forecast`}>
                      {t.symbol} <ArrowRight className="w-3 h-3 ml-1" />
                    </Link>
                  </Button>
                ))}
              </div>
            </section>
          )}

          <Card className="glass-card p-6 space-y-3">
            <div className="text-sm font-medium">Track {ticker} with a full account</div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Price alerts, watchlists, paper trading, and a backtester you can run on your own
              parameters.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm"><Link to="/auth">Create a free account</Link></Button>
              <Button asChild size="sm" variant="outline"><Link to="/stocks">All forecasts</Link></Button>
            </div>
          </Card>

          <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-6">
            StockAI publishes research and paper-trading tools. This forecast is informational, not
            financial advice. See our{" "}
            <Link to="/disclosure" className="text-primary hover:underline">risk disclosure</Link>.
          </p>
        </motion.div>
      </main>

      <Footer />
    </div>
  );
};

export default TickerForecast;
