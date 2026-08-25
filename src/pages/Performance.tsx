import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/MetricCard";
import { supabase } from "@/integrations/supabase/client";
import { Activity, ShieldCheck, Gauge, Scale, ArrowRight } from "lucide-react";

const PATH = "/performance";

interface LiveSignalRow {
  ticker: string;
  signal_type: string;
  entry_price: number;
  confidence: number;
  regime: string;
  strategy: string;
  reasoning: string | null;
  created_at: string;
  expires_at: string;
}

interface LiveStats {
  active: number;
  buys: number;
  sells: number;
  avgConfidence: number;
  regimes: Record<string, number>;
}

const Performance = () => {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [recent, setRecent] = useState<LiveSignalRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("live_signals")
        .select("ticker,signal_type,entry_price,confidence,regime,strategy,reasoning,created_at,expires_at")
        .gt("expires_at", new Date().toISOString())
        .order("confidence", { ascending: false });
      if (cancelled || !data) return;
      const rows = data as LiveSignalRow[];
      const regimes: Record<string, number> = {};
      for (const r of rows) regimes[r.regime] = (regimes[r.regime] ?? 0) + 1;
      setStats({
        active: rows.length,
        buys: rows.filter((r) => r.signal_type === "BUY").length,
        sells: rows.filter((r) => r.signal_type === "SELL").length,
        avgConfidence: rows.length
          ? Math.round(rows.reduce((s, r) => s + r.confidence, 0) / rows.length)
          : 0,
        regimes,
      });
      setRecent(rows.slice(0, 12));
    })();
    return () => { cancelled = true; };
  }, []);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "StockAI Track Record & Methodology",
    description:
      "How StockAI measures itself: the methodology, the public metrics, and the live signal feed.",
    author: { "@type": "Organization", name: "StockAI" },
    publisher: { "@type": "Organization", name: "StockAI" },
    datePublished: "2026-08-23",
    dateModified: "2026-08-23",
    mainEntityOfPage: `https://usestockai.lovable.app${PATH}`,
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title="StockAI Track Record: Live Signals & Methodology"
        description="StockAI's public performance page — how we measure the engine, what we publish, and the live signal feed with conviction scores and regimes."
        path={PATH}
        type="article"
        jsonLd={jsonLd}
      />
      <Navbar />

      <main className="flex-1 container mx-auto px-4 sm:px-6 pt-20 md:pt-24 pb-16 max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-12"
        >
          <header className="space-y-4 max-w-2xl">
            <div className="text-xs uppercase tracking-widest text-primary/80">Track record</div>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight">
              Performance, on the record
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              A signal engine should be judged on data it publishes itself. This page shows the
              methodology we hold ourselves to and the live state of the feed — no screenshots, no
              cherry-picked winners.
            </p>
          </header>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">What we measure ourselves on</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                {
                  icon: Scale,
                  title: "Calibration",
                  body: "Whether an 80-conviction signal really resolves better than a 65. Conviction bands are re-fit nightly against realized outcomes.",
                },
                {
                  icon: ShieldCheck,
                  title: "Drawdown control",
                  body: "Hard stop distances, correlation gates, and sector caps bound the worst case before any position opens.",
                },
                {
                  icon: Gauge,
                  title: "Risk-adjusted return",
                  body: "Sharpe, Sortino, and Calmar on simulated and paper results — never raw return in isolation.",
                },
                {
                  icon: Activity,
                  title: "Payoff ratio",
                  body: "Average winner versus average loser. A modest win rate with a healthy payoff ratio beats a high hit rate with a bad tail.",
                },
              ].map(({ icon: Icon, title, body }) => (
                <Card key={title} className="glass-card p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">{title}</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                </Card>
              ))}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every fired signal is written to the feed at the moment it fires, with entry, conviction,
              regime, and reasoning — and it cannot be edited afterwards. That is what makes the record
              verifiable rather than decorative.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Live signal feed, right now</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="Active signals" value={stats ? String(stats.active) : "—"} />
              <MetricCard label="BUY" value={stats ? String(stats.buys) : "—"} />
              <MetricCard label="SELL" value={stats ? String(stats.sells) : "—"} />
              <MetricCard label="Avg conviction" value={stats ? String(stats.avgConfidence) : "—"} />
            </div>

            {stats && Object.keys(stats.regimes).length > 0 && (
              <p className="text-xs text-muted-foreground">
                Current regime mix:{" "}
                {Object.entries(stats.regimes)
                  .map(([k, v]) => `${k} (${v})`)
                  .join(", ")}
              </p>
            )}

            <div className="space-y-2">
              {recent.map((s) => (
                <Card key={`${s.ticker}-${s.created_at}`} className="glass-card p-4 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <Link
                    to={`/stocks/${encodeURIComponent(s.ticker)}/ai-forecast`}
                    className="font-mono text-sm font-medium text-primary hover:underline"
                  >
                    {s.ticker}
                  </Link>
                  <span className={`text-xs font-medium ${s.signal_type === "BUY" ? "text-emerald-500" : "text-rose-500"}`}>
                    {s.signal_type}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    entry ${s.entry_price?.toFixed(2)} · conviction {s.confidence}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.regime} · {s.strategy}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(s.created_at).toLocaleDateString()}
                  </span>
                </Card>
              ))}
              {!stats && <p className="text-sm text-muted-foreground">Loading live feed…</p>}
              {stats && stats.active === 0 && (
                <p className="text-sm text-muted-foreground">
                  No active signals at this moment — the scanner refreshes throughout the trading day.
                </p>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">The caveats that come with it</h2>
            <p className="text-muted-foreground leading-relaxed">
              Live signals are forward-looking research, not realized profit. Our paper-trading book
              applies its own entry gates, sizing, and exit rules, so its results will differ from a
              naive read of the feed. Backtests — including ours — are simulations, and simulations
              flatter the future. The{" "}
              <Link to="/disclosure" className="text-primary hover:underline">risk disclosure</Link>{" "}
              covers this in full, and we mean it: past performance does not predict future results.
            </p>
          </section>

          <Card className="glass-card p-6 space-y-3">
            <div className="text-sm font-medium">Verify it yourself</div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Run the strategy against your own parameters, or browse the dashboard feed directly.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to="/backtest">Run a backtest <ArrowRight className="w-3.5 h-3.5 ml-1" /></Link>
              </Button>
              <Button asChild size="sm" variant="outline"><Link to="/dashboard">Dashboard</Link></Button>
              <Button asChild size="sm" variant="outline"><Link to="/ai-stock-trading">How it works</Link></Button>
            </div>
          </Card>
        </motion.div>
      </main>

      <Footer />
    </div>
  );
};

export default Performance;
