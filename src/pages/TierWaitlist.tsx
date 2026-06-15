import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SEO } from "@/components/SEO";
import { Tier, TIER_LABELS, TIER_PRICES, TIER_FEATURE_LIST } from "@/lib/tier-features";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Check, Sparkles, Crown, ArrowRight, Lock, Mail } from "lucide-react";

const VALID_TIERS: Tier[] = ["free", "pro", "elite"];

export default function TierWaitlist() {
  const { tier: rawTier } = useParams<{ tier: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email ?? "");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const tier: Tier = (VALID_TIERS as string[]).includes(rawTier ?? "")
    ? (rawTier as Tier)
    : "pro";
  const Icon = tier === "elite" ? Crown : Sparkles;
  const price = TIER_PRICES[tier].monthly;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Please enter a valid email.");
      return;
    }
    setLoading(true);
    // Stash intent so the onboarding flow can record the waitlist entry
    // after the user finishes verifying their email.
    try {
      localStorage.setItem("pending_waitlist_tier", tier);
    } catch {}

    if (user) {
      // Already signed in — record waitlist row directly and continue to onboarding.
      await supabase.from("upgrade_waitlist").insert({
        user_id: user.id,
        requested_tier: tier,
        billing_cycle: "monthly",
      });
      setLoading(false);
      toast.success("You're on the waitlist. Let's set up your account.");
      navigate("/onboarding");
      return;
    }

    // Anonymous: trigger magic-link signup. After confirmation the user
    // lands on /onboarding (RequireOnboarding handles the redirect).
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/onboarding`,
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Could not send confirmation email.");
      return;
    }
    setSubmitted(true);
  };

  const upsellTier: Tier | null =
    tier === "pro" ? "elite" : tier === "free" ? "pro" : null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO
        title={`${TIER_LABELS[tier]} waitlist — StockAI`}
        description={`Be the first to access the ${TIER_LABELS[tier]} plan when payments launch.`}
        path={`/tier/${tier}`}
      />
      <Navbar />

      <main className="flex-1 pt-20 md:pt-24 pb-24 md:pb-16">
        <div className="container mx-auto px-4 sm:px-6 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-10"
          >
            <Badge variant="outline" className="mb-4 inline-flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Payments paused
            </Badge>
            <div className="flex items-center justify-center gap-2 mb-3">
              <Icon className="w-5 h-5 text-primary" />
              <span className="text-xs uppercase tracking-wider text-primary font-medium">
                {TIER_LABELS[tier]} plan
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight mb-4">
              {tier === "elite"
                ? "Full automation, calibrated for you."
                : tier === "pro"
                ? "Built for active traders."
                : "Everything you need to start."}
            </h1>
            <p className="text-muted-foreground max-w-xl mx-auto">
              We're finalizing billing. Drop your email to lock in early-access
              pricing — your account is created instantly so you can preview the
              Free tier today.
            </p>
          </motion.div>

          <Card className="p-6 md:p-8 mb-8">
            <div className="flex items-baseline gap-2 mb-6">
              <span className="text-4xl font-light">${price}</span>
              <span className="text-sm text-muted-foreground">/mo · launch pricing</span>
            </div>
            <ul className="space-y-3 mb-8">
              {TIER_FEATURE_LIST[tier].map((f) => (
                <li key={f} className="flex items-start gap-3 text-sm">
                  <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <span className="text-foreground/90">{f}</span>
                </li>
              ))}
            </ul>

            {submitted ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-5 text-center">
                <Mail className="w-5 h-5 text-primary mx-auto mb-2" />
                <p className="text-sm">
                  Check your inbox for a confirmation link to finish setting up
                  your account.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-12"
                />
                <Button type="submit" className="w-full h-12" disabled={loading}>
                  {loading ? "Sending..." : `Join the ${TIER_LABELS[tier]} waitlist`}
                  {!loading && <ArrowRight className="w-4 h-4 ml-1" />}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  No charge today. We'll email you the moment {TIER_LABELS[tier]} unlocks.
                </p>
              </form>
            )}
          </Card>

          {upsellTier && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="text-center"
            >
              <p className="text-sm text-muted-foreground">
                Power users tend to prefer{" "}
                <Link
                  to={`/tier/${upsellTier}`}
                  className="text-primary hover:underline font-medium"
                >
                  {TIER_LABELS[upsellTier]}
                </Link>
                {" "}— same waitlist, every feature unlocked.
              </p>
            </motion.div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
