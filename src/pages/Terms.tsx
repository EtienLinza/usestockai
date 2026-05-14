import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";

const Terms = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title="Terms of Service | StockAI"
        description="StockAI terms of service governing use of the AI stock signals, backtesting, and paper-trading platform."
        path="/terms"
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
              <h1 className="text-4xl font-light tracking-tight">Terms of Service</h1>
              <p className="text-sm text-muted-foreground">Last updated: April 26, 2026</p>
            </header>

            <article className="prose prose-invert max-w-none space-y-6 text-muted-foreground leading-relaxed">
              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">1. Acceptance of Terms</h2>
                <p>
                  By accessing or using StockAI ("the Service"), you agree to be bound by these
                  Terms of Service. If you do not agree, do not use the Service.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">2. Not Financial Advice</h2>
                <p>
                  StockAI is a research, education, and paper-trading simulation platform. All
                  signals, scores, backtests, and analytics are provided for informational
                  purposes only and do not constitute investment advice, a recommendation, or
                  an offer to buy or sell any security.
                </p>
                <p>
                  You are solely responsible for your own investment decisions. Always consult
                  a licensed financial advisor before making any investment.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">3. Paper Trading Only</h2>
                <p>
                  StockAI does not execute real trades. The "virtual portfolio" and "autotrader"
                  features simulate trades using market data and do not involve a brokerage
                  account or real capital. No order is ever sent to any exchange or broker.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">4. No Warranty</h2>
                <p>
                  The Service is provided "as is" without warranties of any kind. We do not
                  guarantee the accuracy, timeliness, or completeness of any market data,
                  signal, or backtest result. Past performance — including backtested
                  performance — is not indicative of future results.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">5. Limitation of Liability</h2>
                <p>
                  To the maximum extent permitted by law, StockAI and its operators shall not
                  be liable for any direct, indirect, incidental, consequential, or punitive
                  damages — including but not limited to loss of profits, data, or goodwill —
                  arising from your use of the Service.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">6. User Accounts</h2>
                <p>
                  You are responsible for maintaining the confidentiality of your account
                  credentials and for all activity that occurs under your account.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">7. Acceptable Use</h2>
                <p>
                  You agree not to: (a) reverse-engineer or scrape the Service; (b) use the
                  Service to violate any law or third-party right; (c) abuse rate limits or
                  attempt to overload the infrastructure.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">8. Third-Party Data</h2>
                <p>
                  Market data is sourced from Finnhub, Yahoo Finance, and other providers and
                  is subject to their respective terms. We do not guarantee continued
                  availability of any data source.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">9. Changes to Terms</h2>
                <p>
                  We may update these Terms at any time. Continued use of the Service after
                  changes constitutes acceptance of the revised Terms.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">10. Contact</h2>
                <p>
                  Questions about these Terms can be directed to the project maintainer via
                  the Settings page.
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

export default Terms;
