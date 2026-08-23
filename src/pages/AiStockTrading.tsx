import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  Brain, ShieldCheck, LineChart, Sparkles, ArrowRight, Layers,
  Gauge, Clock, ScanSearch,
} from "lucide-react";

const PATH = "/ai-stock-trading";

const faqs = [
  {
    q: "What is AI stock trading?",
    a: "AI stock trading is the use of statistical and machine-learning models to decide what to trade, how large a position to take, and when to exit. Instead of a human reading charts, a model scores every candidate in a universe on the same features — trend, momentum, volatility, volume, relative strength, market regime — and produces a ranked list with a calibrated probability attached to each.",
  },
  {
    q: "Does AI stock trading actually work?",
    a: "It works when the model has a measurable edge that survives trading costs, and when risk is capped so a single bad trade can't erase a month. It fails when a model is overfitted to history, when position sizes scale off a mis-calibrated confidence score, or when stops are so wide that one overnight gap wipes out weeks of gains. The only honest test is out-of-sample performance and a complete trade log that includes the losers.",
  },
  {
    q: "Is AI stock trading legal?",
    a: "Yes. Algorithmic and model-driven trading is legal for retail investors in most markets and is how the majority of institutional volume is already executed. What is regulated is investment advice: a platform that publishes signals as research and education is different from a registered adviser managing your money.",
  },
  {
    q: "Can AI predict the stock market?",
    a: "Not in the sense of knowing tomorrow's price. What a well-built model can do is estimate a probability distribution — that a given setup has, say, a 58% chance of hitting its target before its stop. Small, repeatable probability edges compounded over many trades is what the entire quantitative industry is built on.",
  },
  {
    q: "How much money do I need for AI stock trading?",
    a: "Enough that commissions, spread, and slippage are a small fraction of your expected move, and enough to hold several uncorrelated positions rather than betting the account on one name. Below a few thousand dollars, per-trade costs and share-rounding tend to consume most of a short-horizon strategy's edge.",
  },
  {
    q: "What is the best AI stock trading platform?",
    a: "The right platform depends on your capital, timeframe, and appetite for risk — but the evaluation criteria are universal: published methodology, calibrated conviction scores you can verify against realized outcomes, hard risk controls, a full public trade log including losses, and a backtester you can run yourself on your own parameters.",
  },
  {
    q: "Is AI stock trading risky?",
    a: "Yes. Automation removes emotion, not risk. A model can be wrong for long stretches, market regimes shift faster than models retrain, and leverage amplifies both directions. Paper trade any system first, size positions so that a full stop-out is survivable, and never deploy capital you can't afford to lose.",
  },
];

const stages = [
  {
    icon: ScanSearch,
    title: "1. Scan",
    body: "Every candidate in the universe is pulled on a schedule and reduced to the same feature set — trend structure, momentum, volatility regime, volume confirmation, relative strength versus the index, and sector context. No ticker gets special treatment.",
  },
  {
    icon: Gauge,
    title: "2. Score",
    body: "Features collapse into a single conviction number. A good engine calibrates that number against realized outcomes, so an 80 genuinely wins more often than a 65. Uncalibrated confidence is the most common reason AI trading systems lose money.",
  },
  {
    icon: Layers,
    title: "3. Size",
    body: "Position size comes from conviction, current volatility, and account risk limits — not from how exciting the chart looks. Volatility targeting keeps risk-per-trade roughly constant whether the market is calm or violent.",
  },
  {
    icon: Clock,
    title: "4. Exit",
    body: "Stops, targets, trailing logic, and a time stop for trades that go nowhere. Exit design decides your payoff ratio, and payoff ratio decides whether a 55% win rate is profitable or a slow bleed.",
  },
];

const AiStockTrading = () => {
  const [activeSignals, setActiveSignals] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("live_signals")
        .select("*", { count: "exact", head: true })
        .gt("expires_at", new Date().toISOString());
      if (!cancelled && typeof count === "number") setActiveSignals(count);
    })();
    return () => { cancelled = true; };
  }, []);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "AI Stock Trading: How It Works, What It Can and Cannot Do",
      description:
        "A complete guide to AI stock trading — how model-driven engines scan, score, size, and exit trades, how to evaluate a platform, and what the realistic edge looks like.",
      author: { "@type": "Organization", name: "StockAI" },
      publisher: { "@type": "Organization", name: "StockAI" },
      datePublished: "2026-08-23",
      dateModified: "2026-08-23",
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
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://usestockai.lovable.app/" },
        { "@type": "ListItem", position: 2, name: "AI Stock Trading", item: `https://usestockai.lovable.app${PATH}` },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title="AI Stock Trading: How It Works & How to Do It (2026 Guide)"
        description="AI stock trading explained: how model-driven engines scan, score, size and exit trades, how to judge a platform's real edge, and how to backtest before risking capital."
        path={PATH}
        type="article"
        jsonLd={jsonLd}
      />
      <Navbar />

      <main className="flex-1 container mx-auto px-4 sm:px-6 pt-20 md:pt-24 pb-16 max-w-3xl">
        <motion.article
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-12"
        >
          <header className="space-y-4">
            <div className="text-xs uppercase tracking-widest text-primary/80">Complete guide</div>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight">
              AI Stock Trading
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              AI stock trading replaces discretionary chart-reading with a model that scores every
              candidate the same way, sizes positions from calibrated probability, and manages exits
              by rule. This guide covers how those engines are built, where they break, how to
              evaluate one honestly, and how to test a strategy before a single dollar is at risk.
            </p>
            {activeSignals !== null && activeSignals > 0 && (
              <p className="text-sm text-primary/90">
                {activeSignals} AI signals are active on StockAI right now.
              </p>
            )}
          </header>

          <nav aria-label="On this page" className="glass-card rounded-lg p-5">
            <div className="text-sm font-medium mb-3">On this page</div>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {[
                ["what-is", "What AI stock trading is"],
                ["how-it-works", "How an AI trading engine works"],
                ["edge", "Where the edge actually comes from"],
                ["fails", "Why most AI trading systems lose money"],
                ["evaluate", "How to evaluate a platform"],
                ["start", "How to start, step by step"],
                ["faq", "Frequently asked questions"],
              ].map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className="hover:text-primary transition-colors">{label}</a>
                </li>
              ))}
            </ul>
          </nav>

          <section id="what-is" className="space-y-4 scroll-mt-24">
            <h2 className="text-2xl font-medium tracking-tight">What AI stock trading is</h2>
            <p className="text-muted-foreground leading-relaxed">
              AI stock trading is the practice of letting statistical models make — or at minimum
              rank — trading decisions. The word "AI" covers a wide range in practice: gradient-boosted
              trees on engineered features, ensembles of simpler models voting together, regime
              classifiers, and language models used to summarise news or narrate rationale. Almost none
              of it is a single neural network that "predicts prices." A production engine is a pipeline
              of small, auditable components, each doing one job.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              The practical difference from manual trading is consistency. A human trader sees perhaps
              thirty charts a day and applies slightly different standards to each depending on mood,
              recent losses, and what they already own. A model applies identical standards to six
              thousand tickers, every day, and produces a comparable score for each one. That
              comparability — not raw prediction skill — is the first real advantage.
            </p>
          </section>

          <section id="how-it-works" className="space-y-4 scroll-mt-24">
            <h2 className="text-2xl font-medium tracking-tight">How an AI trading engine works</h2>
            <p className="text-muted-foreground leading-relaxed">
              Strip the branding from any serious system and the same four-stage loop appears.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {stages.map(({ icon: Icon, title, body }) => (
                <Card key={title} className="glass-card p-5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">{title}</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                </Card>
              ))}
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Wrapped around the loop is a feedback layer. Every closed trade is labelled with what
              actually happened and fed back into calibration, so the score-to-outcome mapping is
              re-fit as market behaviour drifts. A system without that loop is frozen at the moment it
              was trained, and markets do not stay still.{" "}
              <Link to="/guides/ai-stock-signals-explained" className="text-primary hover:underline">
                See how individual signals are constructed
              </Link>.
            </p>
          </section>

          <section id="edge" className="space-y-4 scroll-mt-24">
            <h2 className="text-2xl font-medium tracking-tight">Where the edge actually comes from</h2>
            <p className="text-muted-foreground leading-relaxed">
              Retail traders assume the edge is in prediction. It is mostly not. In practice, the
              durable advantages are:
            </p>
            <ul className="space-y-3 text-muted-foreground leading-relaxed">
              <li>
                <span className="text-foreground">Coverage.</span> Scanning thousands of names finds
                the handful of setups that are genuinely in the top percentile, rather than the best of
                the thirty charts you happened to open.
              </li>
              <li>
                <span className="text-foreground">Calibration.</span> Knowing that an 80-conviction
                setup really does resolve favourably more often than a 65 lets you size correctly.
                Sizing off a mis-calibrated score is mathematically worse than flat sizing.
              </li>
              <li>
                <span className="text-foreground">Exit discipline.</span> Machines do not widen a stop
                because they "believe in the story." Consistent exits are usually worth more than any
                entry improvement.
              </li>
              <li>
                <span className="text-foreground">Risk accounting.</span> Correlation gates, sector
                caps, and portfolio-level heat limits stop a book of eight positions from being one
                position in disguise.
              </li>
            </ul>
          </section>

          <section id="fails" className="space-y-4 scroll-mt-24">
            <h2 className="text-2xl font-medium tracking-tight">Why most AI trading systems lose money</h2>
            <p className="text-muted-foreground leading-relaxed">
              Overfitting is the famous failure, but it is rarely the fatal one on its own. The
              expensive failures are structural: stop distances wide enough that a single overnight gap
              erases a month; conviction scores that invert, so the largest positions are taken on the
              worst setups; positions held long past the horizon the model was trained on; and
              trading costs ignored in backtests, which quietly converts a profitable strategy into a
              losing one at the moment of live deployment.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Every one of these is detectable before you risk capital, and all of them are detectable
              with the same instrument:{" "}
              <Link to="/guides/backtest-trading-strategy" className="text-primary hover:underline">
                a backtest that models costs, slippage, and out-of-sample periods honestly
              </Link>.
            </p>
          </section>

          <section id="evaluate" className="space-y-4 scroll-mt-24">
            <h2 className="text-2xl font-medium tracking-tight">How to evaluate an AI trading platform</h2>
            <p className="text-muted-foreground leading-relaxed">
              Use a fixed checklist and refuse to be moved off it by marketing:
            </p>
            <ul className="space-y-2 text-muted-foreground leading-relaxed list-disc pl-5">
              <li>Is the methodology published, or is it a black box with a results page?</li>
              <li>Is there a complete trade log — including losers — rather than screenshots?</li>
              <li>Are conviction scores calibrated, and is the calibration shown?</li>
              <li>Are risk limits explicit: max stop distance, max position, correlation controls?</li>
              <li>Can you run your own backtest with your own parameters?</li>
              <li>Does it disclose drawdown as prominently as returns?</li>
              <li>Does it promise guaranteed returns? If so, walk away.</li>
            </ul>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/performance">See our live track record <ArrowRight className="w-3.5 h-3.5 ml-1" /></Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/guides/ai-trading-bots">Compare AI trading bots</Link>
              </Button>
            </div>
          </section>

          <section id="start" className="space-y-4 scroll-mt-24">
            <h2 className="text-2xl font-medium tracking-tight">How to start, step by step</h2>
            <ol className="space-y-3 text-muted-foreground leading-relaxed list-decimal pl-5">
              <li>
                Pick one timeframe and stay there. Swing horizons of three to fifteen trading days are
                the most forgiving for retail costs.
              </li>
              <li>
                Backtest the strategy across at least one bull market, one correction, and one flat
                stretch — with commissions and slippage switched on.
              </li>
              <li>
                Paper trade the live signal feed for a minimum of thirty trades. Compare realized win
                rate to the conviction the model claimed.
              </li>
              <li>
                Go live at a fraction of intended size. Confirm your real fills match the backtest's
                assumed fills before scaling.
              </li>
              <li>
                Review monthly. If realized outcomes drift from calibrated expectations, reduce size
                first and diagnose second.
              </li>
            </ol>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Keep reading</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                ["/guides/ai-trading-bots", "AI trading bots", "How automated execution works and how to spot a fake edge."],
                ["/guides/ai-stock-signals-explained", "AI stock signals explained", "What goes into a single BUY or SELL signal."],
                ["/guides/backtest-trading-strategy", "Backtesting a strategy", "Sharpe, Sortino, Monte Carlo and walk-forward in plain English."],
                ["/guides/best-ai-stocks-to-buy-now", "Best AI stocks now", "Where the model currently sees the strongest setups."],
                ["/guides/does-ai-stock-trading-work", "Does AI stock trading work?", "The evidence, the caveats, and the honest answer."],
                ["/guides/ai-stock-trading-for-beginners", "Beginner's path", "A first-90-days plan with no jargon."],
              ].map(([href, title, body]) => (
                <Card key={href} className="glass-card p-4 hover:border-primary/30 transition-colors">
                  <Link to={href} className="block space-y-1">
                    <div className="text-sm font-medium">{title}</div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
                  </Link>
                </Card>
              ))}
            </div>
          </section>

          <section id="faq" className="space-y-5 scroll-mt-24">
            <h2 className="text-2xl font-medium tracking-tight">Frequently asked questions</h2>
            {faqs.map((f) => (
              <div key={f.q} className="space-y-1.5">
                <h3 className="text-base font-medium">{f.q}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
              </div>
            ))}
          </section>

          <Card className="glass-card p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Try it on live data</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Browse the current signal feed, run a backtest with your own parameters, and paper trade
              before committing capital.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm"><Link to="/dashboard">Open the dashboard</Link></Button>
              <Button asChild size="sm" variant="outline"><Link to="/backtest">Run a backtest</Link></Button>
            </div>
          </Card>

          <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-6">
            StockAI publishes research and paper-trading tools. Nothing here is financial advice, and
            past performance does not predict future results. See our{" "}
            <Link to="/disclosure" className="text-primary hover:underline">risk disclosure</Link>.
          </p>
        </motion.article>
      </main>

      <Footer />
    </div>
  );
};

export default AiStockTrading;
