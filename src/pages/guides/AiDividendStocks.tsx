import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, LineChart, ShieldCheck, Sparkles, ArrowRight } from "lucide-react";

const PATH = "/guides/ai-dividend-stocks";

const faqs = [
  {
    q: "What is AI-powered dividend investing?",
    a: "AI-powered dividend investing uses quantitative models to score dividend-paying stocks on payout sustainability, growth trajectory, and total-return conviction — rather than relying on trailing yield alone. StockAI scans 6,000+ tickers daily and surfaces the dividend names with the highest calibrated conviction.",
  },
  {
    q: "How does StockAI evaluate dividend stocks like SCHD or JEPI?",
    a: "For every ticker we combine technical regime detection, momentum, relative strength, macro overlays, and (for ETFs like SCHD and JEPI) the underlying holdings' aggregate signal. The result is a conviction score you can compare across the whole dividend universe, not just a raw yield number.",
  },
  {
    q: "Is a high dividend yield always a good signal?",
    a: "No. A yield above ~7% is often a warning that the market expects a cut. Our engine flags 'yield traps' by cross-checking payout ratio, earnings revisions, short-interest velocity, and price trend against the peer group.",
  },
  {
    q: "Can I backtest a dividend-growth strategy on StockAI?",
    a: "Yes. The Backtest tool lets you run walk-forward simulations on any basket of dividend tickers with institutional metrics — Sharpe, Sortino, Calmar, Monte Carlo drawdown cones, and strategy attribution.",
  },
  {
    q: "Which dividend ETFs does StockAI cover?",
    a: "The scanner covers the full US-listed universe including SCHD, JEPI, JEPQ, VYM, DVY, HDV, DGRO, SPHD, NOBL, VIG, and every S&P 500 constituent, plus large-cap dividend payers globally.",
  },
];

const AiDividendStocks = () => {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "AI Dividend Stocks: How to Use AI for Dividend Investing in 2026",
      description:
        "A quantitative guide to using AI to screen, score, and backtest dividend stocks like SCHD, JEPI, and the S&P 500 dividend aristocrats.",
      author: { "@type": "Organization", name: "StockAI" },
      publisher: { "@type": "Organization", name: "StockAI" },
      datePublished: "2026-07-03",
      dateModified: "2026-07-03",
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
        { "@type": "ListItem", position: 2, name: "Guides", item: "https://usestockai.lovable.app/guides" },
        { "@type": "ListItem", position: 3, name: "AI Dividend Stocks", item: `https://usestockai.lovable.app${PATH}` },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title="AI Dividend Stocks — Screen SCHD & JEPI with Conviction"
        description="Use AI to score dividend stocks by sustainability, growth, and conviction. Backtest SCHD, JEPI, and dividend aristocrat strategies in one platform."
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
            <div className="text-xs uppercase tracking-widest text-primary/80">Guide · Dividend Investing</div>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight">
              AI Dividend Stocks: The 2026 Playbook for Quant-Driven Yield
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Trailing yield is the worst way to pick a dividend stock. Here's how AI-driven
              conviction scoring changes the way long-term investors evaluate SCHD, JEPI, and
              the dividend aristocrats — and how to backtest a strategy in minutes.
            </p>
          </header>

          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { icon: TrendingUp, label: "Conviction over yield" },
              { icon: LineChart, label: "Backtested strategies" },
              { icon: ShieldCheck, label: "Yield-trap detection" },
            ].map(({ icon: Icon, label }) => (
              <Card key={label} className="glass-card p-4 flex items-center gap-3">
                <Icon className="w-4 h-4 text-primary" />
                <span className="text-sm">{label}</span>
              </Card>
            ))}
          </div>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Why yield alone is a broken signal</h2>
            <p className="text-muted-foreground leading-relaxed">
              A 9% yield usually means the market is pricing in a dividend cut. Every year
              a handful of "high-yield" names slash their payouts — and the total return
              investors receive is deeply negative once the capital loss is included.
              The fix is to score dividend stocks on multiple dimensions at once: payout
              sustainability, earnings revisions, momentum, and macro regime.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              That's the job an AI engine does well. Instead of ranking 6,000 tickers on
              a single number, it combines dozens of features into a calibrated
              conviction score you can compare apples-to-apples across the whole market.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">SCHD vs JEPI: an AI-conviction view</h2>
            <p className="text-muted-foreground leading-relaxed">
              SCHD and JEPI dominate dividend-ETF search interest, but they are radically
              different products. SCHD is a quality-and-growth screen on ~100 US dividend
              payers. JEPI writes covered calls on a low-volatility slice of the S&P 500 to
              generate income at the cost of upside capture.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              StockAI evaluates each on its own merits. SCHD tends to score well in
              trending, risk-on regimes where its industrials and financials sleeves lead.
              JEPI scores higher in choppy, low-vol regimes where option premium is rich
              relative to realized volatility. The AI picks the right vehicle for the
              regime — not the one with the flashier trailing yield.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">A four-step AI dividend workflow</h2>
            <ol className="space-y-3 list-decimal list-inside text-muted-foreground leading-relaxed">
              <li><span className="text-foreground font-medium">Screen</span> the universe by yield floor, payout ratio, and 5-year dividend growth.</li>
              <li><span className="text-foreground font-medium">Score</span> survivors with the AI conviction engine to filter for regime alignment.</li>
              <li><span className="text-foreground font-medium">Backtest</span> the resulting basket with walk-forward validation and Monte Carlo drawdown cones.</li>
              <li><span className="text-foreground font-medium">Monitor</span> live positions with automated sell alerts on payout risk or trend breaks.</li>
            </ol>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">Dividend aristocrats worth AI screening</h2>
            <p className="text-muted-foreground leading-relaxed">
              The S&P 500 dividend aristocrats — companies that have raised their dividend
              for 25+ consecutive years — are a natural starting universe. Names like
              Johnson & Johnson (JNJ), Procter & Gamble (PG), Coca-Cola (KO), PepsiCo (PEP),
              and McDonald's (MCD) all show up regularly. The AI conviction score tells
              you <em>when</em> each is in a favorable regime, so you're not just buying
              and hoping the aristocrat status alone will drive returns.
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
                <div className="font-medium">Screen dividend stocks with AI now</div>
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

export default AiDividendStocks;
