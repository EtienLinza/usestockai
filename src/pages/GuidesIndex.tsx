import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";

const PATH = "/guides";

type Guide = { href: string; title: string; body: string };
type Section = { id: string; label: string; blurb: string; guides: Guide[] };

const PILLAR: Guide = {
  href: "/ai-stock-trading",
  title: "AI Stock Trading: Complete Guide",
  body: "How model-driven engines scan, score, size, and exit trades — and how to evaluate one honestly.",
};

const SECTIONS: Section[] = [
  {
    id: "foundations",
    label: "Foundations",
    blurb: "Start here if the vocabulary is still new.",
    guides: [
      {
        href: "/guides/ai-stock-trading-for-beginners",
        title: "AI Stock Trading for Beginners",
        body: "A jargon-free vocabulary and a 90-day plan before you risk capital.",
      },
      {
        href: "/guides/ai-stock-signals-explained",
        title: "AI Stock Signals Explained",
        body: "What goes into a single BUY or SELL signal, field by field.",
      },
      {
        href: "/guides/ai-trading-bots",
        title: "AI Trading Bots",
        body: "How automated execution works and how to tell a real edge from marketing.",
      },
    ],
  },
  {
    id: "evidence",
    label: "Evidence & validation",
    blurb: "How to check whether an edge is real before you trust it.",
    guides: [
      {
        href: "/guides/does-ai-stock-trading-work",
        title: "Does AI Stock Trading Actually Work?",
        body: "The honest answer, with the failure modes that erase most edges.",
      },
      {
        href: "/guides/how-accurate-are-ai-stock-predictions",
        title: "How Accurate Are AI Stock Predictions?",
        body: "Why calibration beats accuracy and how to verify a claimed hit rate.",
      },
      {
        href: "/guides/backtest-trading-strategy",
        title: "How to Backtest a Trading Strategy",
        body: "Sharpe, Sortino, Monte Carlo, and walk-forward in plain English.",
      },
    ],
  },
  {
    id: "choosing",
    label: "Choosing a platform",
    blurb: "What actually matters when you compare tools — and traders.",
    guides: [
      {
        href: "/guides/ai-stock-trading-software",
        title: "AI Stock Trading Software",
        body: "A buyer's checklist: the features that matter and the red flags that don't.",
      },
      {
        href: "/guides/ai-vs-human-traders",
        title: "AI vs Human Traders",
        body: "Where models win, where judgement wins, and the hybrid that works.",
      },
    ],
  },
  {
    id: "markets",
    label: "Markets & ideas",
    blurb: "Where the model is currently pointing.",
    guides: [
      {
        href: "/guides/best-ai-stocks-to-buy-now",
        title: "Best AI Stocks to Buy Now",
        body: "Where the model currently sees the strongest setups.",
      },
      {
        href: "/guides/ai-dividend-stocks",
        title: "AI Dividend Stocks",
        body: "Using systematic screening to build an income portfolio.",
      },
    ],
  },
];

const ALL = [PILLAR, ...SECTIONS.flatMap((s) => s.guides)];

const GuidesIndex = () => (
  <div className="min-h-screen bg-background flex flex-col">
    <SEO
      title="AI Trading Guides — StockAI Learning Hub"
      description="The StockAI learning hub: complete guides on AI stock trading, signals, backtesting, accuracy, bots, and how to evaluate a platform honestly."
      path={PATH}
      jsonLd={[
        {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "StockAI Guides",
          description:
            "Complete guides on AI stock trading, signals, backtesting, and evaluating automated trading platforms.",
          url: "https://usestockai.lovable.app/guides",
        },
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: ALL.map((g, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: g.title,
            url: `https://usestockai.lovable.app${g.href}`,
          })),
        },
      ]}
    />
    <Navbar />

    <main className="flex-1 container mx-auto px-4 sm:px-6 pt-20 md:pt-24 pb-16 max-w-5xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-12"
      >
        <header className="space-y-4 max-w-2xl">
          <div className="text-xs uppercase tracking-widest text-primary/80">Learn</div>
          <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight">Guides</h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Everything we know about AI stock trading, written to be checked against our own product.
            Start with the complete guide, then go deep on the part that matters to you.
          </p>
        </header>

        {/* Pillar */}
        <Card className="glass-card p-6 sm:p-8 hover:border-primary/30 transition-colors">
          <Link to={PILLAR.href} className="block space-y-3">
            <div className="text-xs uppercase tracking-widest text-primary/70">Start here</div>
            <h2 className="text-2xl font-light tracking-tight">{PILLAR.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">{PILLAR.body}</p>
            <div className="text-xs text-primary flex items-center gap-1 pt-1">
              Read the complete guide <ArrowRight className="w-3 h-3" />
            </div>
          </Link>
        </Card>

        {/* Category jump links */}
        <nav aria-label="Guide categories" className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="text-xs px-3 py-1.5 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            >
              {s.label}
            </a>
          ))}
        </nav>

        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id} className="space-y-4 scroll-mt-24">
            <div className="space-y-1">
              <h2 className="text-xl font-light tracking-tight">{section.label}</h2>
              <p className="text-sm text-muted-foreground">{section.blurb}</p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {section.guides.map((g) => (
                <Card key={g.href} className="glass-card p-5 hover:border-primary/30 transition-colors">
                  <Link to={g.href} className="block space-y-2">
                    <div className="text-base font-medium leading-snug">{g.title}</div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{g.body}</p>
                    <div className="text-xs text-primary flex items-center gap-1 pt-1">
                      Read <ArrowRight className="w-3 h-3" />
                    </div>
                  </Link>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </motion.div>
    </main>

    <Footer />
  </div>
);

export default GuidesIndex;
