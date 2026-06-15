import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/Logo";
import { SEO } from "@/components/SEO";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { toast } from "sonner";
import { Tier, TIER_PRICES, TIER_FEATURE_LIST } from "@/lib/tier-features";
import { Check, ArrowRight, Sparkles, Crown, TrendingUp, BarChart3, Bell, Bot } from "lucide-react";

const EXPERIENCE_OPTIONS = [
  { id: "beginner", label: "Beginner", desc: "Just getting started" },
  { id: "intermediate", label: "Intermediate", desc: "A few years in" },
  { id: "pro", label: "Pro", desc: "Trading is my craft" },
];

const FOCUS_OPTIONS = [
  { id: "signals", label: "AI signals", icon: TrendingUp },
  { id: "backtesting", label: "Backtesting strategies", icon: BarChart3 },
  { id: "portfolio", label: "Portfolio tracking", icon: Sparkles },
  { id: "alerts", label: "Price alerts", icon: Bell },
  { id: "automation", label: "Automated execution", icon: Bot },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { invalidate } = useTier();
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState("");
  const [experience, setExperience] = useState<string>("");
  const [focuses, setFocuses] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const { openCheckout, checkoutElement } = useStripeCheckout();

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth?mode=signup");
  }, [user, authLoading, navigate]);

  const toggleFocus = (id: string) => {
    setFocuses((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));
  };

  const finishOnboarding = async (chosenTier?: Tier) => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName || null,
        trading_experience: experience || null,
        focus_areas: focuses,
        tier_selected_at: new Date().toISOString(),
        onboarding_completed: true,
      })
      .eq("user_id", user.id);

    // Payments are paused. If the user picked (or previously requested) a
    // paid tier, record a waitlist entry instead of opening checkout.
    let pendingTier: Tier | null = null;
    try {
      const stashed = localStorage.getItem("pending_waitlist_tier") as Tier | null;
      if (stashed === "pro" || stashed === "elite") pendingTier = stashed;
    } catch {}
    const waitlistTier = chosenTier && chosenTier !== "free" ? chosenTier : pendingTier;
    if (waitlistTier) {
      await supabase.from("upgrade_waitlist").insert({
        user_id: user.id,
        requested_tier: waitlistTier,
        billing_cycle: "monthly",
      });
      try { localStorage.removeItem("pending_waitlist_tier"); } catch {}
    }

    setSaving(false);
    if (error) {
      toast.error("Could not save. Please try again.");
      return;
    }
    invalidate();
    if (waitlistTier) {
      toast.success(`You're on the ${waitlistTier === "elite" ? "Elite" : "Pro"} waitlist. Free preview unlocked.`);
    } else {
      toast.success("Welcome to StockAI");
    }
    navigate("/dashboard");
  };

  const steps = [
    {
      title: "Welcome to StockAI",
      subtitle: "Let's set up your account in 30 seconds.",
    },
    {
      title: "What brings you here?",
      subtitle: "Pick everything that fits — we'll tailor your dashboard.",
    },
    {
      title: "Choose your plan",
      subtitle: "Start free. Upgrade anytime.",
    },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO title="Get started — StockAI" description="Set up your StockAI account." path="/onboarding" />

      <header className="border-b border-border/30 py-4">
        <div className="container mx-auto px-6 flex items-center justify-between">
          <Logo size="sm" />
          <div className="flex items-center gap-2">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${i <= step ? "w-8 bg-primary" : "w-4 bg-muted"}`}
              />
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center py-12 px-6">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <div className="text-center mb-8">
                <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-2">
                  {steps[step].title}
                </h1>
                <p className="text-muted-foreground">{steps[step].subtitle}</p>
              </div>

              {step === 0 && (
                <Card className="p-8 space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Your name</Label>
                    <Input
                      id="name"
                      placeholder="Jane Doe"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Trading experience</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {EXPERIENCE_OPTIONS.map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => setExperience(opt.id)}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            experience === opt.id
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-border/80"
                          }`}
                        >
                          <div className="text-sm font-medium">{opt.label}</div>
                          <div className="text-xs text-muted-foreground">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button className="w-full" onClick={() => setStep(1)} disabled={!experience}>
                    Continue <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </Card>
              )}

              {step === 1 && (
                <Card className="p-8 space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {FOCUS_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const selected = focuses.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          onClick={() => toggleFocus(opt.id)}
                          className={`p-4 rounded-lg border flex items-center gap-3 transition-all ${
                            selected ? "border-primary bg-primary/5" : "border-border hover:border-border/80"
                          }`}
                        >
                          <Icon className={`w-5 h-5 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                          <span className="text-sm font-medium">{opt.label}</span>
                          {selected && <Check className="w-4 h-4 text-primary ml-auto" />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
                    <Button className="flex-1" onClick={() => setStep(2)} disabled={focuses.length === 0}>
                      Continue <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </Card>
              )}

              {step === 2 && (
                <>
                  <div className="grid md:grid-cols-3 gap-4">
                    {(["free", "pro", "elite"] as Tier[]).map((t) => {
                      const Icon = t === "elite" ? Crown : Sparkles;
                      const popular = t === "pro";
                      return (
                        <Card
                          key={t}
                          className={`p-5 flex flex-col relative ${
                            popular ? "border-primary/50 shadow-[0_0_40px_-15px_hsl(var(--primary))]" : ""
                          }`}
                        >
                          {popular && (
                            <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px]">Popular</Badge>
                          )}
                          <div className="flex items-center gap-2 mb-1">
                            <Icon className="w-4 h-4 text-primary" />
                            <span className="font-medium capitalize">{t}</span>
                          </div>
                          <div className="flex items-baseline gap-1 mb-4">
                            <span className="text-3xl font-light">${TIER_PRICES[t].monthly}</span>
                            <span className="text-xs text-muted-foreground">/mo</span>
                          </div>
                          <ul className="space-y-1.5 mb-5 flex-1">
                            {TIER_FEATURE_LIST[t].slice(0, 4).map((f) => (
                              <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                                <Check className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                                <span>{f}</span>
                              </li>
                            ))}
                          </ul>
                          {t === "free" ? (
                            <Button
                              className="w-full"
                              variant={popular ? "default" : "outline"}
                              onClick={() => finishOnboarding()}
                              disabled={saving}
                            >
                              Continue on Free
                            </Button>
                          ) : (
                            <Button
                              className="w-full"
                              variant={popular ? "default" : "outline"}
                              onClick={() => finishOnboarding(t)}
                              disabled={saving}
                            >
                              Start with {t === "pro" ? "Pro" : "Elite"}
                            </Button>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                  <div className="text-center mt-6">
                    <button
                      onClick={() => finishOnboarding()}
                      className="text-sm text-muted-foreground hover:text-foreground underline"
                      disabled={saving}
                    >
                      Skip — I'll choose later
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {checkoutElement}
    </div>
  );
}
