import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { SEO } from "@/components/SEO";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { Tier, TIER_PRICES, FEATURE_LABELS, FEATURE_REQUIRES, TIER_RANK } from "@/lib/tier-features";
import { Check, X, Sparkles, Crown, ArrowRight } from "lucide-react";

const FAQS = [
  { q: "Can I cancel anytime?", a: "Yes. Plans are month-to-month or annual. Cancel anytime from Settings — you keep access through the end of your billing period." },
  { q: "Do you offer refunds?", a: "We offer a 14-day refund on annual plans, no questions asked. Monthly plans are non-refundable but can be cancelled at any time." },
  { q: "Is there a free trial?", a: "The Free plan is free forever and lets you test signals, watchlist and basic backtests. No credit card required." },
  { q: "What counts as a backtest?", a: "Each completed backtest run (any ticker, any timeframe) counts as one. Failed or aborted runs don't count against your monthly quota." },
  { q: "How does annual billing work?", a: "Annual plans are billed once per year and include 2 months free (you pay for 10, get 12)." },
];

const tiers: { id: Tier; name: string; tagline: string; popular?: boolean; icon: any }[] = [
  { id: "free", name: "Free", tagline: "Everything you need to start", icon: Sparkles },
  { id: "pro", name: "Pro", tagline: "For active traders", popular: true, icon: Sparkles },
  { id: "elite", name: "Elite", tagline: "Full automation & analytics", icon: Crown },
];

const featureRows: { label: string; values: Record<Tier, string | boolean> }[] = [
  { label: "Live AI signal feed", values: { free: true, pro: true, elite: true } },
  { label: "Watchlist & notes", values: { free: true, pro: true, elite: true } },
  { label: "Backtests / month", values: { free: "3", pro: "20", elite: "Unlimited" } },
  { label: "Tickers per backtest", values: { free: "1", pro: "3", elite: "10" } },
  { label: "Backtest window", values: { free: "1 year", pro: "10 years", elite: "25 years" } },
  { label: "Portfolio & P&L analytics", values: { free: false, pro: true, elite: true } },
  { label: "Price alerts + email", values: { free: false, pro: true, elite: true } },
  { label: "Monte Carlo simulation", values: { free: false, pro: true, elite: true } },
  { label: "Walk-forward analysis", values: { free: false, pro: true, elite: true } },
  { label: "Weekly performance digest", values: { free: false, pro: true, elite: true } },
  { label: "Robustness & stress tests", values: { free: false, pro: false, elite: true } },
  { label: "Calibration analytics", values: { free: false, pro: false, elite: true } },
  { label: "AutoTrader (automated execution)", values: { free: false, pro: false, elite: true } },
  { label: "Priority support", values: { free: false, pro: false, elite: true } },
];

export default function Pricing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tier: currentTier } = useTier();
  const [annual, setAnnual] = useState(false);
  const { openCheckout, checkoutElement } = useStripeCheckout();

  const handleCTA = (t: Tier) => {
    if (t === "free") {
      navigate(user ? "/dashboard" : "/auth?mode=signup");
      return;
    }
    if (!user) {
      navigate("/auth?mode=signup");
      return;
    }
    const priceId = annual ? TIER_PRICES[t].annualPriceId : TIER_PRICES[t].monthlyPriceId;
    if (!priceId) return;
    openCheckout({
      priceId,
      customerEmail: user.email,
      userId: user.id,
    });
  };

  const ctaLabel = (t: Tier) => {
    if (currentTier === t) return "Current plan";
    if (t === "free") return user ? "Continue on Free" : "Get started";
    const above = TIER_RANK[t] > TIER_RANK[currentTier];
    return above ? `Upgrade to ${t === "pro" ? "Pro" : "Elite"}` : `Switch to ${t === "pro" ? "Pro" : "Elite"}`;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title="Pricing — StockAI"
        description="Simple, transparent pricing for AI-powered stock signals, backtesting, and portfolio analytics. Free forever, Pro $29/mo, Elite $59/mo." path="/pricing"
      />
      <Navbar />

      <main className="flex-1 pt-24 pb-16">
        <div className="container mx-auto px-6 max-w-6xl">
          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <Badge variant="outline" className="mb-4">Pricing</Badge>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight mb-4">
              Simple pricing. Cancel anytime.
            </h1>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Start free. Upgrade when you're ready for portfolio analytics, alerts, and automation.
            </p>

            <div className="flex items-center justify-center gap-3 mt-8">
              <span className={!annual ? "text-foreground text-sm" : "text-muted-foreground text-sm"}>Monthly</span>
              <Switch checked={annual} onCheckedChange={setAnnual} />
              <span className={annual ? "text-foreground text-sm" : "text-muted-foreground text-sm"}>Annual</span>
              <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30">2 months free</Badge>
            </div>
          </motion.div>

          {/* Tier cards */}
          <div className="grid md:grid-cols-3 gap-6 mb-20">
            {tiers.map((t, i) => {
              const price = annual ? TIER_PRICES[t.id].annual : TIER_PRICES[t.id].monthly;
              const Icon = t.icon;
              const isCurrent = currentTier === t.id;
              return (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Card className={`p-6 h-full flex flex-col relative ${t.popular ? "border-primary/50 shadow-[0_0_40px_-15px_hsl(var(--primary))]" : ""}`}>
                    {t.popular && (
                      <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">
                        Most popular
                      </Badge>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="w-4 h-4 text-primary" />
                      <h3 className="text-lg font-medium">{t.name}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground mb-6">{t.tagline}</p>

                    <div className="mb-6">
                      <div className="flex items-baseline gap-1">
                        <span className="text-4xl font-light">${price}</span>
                        <span className="text-sm text-muted-foreground">/mo</span>
                      </div>
                      {annual && price > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Billed annually (${price * 12}/year)
                        </p>
                      )}
                    </div>

                    <ul className="space-y-2 mb-6 flex-1">
                      {(Object.keys(FEATURE_LABELS) as (keyof typeof FEATURE_LABELS)[])
                        .filter((f) => TIER_RANK[FEATURE_REQUIRES[f]] <= TIER_RANK[t.id])
                        .slice(0, 7)
                        .map((f) => (
                          <li key={f} className="flex items-start gap-2 text-sm">
                            <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                            <span className="text-muted-foreground">{FEATURE_LABELS[f]}</span>
                          </li>
                        ))}
                    </ul>

                    <Button
                      variant={t.popular ? "default" : "outline"}
                      className="w-full"
                      onClick={() => handleCTA(t.id)}
                      disabled={isCurrent}
                    >
                      {ctaLabel(t.id)}
                      {!isCurrent && <ArrowRight className="w-4 h-4 ml-1" />}
                    </Button>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {/* Comparison */}
          <div className="mb-20">
            <h2 className="text-2xl font-light text-center mb-8">Compare plans</h2>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 border-b border-border">
                    <tr>
                      <th className="text-left p-4 font-medium">Feature</th>
                      <th className="p-4 font-medium">Free</th>
                      <th className="p-4 font-medium text-primary">Pro</th>
                      <th className="p-4 font-medium">Elite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {featureRows.map((row) => (
                      <tr key={row.label} className="border-b border-border/40 last:border-0">
                        <td className="p-4 text-muted-foreground">{row.label}</td>
                        {(["free", "pro", "elite"] as Tier[]).map((t) => (
                          <td key={t} className="p-4 text-center">
                            {typeof row.values[t] === "boolean" ? (
                              row.values[t] ? (
                                <Check className="w-4 h-4 text-primary mx-auto" />
                              ) : (
                                <X className="w-4 h-4 text-muted-foreground/40 mx-auto" />
                              )
                            ) : (
                              <span className="text-foreground">{row.values[t]}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* FAQ */}
          <div className="max-w-2xl mx-auto mb-20">
            <h2 className="text-2xl font-light text-center mb-8">Frequently asked</h2>
            <Accordion type="single" collapsible className="w-full">
              {FAQS.map((f, i) => (
                <AccordionItem key={i} value={`item-${i}`}>
                  <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          {/* Final CTA */}
          <Card className="p-10 text-center bg-gradient-to-br from-primary/10 via-background to-background border-primary/20">
            <h2 className="text-2xl font-light mb-2">Start free. Upgrade when it pays for itself.</h2>
            <p className="text-muted-foreground mb-6">No credit card required for Free.</p>
            <Button size="lg" onClick={() => handleCTA("free")}>
              Get started — it's free
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Card>
        </div>
      </main>

      <Footer />

      {checkoutElement}
    </div>
  );
}
