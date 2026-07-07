import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Gauge, Activity, Sparkles, ArrowRight } from "lucide-react";

const PATH = "/guides/ai-stock-signals-explained";

const faqs = [
  {
    q: "What is an AI stock signal?",
    a: "An AI stock signal is a buy or sell recommendation produced by a quantitative model that combines many inputs — price action, volume, indicators, regime, macro data — into a single conviction score. Unlike a tip from a guru, every signal is reproducible and explainable.",
  },
  {
    q: "How accurate are AI trading signals?",
    a: "No signal engine is 100% accurate. What matters is calibration: when StockAI publishes a 70% conviction signal, roughly 70% of similar historical setups worked. You can verify this yourself with the built-in backtester and calibration analytics.",
  },
  {
    q: "How is StockAI different from a Discord signal group?",
    a: "Discord groups sell picks. StockAI publishes the full reasoning behind each call — indicators used, market regime, weighted consensus — and lets you stress-test every strategy before risking capital. Nothing is hidden.",
  },
  {
    q: "Do AI signals work in bear markets?",
    a: "Yes, if the engine respects regime. StockAI detects bull, chop, and bear regimes and adjusts signal thresholds accordingly — so you get fewer, higher-conviction long signals in downtrends and more defensive setups.",
  },
  {
    q: "Can I trust AI over my own analysis?",
    a: "Treat AI signals as a research input, not gospel. The value is in scanning 6,000+ tickers you'd never look at manually and surfacing the ones worth your attention with transparent math.",
  },
];

const AiStockSignalsExplained = () => {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "AI Stock Signals Explained: How Conviction Scoring Actually Works",
      description:
        "A transparent look at how AI stock signals are generated, calibrated, and stress-tested — and how to tell a real signal engine from a Discord guru.",
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
        title="AI Stock Signals Explained — How Conviction Scoring Works"
        description="How AI stock signals are generated, calibrated, and stress-tested. Learn what separates a real signal engine from a Discord tip."
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
            <div className="text-xs uppercase tracking-widest text-primary/80">Guide · Signals</div>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight">
              AI Stock Signals Explained: What's Actually Under the Hood
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Every AI signal service promises alpha. Almost none show their math. Here's exactly
              how StockAI turns raw price data into a calibrated conviction score — and how you can
              verify the edge yourself.
            </p>
          </header>

          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { icon: Brain, label: "Ensemble scoring" },
              { icon: Gauge, label: "Calibrated conviction" },
              { icon: Activity, label: "Regime-aware" },
            ].map(({ icon: Icon, label }) => (
              <Card key={label} className="glass-card p-4 flex items-center gap-3">
                <Icon className="w-4 h-4 text-primary" />
                <span className="text-sm">{label}</span>
              </Card>
            ))}
          </div>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">The three layers behind every signal</h2>
            <p className="text-muted-foreground leading-relaxed">
              A StockAI signal isn't a single indicator crossing another. It's a weighted consensus
              across three layers: technical features (RSI, MACD, moving averages, ATR, volume
              divergence), market context (SPY regime, VIX level, sector momentum), and stock-specific
              overlays (relative strength, short-interest velocity, EPS revisions). Each layer votes.
              The final score is the calibrated probability that a similar historical setup produced
              a winning trade.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">What "conviction 78%" really means</h2>
            <p className="text-muted-foreground leading-relaxed">
              Conviction scores on StockAI are calibrated using isotonic regression against realized
              outcomes. In plain English: when the engine says 78%, historically ~78% of setups with
              that score hit their target before their stop. You can inspect the calibration curve
              yourself in the analytics view — no black box.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Regime detection is the difference</h2>
            <p className="text-muted-foreground leading-relaxed">
              The same setup that works in a low-vol bull market fails in a high-vol chop. StockAI
              classifies the market into regimes (trend-up, chop, trend-down, high-vol) using SPY,
              VIX, and cross-asset signals, then adjusts signal thresholds and position sizing per
              regime. This is why you see fewer signals on ugly days — and that's a feature, not a bug.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">How to actually use the signals</h2>
            <ol className="space-y-3 list-decimal list-inside text-muted-foreground leading-relaxed">
              <li><span className="text-foreground font-medium">Filter</span> by conviction floor (68+ is the standard threshold) and style (scalp, day, swing, position).</li>
              <li><span className="text-foreground font-medium">Read</span> the reasoning — never take a signal you can't explain in one sentence.</li>
              <li><span className="text-foreground font-medium">Paper trade</span> first via the built-in portfolio tracker to build confidence in the engine.</li>
              <li><span className="text-foreground font-medium">Backtest</span> your filter combination to confirm the edge is real, not a recent hot streak.</li>
            </ol>
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
                <div className="font-medium">See live AI signals with full reasoning</div>
                <div className="text-sm text-muted-foreground">Free to start. No card required.</div>
              </div>
            </div>
            <Button asChild>
              <Link to="/dashboard">
                Open the dashboard <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          </Card>

          <p className="text-xs text-muted-foreground">
            Educational content only. StockAI is a research and paper-trading platform and
            does not provide investment advice. See our <Link to="/disclosure" className="underline">disclosure</Link>.
          </p>
        </motion.article>
      </main>

      <Footer />
    </div>
  );
};

export default AiStockSignalsExplained;
