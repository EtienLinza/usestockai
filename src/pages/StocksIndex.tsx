import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SEO_TICKERS } from "@/data/seo-tickers";
import { Search } from "lucide-react";

const PATH = "/stocks";

const StocksIndex = () => {
  const [query, setQuery] = useState("");
  const sectors = useMemo(() => {
    const grouped = new Map<string, typeof SEO_TICKERS>();
    for (const t of SEO_TICKERS) {
      if (!grouped.has(t.sector)) grouped.set(t.sector, []);
      grouped.get(t.sector)!.push(t);
    }
    return Array.from(grouped.entries());
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return null;
    return SEO_TICKERS.filter(
      (t) => t.symbol.includes(q) || t.name.toUpperCase().includes(q),
    );
  }, [query]);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "AI Stock Forecasts by Ticker",
    description:
      "AI-generated forecasts and signals for popular stocks, ETFs, and crypto pairs, updated daily by the StockAI engine.",
    url: `https://usestockai.lovable.app${PATH}`,
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title="AI Stock Forecasts by Ticker — Live Signals & Ratings"
        description="Browse AI stock forecasts for major tickers: live BUY/SELL signals, conviction scores, and regimes from the StockAI engine, updated daily."
        path={PATH}
        jsonLd={jsonLd}
      />
      <Navbar />

      <main className="flex-1 container mx-auto px-4 sm:px-6 pt-20 md:pt-24 pb-16 max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-10"
        >
          <header className="space-y-4 max-w-2xl">
            <div className="text-xs uppercase tracking-widest text-primary/80">Forecasts</div>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight leading-tight">
              AI Stock Forecasts by Ticker
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Each ticker page shows the current StockAI stance — BUY, SELL, or no active signal —
              with conviction, regime, and the engine's own explanation. Updated daily.
            </p>
          </header>

          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by ticker or company…"
              className="pl-9"
              aria-label="Filter tickers"
            />
          </div>

          {filtered ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((t) => (
                <Card key={t.symbol} className="glass-card p-4 hover:border-primary/30 transition-colors">
                  <Link to={`/stocks/${encodeURIComponent(t.symbol)}/ai-forecast`} className="block space-y-1">
                    <div className="font-mono text-sm font-medium">{t.symbol}</div>
                    <div className="text-xs text-muted-foreground">{t.name}</div>
                    <div className="text-xs text-muted-foreground/70">{t.sector}</div>
                  </Link>
                </Card>
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground col-span-full">
                  No curated forecast page for that query. The full scanner covers thousands of tickers —{" "}
                  <Link to="/dashboard" className="text-primary hover:underline">look one up on the dashboard</Link>.
                </p>
              )}
            </div>
          ) : (
            sectors.map(([sector, tickers]) => (
              <section key={sector} className="space-y-3">
                <h2 className="text-xl font-medium tracking-tight">{sector}</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {tickers.map((t) => (
                    <Card key={t.symbol} className="glass-card p-4 hover:border-primary/30 transition-colors">
                      <Link to={`/stocks/${encodeURIComponent(t.symbol)}/ai-forecast`} className="block space-y-1">
                        <div className="font-mono text-sm font-medium">{t.symbol}</div>
                        <div className="text-xs text-muted-foreground">{t.name}</div>
                      </Link>
                    </Card>
                  ))}
                </div>
              </section>
            ))
          )}
        </motion.div>
      </main>

      <Footer />
    </div>
  );
};

export default StocksIndex;
