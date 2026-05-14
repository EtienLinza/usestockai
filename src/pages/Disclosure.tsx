import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Card } from "@/components/ui/card";
import { SEO } from "@/components/SEO";

const Disclosure = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title="Risk Disclosure | StockAI"
        description="Important risk disclosure covering paper-trading limitations, backtest caveats, and the research-only nature of StockAI signals."
        path="/disclosure"
      />
      <Navbar />
      <main className="flex-1">
        <section className="container mx-auto px-6 py-20 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-8"
          >
            <header className="space-y-2">
              <h1 className="text-4xl font-light tracking-tight">Risk Disclosure</h1>
              <p className="text-sm text-muted-foreground">Read this before using any signal.</p>
            </header>

            <Card className="p-6 border-destructive/30 bg-destructive/5">
              <div className="flex gap-4">
                <AlertTriangle className="h-6 w-6 text-destructive shrink-0 mt-1" />
                <div className="space-y-2">
                  <h2 className="text-foreground text-lg font-medium">Trading involves substantial risk of loss.</h2>
                  <p className="text-sm text-muted-foreground">
                    You can lose some or all of your invested capital. Past performance —
                    whether real or backtested — is not indicative of future results.
                  </p>
                </div>
              </div>
            </Card>

            <article className="prose prose-invert max-w-none space-y-6 text-muted-foreground leading-relaxed">
              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">Not Financial Advice</h2>
                <p>
                  StockAI provides quantitative signals, backtests, and educational analytics.
                  Nothing on this platform constitutes investment advice, a personalized
                  recommendation, or an offer to buy or sell any security. We are not a
                  registered investment advisor or broker-dealer.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">Paper Trading Only</h2>
                <p>
                  All "virtual positions," "autotrader" actions, and portfolio P&L on this
                  platform are <strong>simulated</strong>. No real orders are routed to any
                  broker or exchange. Live trading would involve slippage, commissions, taxes,
                  liquidity constraints, and emotional factors that simulations cannot fully
                  capture.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">Backtest Limitations</h2>
                <p>
                  Backtested performance is hypothetical. It benefits from hindsight, may
                  embed survivorship bias, and assumes execution conditions that real markets
                  often do not provide. Strategies that look profitable in a backtest can —
                  and frequently do — lose money in live trading.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">Data Reliability</h2>
                <p>
                  Market data is sourced from third parties (Finnhub, Yahoo Finance) and may
                  be delayed, incomplete, or inaccurate. Signals computed on faulty data will
                  themselves be faulty.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">Your Responsibility</h2>
                <p>
                  Before risking real capital you should: (1) consult a licensed financial
                  advisor; (2) understand the instruments you are trading; (3) only invest
                  capital you can afford to lose; and (4) test any strategy with your own
                  paper trading first.
                </p>
              </section>
            </article>
          </motion.div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default Disclosure;
