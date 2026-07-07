import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Cpu, TrendingUp, Layers, Sparkles, ArrowRight } from "lucide-react";

const PATH = "/guides/best-ai-stocks-to-buy-now";

const stocks = [
  {
    ticker: "NVDA",
    name: "NVIDIA",
    thesis:
      "The picks-and-shovels play of the AI buildout. Data-center GPU demand still outpaces supply, and CUDA lock-in gives NVIDIA pricing power competitors can't match in the near term.",
    watch: "Hyperscaler capex cadence; any sign of custom-silicon substitution at scale.",
  },
  {
    ticker: "MSFT",
    name: "Microsoft",
    thesis:
      "The distribution moat for enterprise AI. Copilot attach across Office, Azure OpenAI revenue, and the OpenAI equity stake stack three independent monetization vectors on one balance sheet.",
    watch: "Copilot seat conversion; Azure AI gross margin trajectory.",
  },
  {
    ticker: "GOOGL",
    name: "Alphabet",
    thesis:
      "The only vertically integrated stack outside NVIDIA — TPUs, Gemini models, YouTube data, and Search distribution. Trades at a discount to peers on AI-disruption fear that Gemini traction is quietly rebutting.",
    watch: "Search query share vs AI chat substitutes; TPU external adoption.",
  },
  {
    ticker: "META",
    name: "Meta Platforms",
    thesis:
      "AI is directly measurable in ad CPMs and Reels engagement. Llama open-source strategy pressures competitor margins while Meta captures the recommendation-engine upside for free.",
    watch: "Reality Labs cash burn; regulatory pressure on ad targeting.",
  },
  {
    ticker: "AMD",
    name: "Advanced Micro Devices",
    thesis:
      "The credible NVIDIA alternative. MI300X shipments to Microsoft and Meta are proof of demand; ROCm software maturity is the gating factor for a re-rating.",
    watch: "MI325X ramp; ROCm developer adoption metrics.",
  },
  {
    ticker: "TSM",
    name: "Taiwan Semiconductor",
    thesis:
      "Every leading-edge AI chip — NVIDIA, AMD, Apple, Broadcom — ships from TSMC fabs. Effectively a monopoly on sub-3nm production through at least 2027.",
    watch: "Geopolitical risk premium; Arizona and Japan fab yield ramp.",
  },
];

const faqs = [
  {
    q: "What are the best AI stocks to buy now?",
    a: "The most consistently high-conviction AI names on StockAI are NVIDIA (NVDA), Microsoft (MSFT), Alphabet (GOOGL), Meta (META), AMD, and TSMC. Rankings shift as regime and momentum change — check the live scanner for today's conviction scores.",
  },
  {
    q: "Is NVIDIA still a buy in 2026?",
    a: "NVIDIA remains the largest AI beneficiary by revenue, but position sizing matters. Use conviction scoring and regime detection to decide whether to add, hold, or trim — not headline sentiment.",
  },
  {
    q: "Should I buy AI stocks or an AI ETF?",
    a: "ETFs (like BOTZ, ROBO, or QQQ for a broader tilt) reduce single-name risk but dilute the AI thesis. StockAI lets you score individual constituents against the ETF to see whether you're paying for beta or genuine stock-picking edge.",
  },
  {
    q: "What are the risks of investing in AI stocks?",
    a: "Concentration risk (a handful of names drive most sector return), capex-cycle risk (hyperscaler spend can pause), regulation, and valuation compression if AI-monetization proof points slip. Backtest any AI-weighted strategy with Monte Carlo to see drawdown distributions.",
  },
  {
    q: "How does StockAI rank AI stocks?",
    a: "Every ticker gets a calibrated conviction score combining technical indicators, market regime, sector momentum, and stock-specific overlays. AI names are scored on the same footing as every other stock — no thematic bonus.",
  },
];

const BestAiStocksToBuyNow = () => {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "Best AI Stocks to Buy Now: A Conviction-Scored 2026 Watchlist",
      description:
        "The top AI stocks to watch right now — NVIDIA, Microsoft, Alphabet, Meta, AMD, TSMC — evaluated with AI conviction scoring rather than headline sentiment.",
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
        title="Best AI Stocks to Buy Now — Conviction-Scored 2026 Picks"
        description="The top AI stocks to watch — NVIDIA, MSFT, GOOGL, META, AMD, TSMC — evaluated with AI conviction scoring, not headline hype. Backtest any pick."
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
            <div className="text-xs uppercase tracking-widest text-primary/80">Guide · AI Stocks</div>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight">
              Best AI Stocks to Buy Now — a Conviction-Scored 2026 Watchlist
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Every list of "best AI stocks" you've read leads with a story. This one leads with math.
              Below are the six AI names that consistently earn high conviction from StockAI's scanner
              — with the thesis, the risks, and what to watch each week.
            </p>
          </header>

          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { icon: Cpu, label: "Semis & silicon" },
              { icon: Layers, label: "Platforms & models" },
              { icon: TrendingUp, label: "Conviction over hype" },
            ].map(({ icon: Icon, label }) => (
              <Card key={label} className="glass-card p-4 flex items-center gap-3">
                <Icon className="w-4 h-4 text-primary" />
                <span className="text-sm">{label}</span>
              </Card>
            ))}
          </div>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">How this list is built</h2>
            <p className="text-muted-foreground leading-relaxed">
              These aren't picks. They're the AI-exposed names that most often clear StockAI's
              conviction threshold across regimes. Each one earns its place on fundamentals plus
              live signal behavior — and you can pull today's actual conviction score for any of
              them on the dashboard.
            </p>
          </section>

          <section className="space-y-6">
            <h2 className="text-2xl font-medium tracking-tight">The six names to watch</h2>
            <div className="space-y-4">
              {stocks.map((s) => (
                <Card key={s.ticker} className="glass-card p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-mono font-medium">{s.ticker}</div>
                      <div className="text-xs text-muted-foreground">{s.name}</div>
                    </div>
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/stock/${s.ticker}`}>
                        Live conviction <ArrowRight className="w-3 h-3 ml-1" />
                      </Link>
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.thesis}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <span className="text-foreground font-medium">Watch:</span> {s.watch}
                  </p>
                </Card>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium tracking-tight">How to actually trade this list</h2>
            <ol className="space-y-3 list-decimal list-inside text-muted-foreground leading-relaxed">
              <li><span className="text-foreground font-medium">Filter</span> the six names by today's conviction score on the dashboard — only act on the ones above threshold.</li>
              <li><span className="text-foreground font-medium">Size</span> based on portfolio heat, not conviction alone. Concentration is the #1 killer of AI-heavy books.</li>
              <li><span className="text-foreground font-medium">Backtest</span> a rules-based rotation across the six with walk-forward validation before committing capital.</li>
              <li><span className="text-foreground font-medium">Monitor</span> hyperscaler capex commentary each earnings cycle — the whole thesis flows from that spend.</li>
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
                <div className="font-medium">See today's live conviction on every AI name</div>
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

export default BestAiStocksToBuyNow;
