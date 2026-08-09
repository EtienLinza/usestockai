import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot, ShieldCheck, LineChart, Sparkles, ArrowRight } from "lucide-react";

const PATH = "/guides/ai-trading-bots";

const faqs = [
  {
    q: "Do AI trading bots actually work?",
    a: "Some do, most don't. A bot only works if it has a measurable, repeatable edge after costs — spread, slippage, and commissions. The way to tell is to demand out-of-sample backtests, a live track record with every trade logged (including losers), and calibrated probabilities you can check against realized outcomes.",
  },
  {
    q: "Are AI trading bots legit?",
    a: "The technology is legitimate; a large share of the marketing around it is not. Red flags: guaranteed returns, hidden methodology, screenshots instead of trade logs, and no mention of drawdown. A legitimate bot publishes its rules, its risk limits, and its losses.",
  },
  {
    q: "What is the best AI trading bot?",
    a: "There is no single best bot — the right one depends on your capital, timeframe, and risk tolerance. Judge candidates on four things: transparent logic, calibrated conviction scores, hard risk controls (stop caps, position limits, correlation gates), and a full public trade log.",
  },
  {
    q: "Is there a free AI trading bot?",
    a: "Free tiers usually give you signals and paper trading rather than fully automated live execution. That is the correct order anyway: paper trade the bot first, verify the edge on your own data, then decide whether to commit capital.",
  },
  {
    q: "How much money do I need to start?",
    a: "Enough that per-trade costs are a small fraction of expected move, and enough to hold several uncorrelated positions. Under a few thousand dollars, costs and position-size rounding tend to eat most of a short-term strategy's edge.",
  },
  {
    q: "Can an AI trading bot lose money?",
    a: "Yes — every bot has losing trades and losing months. What separates a survivable bot from a dangerous one is loss control: capped stop distance, capped single-name exposure, and a circuit breaker that benches a strategy when its trailing expectancy turns negative.",
  },
];

const AiTradingBots = () => {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "AI Trading Bots: How They Work and How to Tell If One Is Real",
      description:
        "A practical guide to AI trading bots — how automated signal engines generate, size, and exit trades, plus how to separate a real edge from marketing.",
      author: { "@type": "Organization", name: "StockAI" },
      publisher: { "@type": "Organization", name: "StockAI" },
      datePublished: "2026-08-09",
      dateModified: "2026-08-09",
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
        title="AI Trading Bot: How Automated Trading Actually Works"
        description="What an AI trading bot really does, how it sizes and exits trades, and how to tell a genuine edge from marketing. Plus a transparent, backtestable alternative."
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
            <div className="text-xs uppercase tracking-widest text-primary/80">Guide · Automation</div>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight">
              AI Trading Bots: How They Work, and How to Tell If One Is Real
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              An AI trading bot is software that scans markets, scores setups, sizes positions, and
              exits them without you clicking anything. The hard part isn't the automation — it's
              proving the edge survives costs, drawdowns, and a market that changes underneath it.
            </p>
          </header>

          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { icon: Bot, label: "Automated scanning" },
              { icon: ShieldCheck, label: "Hard risk limits" },
              { icon: LineChart, label: "Verifiable track record" },
            ].map(({ icon: Icon, label }) => (
              <Card key={label} className="glass-card p-4 flex items-center gap-3">
                <Icon className="w-4 h-4 text-primary" />
                <span className="text-sm">{label}</span>
              </Card>
            ))}
          </div>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">What an AI trading bot actually does</h2>
            <p className="text-muted-foreground leading-relaxed">
              Strip away the branding and every serious bot runs the same four-stage loop. First it{" "}
              <span className="text-foreground">scans</span> a universe of tickers on a schedule,
              computing features from price, volume, volatility, and market context. Then it{" "}
              <span className="text-foreground">scores</span> each candidate into a single conviction
              number. Next it <span className="text-foreground">sizes</span> the position from that
              score, current volatility, and account risk limits. Finally it{" "}
              <span className="text-foreground">manages the exit</span> — stop, target, trailing
              logic, and a time stop for trades that go nowhere.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              Most bots that blow up don't fail at stage two. They fail at stages three and four:
              oversized positions on a mis-calibrated score, or stops so wide that one gap erases a
              month of small wins.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">"AI" is doing a lot of work in that phrase</h2>
            <p className="text-muted-foreground leading-relaxed">
              A rules-based bot follows fixed conditions — RSI under 30, price above the 200-day
              average. An AI trading bot learns weights from historical outcomes and updates them as
              new results arrive. That's a real advantage and a real risk: a model with too many
              parameters and too little data memorizes the past instead of learning from it. The
              defense is boring and non-negotiable — out-of-sample testing, walk-forward validation,
              and calibration checks that compare predicted probabilities to what actually happened.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Do AI trading bots work? What the honest answer looks like</h2>
            <p className="text-muted-foreground leading-relaxed">
              A bot works if expectancy is positive after costs: win rate times average win, minus
              loss rate times average loss, minus slippage and fees. Note that a high win rate proves
              nothing on its own — a 75% win rate with losses 1.5x the size of wins is a slow bleed.
              Ask any vendor for the payoff ratio and the maximum drawdown alongside the win rate. If
              only one of the three is on the landing page, assume the other two are unflattering.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">A checklist before you trust any bot with capital</h2>
            <ol className="space-y-3 list-decimal list-inside text-muted-foreground leading-relaxed">
              <li><span className="text-foreground font-medium">Full trade log.</span> Every entry and exit, winners and losers, timestamped — not a curated highlight reel.</li>
              <li><span className="text-foreground font-medium">Calibrated scores.</span> When it says 70% confidence, roughly 70% of those setups should have worked.</li>
              <li><span className="text-foreground font-medium">Explicit risk caps.</span> Maximum stop distance, maximum single-name exposure, maximum concurrent positions.</li>
              <li><span className="text-foreground font-medium">Regime awareness.</span> It should trade less, not more, when volatility spikes and trend quality collapses.</li>
              <li><span className="text-foreground font-medium">Your own backtest.</span> You should be able to re-run the strategy on your own parameters, not just read a PDF.</li>
              <li><span className="text-foreground font-medium">A paper-trading phase.</span> Anything that pushes you straight to live capital is selling, not helping.</li>
            </ol>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">How StockAI approaches it</h2>
            <p className="text-muted-foreground leading-relaxed">
              StockAI runs an automated scanner across thousands of tickers and publishes each signal
              with the reasoning behind it — indicators, market regime, and a calibrated conviction
              score. Risk controls are built into the engine rather than left to the user: stop
              distance is capped, single-name exposure is capped, correlated entries are gated, and
              strategies with negative trailing expectancy get benched automatically. Every position
              is tracked in a public autotrader log, and you can{" "}
              <Link to="/backtest" className="underline">backtest a strategy</Link> yourself before
              committing anything. Start on paper — see{" "}
              <Link to="/guides/ai-stock-signals-explained" className="underline">how the signals are scored</Link>{" "}
              if you want the math first.
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
                <div className="font-medium">See the automated scanner running live</div>
                <div className="text-sm text-muted-foreground">Free to start. Paper trading included.</div>
              </div>
            </div>
            <Button asChild>
              <Link to="/dashboard">
                Open the dashboard <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </Button>
          </Card>

          <p className="text-xs text-muted-foreground">
            Educational content only. StockAI is a research and paper-trading platform and does not
            provide investment advice. See our <Link to="/disclosure" className="underline">disclosure</Link>.
          </p>
        </motion.article>
      </main>

      <Footer />
    </div>
  );
};

export default AiTradingBots;
