import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";

const PATH = "/guides";

const GUIDES: { href: string; kicker: string; title: string; body: string }[] = [
  {
    href: "/ai-stock-trading",
    kicker: "Pillar",
    title: "AI Stock Trading: Complete Guide",
    body: "How model-driven engines scan, score, size, and exit trades — and how to evaluate one honestly.",
  },
  {
    href: "/guides/ai-trading-bots",
    kicker: "Automation",
    title: "AI Trading Bots",
    body: "How automated execution works and how to tell a real edge from marketing.",
  },
  {
    href: "/guides/ai-stock-signals-explained",
    kicker: "Signals",
    title: "AI Stock Signals Explained",
    body: "What goes into a single BUY or SELL signal, field by field.",
  },
  {
    href: "/guides/backtest-trading-strategy",
    kicker: "Validation",
    title: "How to Backtest a Trading Strategy",
    body: "Sharpe, Sortino, Monte Carlo, and walk-forward in plain English.",
  },
  {
    href: "/guides/does-ai-stock-trading-work",
    kicker: "Evidence",
    title: "Does AI Stock Trading Actually Work?",
    body: "The honest answer, with the failure modes that erase most edges.",
  },
  {
    href: "/guides/ai-stock-trading-for-beginners",
    kicker: "Beginners",
    title: "AI Stock Trading for Beginners",
    body: "A jargon-free vocabulary and a 90-day plan before you risk capital.",
  },
  {
    href: "/guides/ai-stock-trading-software",
    kicker: "Tools",
    title: "AI Stock Trading Software",
    body: "A buyer's checklist: the features that matter and the red flags that don't.",
  },
  {
    href: "/guides/how-accurate-are-ai-stock-predictions",
    kicker: "Accuracy",
    title: "How Accurate Are AI Stock Predictions?",
    body: "Why calibration beats accuracy and how to verify a claimed hit rate.",
  },
  {
    href: "/guides/ai-vs-human-traders",
    kicker: "Comparison",
    title: "AI vs Human Traders",
    body: "Where models win, where judgement wins, and the hybrid that works.",
  },
  {
    href: "/guides/best-ai-stocks-to-buy-now",
    kicker: "Markets",
    title: "Best AI Stocks to Buy Now",
    body: "Where the model currently sees the strongest setups.",
  },
  {
    href: "/guides/ai-dividend-stocks",
    kicker: "Income",
    title: "AI Dividend Stocks",
    body: "Using systematic screening to build an income portfolio.",
  },
];

const GuidesIndex = () => (
  <div className="min-h-screen bg-background flex flex-col">
    <SEO
      title="AI Trading Guides — StockAI Learning Hub"
      description="The StockAI learning hub: complete guides on AI stock trading, signals, backtesting, accuracy, bots, and how to evaluate a platform honestly."
      path={PATH}
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "StockAI Guides",
        description:
          "Complete guides on AI stock trading, signals, backtesting, and evaluating automated trading platforms.",
        url: "https://usestockai.lovable.app/guides",
      }}
    />
    <Navbar />

    <main className="flex-1 container mx-auto px-4 sm:px-6 pt-20 md:pt-24 pb-16 max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-10"
      >
        <header className="space-y-4 max-w-2xl">
          <div className="text-xs uppercase tracking-widest text-primary/80">Learn</div>
          <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight">Guides</h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Everything we know about AI stock trading, written to be checked against our own product.
            Start with the complete guide, then go deep on the part that matters to you.
          </p>
        </header>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {GUIDES.map((g) => (
            <Card key={g.href} className="glass-card p-5 hover:border-primary/30 transition-colors">
              <Link to={g.href} className="block space-y-2">
                <div className="text-xs uppercase tracking-widest text-primary/70">{g.kicker}</div>
                <div className="text-base font-medium leading-snug">{g.title}</div>
                <p className="text-sm text-muted-foreground leading-relaxed">{g.body}</p>
                <div className="text-xs text-primary flex items-center gap-1 pt-1">
                  Read <ArrowRight className="w-3 h-3" />
                </div>
              </Link>
            </Card>
          ))}
        </div>
      </motion.div>
    </main>

    <Footer />
  </div>
);

export default GuidesIndex;
