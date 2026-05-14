import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SEO } from "@/components/SEO";

const Privacy = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title="Privacy Policy | StockAI"
        description="How StockAI collects, uses, and protects your data across the AI signals and paper-trading platform."
        path="/privacy"
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
              <h1 className="text-4xl font-light tracking-tight">Privacy Policy</h1>
              <p className="text-sm text-muted-foreground">Last updated: April 26, 2026</p>
            </header>

            <article className="prose prose-invert max-w-none space-y-6 text-muted-foreground leading-relaxed">
              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">1. What We Collect</h2>
                <p>We collect only what is required to operate the Service:</p>
                <ul className="list-disc pl-6 space-y-1">
                  <li>Account data: email, full name, optional avatar URL.</li>
                  <li>App data: your watchlist, virtual positions, alerts, autotrader settings, and signal history.</li>
                  <li>Technical data: browser type, IP-based region (via the auth provider) for security and rate limiting.</li>
                </ul>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">2. How We Use It</h2>
                <ul className="list-disc pl-6 space-y-1">
                  <li>To run your account, render the dashboard, and send you alert emails you've opted into.</li>
                  <li>To compute signals, backtests, and analytics on your behalf.</li>
                  <li>To monitor system health and prevent abuse.</li>
                </ul>
                <p>We do not sell your personal data. We do not use it for advertising.</p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">3. Where Your Data Lives</h2>
                <p>
                  Account and app data are stored in our managed backend (Lovable Cloud,
                  powered by Supabase). Market data is fetched on demand from Finnhub and
                  Yahoo Finance. Email delivery is handled by Resend.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">4. Email Notifications</h2>
                <p>
                  Transactional alert emails (price alerts, sell alerts) are sent only when
                  you have an active alert configured. You can disable price-alert and weekly
                  digest emails at any time from Settings.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">5. Cookies & Local Storage</h2>
                <p>
                  We use cookies and local storage strictly for authentication session
                  management and theme preference. No third-party advertising or analytics
                  cookies are set.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">6. Your Rights</h2>
                <p>
                  You can request export or deletion of your account and associated data at
                  any time by contacting us through the Settings page. Account deletion
                  cascades to your watchlist, virtual positions, alerts, and settings.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">7. Security</h2>
                <p>
                  We use row-level security on every user table, JWT-based authentication, and
                  encrypted transport (HTTPS) end-to-end. No system is perfect — please use a
                  strong, unique password.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">8. Children</h2>
                <p>
                  StockAI is not intended for users under 18. We do not knowingly collect data
                  from minors.
                </p>
              </section>

              <section>
                <h2 className="text-foreground text-xl font-medium mb-2">9. Changes</h2>
                <p>
                  We may update this policy. Material changes will be communicated via the
                  Service or by email.
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

export default Privacy;
