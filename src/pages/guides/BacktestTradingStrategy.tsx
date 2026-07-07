import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, Layers, ShieldCheck, Sparkles, ArrowRight } from "lucide-react";

const PATH = "/guides/backtest-trading-strategy";

const faqs = [
  {
    q: "What is backtesting a trading strategy?",
    a: "Backtesting means running your entry and exit rules against historical price data to see how the strategy would have performed. Done right, it tells you whether an edge is real or the product of luck and cherry-picked trades.",
  },
  {
    q: "How many years of data do I need?",
    a: "For swing and position strategies, 10+ years is a reasonable minimum so the test covers multiple market regimes. StockAI supports up to 25 years of history on the Elite tier.",
  },
  {
    q: "What's the difference between a backtest and a walk-forward test?",
    a: "A single backtest is a one-shot look. Walk-forward re-fits the strategy on rolling in-sample windows and validates on the next out-of-sample window — it's a much stricter test of whether the edge holds up over time.",
  },
  {
    q: "Why do I need Monte Carlo simulation?",
    a: "Your realized return depends on the order trades happen. Monte Carlo shuffles the trade sequence thousands of times to show the full distribution of possible outcomes — including worst-case drawdowns you'd have lived through.",
  },
  {
    q: "What metrics actually matter?",
    a: "Sharpe (return per unit of volatility), Sortino (return per unit of downside), Calmar (return over max drawdown), and profit factor (gross wins ÷ gross losses). A CAGR without these is close to meaningless.",
  },
];

const BacktestTradingStrategy = () => {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "How to Backtest a Trading Strategy the Right Way",
      description:
        "An institutional-grade guide to backtesting stock strategies — Sharpe, Sortino, walk-forward validation, and Monte Carlo stress tests explained.",
      author: { "@type": "Organization", name: "StockAI" },
      publisher: { "@type": "Organization", name: "StockAI" },
      datePublished: "2026-07-07",
      dateModified: "2026-07-07",
      mainEntityOfPage: `https://usestockai.lovable.app${PATH}`,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title="How to Backtest a Trading Strategy — The Institutional Playbook"
        description="Backtest stock trading strategies with Sharpe, Sortino, walk-forward validation, and Monte Carlo simulation. Learn what separates a real edge from luck."
        path={PATH}
        type="article"
        jsonLd={jsonLd}
      />
      <Navbar />

      <main className="flex-1 container mx-auto px-4 sm:px-6 pt-20 md:pt-24 pb-16 max-w-3xl">
        <motion.article
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-10"
        >
          <header className="space-y-4">
            <div className="text-xs uppercase tracking-widest text-primary/80">Guide · Backtesting</div>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight">
              How to Backtest a Trading Strategy Without Fooling Yourself
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Anyone can find a strategy that made money in the past. The hard part is knowing whether
              that edge is real, whether it will survive live markets, and whether you can psychologically
              stomach the drawdowns. Here's the institutional-grade playbook.
            </p>
          </header>

          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { icon: BarChart3, label: "Sharpe & Sortino" },
              { icon: Layers, label: "Walk-forward" },
              { icon: ShieldCheck, label: "Monte Carlo stress" },
            ].map(({ icon: Icon, label }) => (
              <Card key={label} className="glass-card p-4 flex items-center gap-3">
                <Icon className="w-4 h-4 text-primary" />
                <span className="text-sm">{label}</span>
              </Card>
            ))}
          </div>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Step 1 — Define the rules unambiguously</h2>
            <p className="text-muted-foreground leading-relaxed">
              Every entry, exit, stop, and position-size decision must be codified. If you can't write
              the rule down as an if/then statement, you can't backtest it — you're just curve-fitting
              intuition. StockAI lets you configure conviction floor, style, stop distance, take-profit,
              and holding period as explicit parameters.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Step 2 — Run the base test, then read the right numbers</h2>
            <p className="text-muted-foreground leading-relaxed">
              CAGR alone lies. Look at Sharpe (risk-adjusted return), Sortino (downside-adjusted),
              Calmar (return over max drawdown), profit factor, and win rate together. A 40% CAGR
              with a 60% drawdown is unusable capital. A 15% CAGR with a Sharpe above 1.5 is
              institutional-grade.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Step 3 — Walk-forward, or don't ship it</h2>
            <p className="text-muted-foreground leading-relaxed">
              Overfit strategies look brilliant in-sample and collapse live. Walk-forward analysis
              rolls a training window forward through history and re-validates on the next unseen slice.
              If your metrics degrade sharply out-of-sample, the edge isn't real. StockAI runs
              walk-forward automatically on the Elite tier with a 60-day train / 5-day test rhythm.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Step 4 — Stress-test with Monte Carlo</h2>
            <p className="text-muted-foreground leading-relaxed">
              Realized returns depend heavily on the order trades happen. Monte Carlo simulation
              reshuffles your trade sequence thousands of times to show the full distribution of
              possible equity curves. You'll see the 5th-percentile drawdown you'd have needed to
              survive — that's the number to size around, not the mean.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Step 5 — Export everything, review it cold</h2>
            <p className="text-muted-foreground leading-relaxed">
              StockAI exports the full trade log as CSV, Excel, JSON, Markdown, or HTML. Read every
              losing trade in order. If you'd have panicked out during that 22% drawdown, the strategy
              isn't yours to trade — regardless of what the metrics say.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Frequently asked questions</h2>
            <div className="space-y-4">
              {faqs.map((f) => (
                <Card key={f.q} className="glass-card p-5">
                  <h3 className="font-medium mb-2">{f.q}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
                </Card>
              ))}
            </div>
          </section>

          <Card className="glass-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-primary mt-1" />
              <div>
                <div className="font-medium">Backtest your first strategy free</div>
                <div className="text-sm text-muted-foreground">3 backtests per month on the free tier.</div>
              </div>
            </div>
            <Button asChild>
              <Link to="/backtest">
                Open the backtester <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          </Card>

          <p className="text-xs text-muted-foreground">
            Educational content only. Past performance does not guarantee future results.
            See our <Link to="/disclosure" className="underline">disclosure</Link>.
          </p>
        </motion.article>
      </main>

      <Footer />
    </div>
  );
};

export default BacktestTradingStrategy;
