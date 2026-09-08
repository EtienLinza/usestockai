import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Logo } from "@/components/Logo";
import { SEO } from "@/components/SEO";
import { Paywall } from "@/components/Paywall";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { toast } from "sonner";
import { Tier, TIER_PRICES } from "@/lib/tier-features";
import { track } from "@/lib/analytics";
import {
  PAYMENTS_ENABLED,
  PRIMARY_GOALS,
  EXPERIENCE_LEVELS,
  FOCUS_AREAS,
  PrimaryGoal,
  ExperienceLevel,
  BillingCycle,
  recommendTier,
  riskProfileFor,
} from "@/lib/paywall";
import {
  Check,
  ArrowRight,
  Sprout,
  TrendingUp,
  Zap,
  Target,
  Lightbulb,
  BarChart3,
  Briefcase,
  Bot,
  Lock,
  Loader2,
} from "lucide-react";

type PaidTier = Exclude<Tier, "free">;

/** 0 welcome · 1 experience · 2 goal · 3 focus · 4 disclosure · 5 loader · 6 reveal · 7 paywall */
type Screen = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
const DOT_SCREENS: Screen[] = [1, 2, 3, 4, 5, 6];

const EXPERIENCE_ICONS = { starting: Sprout, sometimes: TrendingUp, active: Zap, professional: Target } as const;
const GOAL_ICONS = { ideas: Lightbulb, validate: BarChart3, watch: Briefcase, automate: Bot } as const;

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { invalidate } = useTier();
  const { openCheckout } = useStripeCheckout();

  const [screen, setScreen] = useState<Screen>(0);
  const [fullName, setFullName] = useState("");
  const [experience, setExperience] = useState<ExperienceLevel | null>(null);
  const [goal, setGoal] = useState<PrimaryGoal | null>(null);
  const [focuses, setFocuses] = useState<string[]>([]);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signalCount, setSignalCount] = useState<number | null>(null);
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth?mode=signup");
  }, [user, authLoading, navigate]);

  useEffect(() => {
    track("onboarding_started");
  }, []);

  useEffect(() => {
    supabase
      .from("live_signals")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => setSignalCount(count ?? 0));
  }, []);

  const recommendedTier = recommendTier(goal, experience);

  const advance = (next: Screen, stepValue?: unknown) => {
    track("onboarding_step_completed", { step: screen, value: stepValue ?? null });
    setScreen(next);
  };

  const toggleFocus = (id: string) =>
    setFocuses((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));

  const saveProfile = useCallback(
    async (extra: Record<string, unknown> = {}) => {
      if (!user) return { error: new Error("no user") };
      const payload = {
        full_name: fullName || null,
        trading_experience: experience,
        primary_goal: goal,
        focus_areas: focuses,
        paywall_recommended_tier: recommendedTier,
        disclosure_accepted_at: disclosureAccepted ? new Date().toISOString() : null,
        tier_selected_at: new Date().toISOString(),
        onboarding_completed: true,
        onboarding_completed_at: new Date().toISOString(),
        ...extra,
      };
      return supabase.from("profiles").update(payload).eq("user_id", user.id);
    },
    [user, fullName, experience, goal, focuses, recommendedTier, disclosureAccepted],
  );

  const finish = async (
    chosen: PaidTier | null,
    cycle: BillingCycle = "monthly",
    trial = false,
  ) => {
    if (!user) return;
    setSaving(true);

    // Anything the user asked for before signing up (e.g. from /tier/pro).
    let pendingTier: PaidTier | null = null;
    try {
      const stashed = localStorage.getItem("pending_waitlist_tier");
      if (stashed === "pro" || stashed === "elite") pendingTier = stashed;
    } catch (e) {
      console.warn("pending_waitlist_tier read failed", e);
    }
    const wantedTier = chosen ?? pendingTier;

    const { error } = await saveProfile(
      wantedTier ? {} : { paywall_dismissed_at: new Date().toISOString() },
    );
    if (error) {
      setSaving(false);
      toast.error("Could not save. Please try again.");
      return;
    }

    if (wantedTier && PAYMENTS_ENABLED) {
      // Layer B — real checkout.
      track("paywall_checkout_started", { tier: wantedTier, cycle, trial });
      const priceId =
        cycle === "annual" ? TIER_PRICES[wantedTier].annualPriceId : TIER_PRICES[wantedTier].monthlyPriceId;
      setSaving(false);
      invalidate();
      openCheckout({
        priceId: priceId ?? `${wantedTier}_monthly`,
        customerEmail: user.email ?? undefined,
        userId: user.id,
        returnUrl: `${window.location.origin}/checkout/return`,
      });
      return;
    }

    if (wantedTier) {
      // Layer A — waitlist.
      await supabase.from("upgrade_waitlist").insert({
        user_id: user.id,
        requested_tier: wantedTier,
        billing_cycle: cycle,
      });
      track("waitlist_joined", { tier: wantedTier, cycle });
      try {
        localStorage.removeItem("pending_waitlist_tier");
      } catch (e) {
        console.warn("pending_waitlist_tier clear failed", e);
      }
    } else {
      track("paywall_dismissed", { recommended_tier: recommendedTier });
    }

    track("onboarding_completed", { total_time_ms: Date.now() - startedAt.current });
    setSaving(false);
    invalidate();
    toast.success(
      wantedTier
        ? `You're on the ${wantedTier === "elite" ? "Elite" : "Pro"} list. Free preview unlocked.`
        : "Welcome to StockAI",
    );
    navigate("/dashboard");
  };

  const dotIndex = DOT_SCREENS.indexOf(screen);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SEO title="Get started — StockAI" description="Set up your StockAI account." path="/onboarding" noindex />

      <header className="border-b border-border/30 py-4">
        <div className="container mx-auto px-6 flex items-center justify-between">
          <Logo size="sm" />
          {dotIndex >= 0 && (
            <div className="flex items-center gap-2" aria-label={`Step ${dotIndex + 1} of ${DOT_SCREENS.length}`}>
              {DOT_SCREENS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i <= dotIndex ? "w-8 bg-primary" : "w-4 bg-muted"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center py-12 px-6">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={screen}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {screen === 0 && (
                <div className="text-center">
                  <ConfidenceSweep />
                  <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-2">Welcome to StockAI.</h1>
                  <p className="text-muted-foreground mb-8">
                    Let's calibrate your signal feed. Two minutes, then you're in.
                  </p>
                  <Card className="p-6 space-y-5 text-left">
                    <div className="space-y-2">
                      <Label htmlFor="name">Your name</Label>
                      <Input
                        id="name"
                        placeholder="Jane Doe"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </div>
                    <Button className="w-full" onClick={() => advance(1)}>
                      Get started <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </Card>
                </div>
              )}

              {screen === 1 && (
                <>
                  <ScreenHeading title="How would you describe yourself as a trader?" />
                  <Card className="p-6 space-y-3">
                    {EXPERIENCE_LEVELS.map((opt) => {
                      const Icon = EXPERIENCE_ICONS[opt.id];
                      const selected = experience === opt.id;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => {
                            setExperience(opt.id);
                            track("onboarding_experience_selected", { level: opt.id });
                            setTimeout(() => advance(2, opt.id), 400);
                          }}
                          className={`w-full p-4 rounded-lg border flex items-center gap-3 text-left transition-all ${
                            selected ? "border-primary bg-primary/5" : "border-border hover:border-border/80"
                          }`}
                        >
                          <Icon className={`w-5 h-5 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                          <span>
                            <span className="block text-sm font-medium">{opt.label}</span>
                            <span className="block text-xs text-muted-foreground">{opt.desc}</span>
                          </span>
                          {selected && <Check className="w-4 h-4 text-primary ml-auto" />}
                        </button>
                      );
                    })}
                  </Card>
                </>
              )}

              {screen === 2 && (
                <>
                  <ScreenHeading
                    title="What's the #1 thing you want StockAI to do for you?"
                    subtitle="You can explore everything else later — this just tells us what to show you first."
                  />
                  <Card className="p-6 space-y-3">
                    {PRIMARY_GOALS.map((opt) => {
                      const Icon = GOAL_ICONS[opt.id];
                      const selected = goal === opt.id;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => {
                            setGoal(opt.id);
                            track("onboarding_goal_selected", { goal: opt.id });
                            setTimeout(() => advance(3, opt.id), 400);
                          }}
                          className={`w-full p-4 rounded-lg border flex items-center gap-3 text-left transition-all ${
                            selected ? "border-primary bg-primary/5" : "border-border hover:border-border/80"
                          }`}
                        >
                          <Icon className={`w-5 h-5 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                          <span>
                            <span className="block text-sm font-medium">{opt.label}</span>
                            <span className="block text-xs text-muted-foreground">{opt.desc}</span>
                          </span>
                          {selected && <Check className="w-4 h-4 text-primary ml-auto" />}
                        </button>
                      );
                    })}
                  </Card>
                </>
              )}

              {screen === 3 && (
                <>
                  <ScreenHeading
                    title="Anything else you want to keep an eye on?"
                    subtitle="Pick as many as you like."
                  />
                  <Card className="p-6 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {FOCUS_AREAS.filter((f) => !(goal === "automate" && f.id === "automation")).map((opt) => {
                        const selected = focuses.includes(opt.id);
                        return (
                          <button
                            key={opt.id}
                            onClick={() => toggleFocus(opt.id)}
                            className={`p-4 rounded-lg border flex items-center gap-3 transition-all ${
                              selected ? "border-primary bg-primary/5" : "border-border hover:border-border/80"
                            }`}
                          >
                            <span className="text-sm font-medium">{opt.label}</span>
                            {selected && <Check className="w-4 h-4 text-primary ml-auto" />}
                          </button>
                        );
                      })}
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => {
                        track("onboarding_focus_selected", { areas: focuses });
                        advance(4, focuses);
                      }}
                      disabled={focuses.length === 0}
                    >
                      Continue <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                    <div className="text-center">
                      <button
                        onClick={() => advance(4, [])}
                        className="text-sm text-muted-foreground hover:text-foreground underline"
                      >
                        Skip this
                      </button>
                    </div>
                  </Card>
                </>
              )}

              {screen === 4 && (
                <>
                  <ScreenHeading title="One important thing before we start." />
                  <Card className="p-6 space-y-6">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      StockAI's signals are generated by an AI model and are for research and education.
                      They are not personalized financial advice, and past signal performance doesn't
                      guarantee future results. You're always in control of what you trade.
                    </p>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <Checkbox
                        checked={disclosureAccepted}
                        onCheckedChange={(v) => setDisclosureAccepted(v === true)}
                        aria-label="I understand"
                      />
                      <span className="text-sm">
                        I understand.{" "}
                        <a
                          href="/disclosure"
                          target="_blank"
                          rel="noreferrer"
                          className="underline text-muted-foreground"
                        >
                          Full disclosure
                        </a>
                      </span>
                    </label>
                    <Button
                      className="w-full"
                      disabled={!disclosureAccepted}
                      onClick={() => {
                        track("onboarding_disclosure_accepted");
                        advance(5, true);
                      }}
                    >
                      I understand, continue
                    </Button>
                  </Card>
                </>
              )}

              {screen === 5 && (
                <CalibratingScreen
                  experienceLabel={
                    EXPERIENCE_LEVELS.find((e) => e.id === experience)?.label.toLowerCase() ?? "self-directed"
                  }
                  goalLabel={PRIMARY_GOALS.find((g) => g.id === goal)?.mirror ?? "your signals"}
                  riskProfile={riskProfileFor(experience)}
                  signalCount={signalCount}
                  onDone={() => setScreen(6)}
                />
              )}

              {screen === 6 && (
                <>
                  <ScreenHeading title="Your dashboard is ready." />
                  <Card className="p-6 space-y-6">
                    <DashboardTease signalCount={signalCount} />
                    <p className="text-sm text-muted-foreground text-center">
                      {focuses.length > 0 ? (
                        <>
                          <span className="text-foreground">
                            {FOCUS_AREAS.find((f) => f.id === focuses[0])?.label}
                          </span>
                          {focuses[1] && (
                            <>
                              {" and "}
                              <span className="text-foreground">
                                {FOCUS_AREAS.find((f) => f.id === focuses[1])?.label}
                              </span>
                            </>
                          )}{" "}
                          are set up. Here's what's live right now.
                        </>
                      ) : (
                        <>Your feed is calibrated. Here's what's live right now.</>
                      )}
                    </p>
                    <Button className="w-full" onClick={() => advance(7)}>
                      See my dashboard <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </Card>
                </>
              )}

              {screen === 7 && (
                <Paywall
                  primaryGoal={goal}
                  recommendedTier={recommendedTier}
                  busy={saving}
                  onChoose={(tier, cycle, trial) => finish(tier, cycle, trial)}
                  onContinueFree={() => finish(null)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function ScreenHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="text-center mb-8">
      <h1 className="text-2xl md:text-3xl font-light tracking-tight mb-2">{title}</h1>
      {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
    </div>
  );
}

/** Small confidence gauge sweeping 0 → 87%, previewing the product's own visual language. */
function ConfidenceSweep() {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1600);
      setValue(Math.round(87 * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const circumference = 2 * Math.PI * 34;
  return (
    <div className="flex justify-center mb-6">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 80 80" className="w-24 h-24 -rotate-90">
          <circle cx="40" cy="40" r="34" fill="none" strokeWidth="4" className="stroke-muted" />
          <circle
            cx="40"
            cy="40"
            r="34"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            className="stroke-primary"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - value / 100)}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-lg font-light">{value}%</div>
      </div>
    </div>
  );
}

function CalibratingScreen({
  experienceLabel,
  goalLabel,
  riskProfile,
  signalCount,
  onDone,
}: {
  experienceLabel: string;
  goalLabel: string;
  riskProfile: string;
  signalCount: number | null;
  onDone: () => void;
}) {
  const lines = [
    "Scanning 6,000+ tickers…",
    `Weighting signals for ${experienceLabel} traders…`,
    `Prioritizing ${goalLabel}…`,
    `Applying your ${riskProfile} risk profile…`,
  ];
  const [index, setIndex] = useState(0);
  const [scanned, setScanned] = useState(1204);

  useEffect(() => {
    const step = setInterval(() => setIndex((i) => Math.min(i + 1, lines.length)), 1200);
    const counter = setInterval(() => setScanned((n) => Math.min(6347, n + 137)), 60);
    const done = setTimeout(onDone, 5600);
    return () => {
      clearInterval(step);
      clearInterval(counter);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="p-8">
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-light tracking-tight mb-2">Calibrating your feed…</h1>
        <p className="text-muted-foreground text-sm tabular-nums">{scanned.toLocaleString()} tickers analysed</p>
      </div>
      <div className="space-y-3 max-w-md mx-auto">
        {lines.map((line, i) => (
          <motion.div
            key={line}
            initial={{ opacity: 0, y: 8 }}
            animate={i <= index ? { opacity: 1, y: 0 } : { opacity: 0.15, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-2 text-sm"
          >
            {i < index ? (
              <Check className="w-4 h-4 text-primary shrink-0" />
            ) : (
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
            )}
            <span>{line}</span>
          </motion.div>
        ))}
        {index >= lines.length && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-sm text-primary pt-2"
          >
            <Check className="w-4 h-4" />
            <span>{signalCount ?? 0} active signals ready for you</span>
          </motion.div>
        )}
      </div>
    </Card>
  );
}

/** Show-then-gate: the top of the feed is legible, the rest fades into a soft blur. */
function DashboardTease({ signalCount }: { signalCount: number | null }) {
  const rows = [
    { ticker: "NVDA", note: "Momentum breakout", conf: 88 },
    { ticker: "MSFT", note: "Trend continuation", conf: 81 },
    { ticker: "AMD", note: "Mean reversion", conf: 76 },
    { ticker: "COST", note: "Relative strength", conf: 72 },
  ];
  return (
    <div className="relative rounded-lg border border-border overflow-hidden">
      <div className="divide-y divide-border/40">
        {rows.map((r, i) => (
          <div
            key={r.ticker}
            className="flex items-center justify-between p-3"
            style={{ filter: i >= 2 ? `blur(${i === 2 ? 3 : 6}px)` : undefined, opacity: i >= 2 ? 0.7 : 1 }}
            aria-hidden={i >= 2}
          >
            <div>
              <div className="text-sm font-medium">{r.ticker}</div>
              <div className="text-xs text-muted-foreground">{r.note}</div>
            </div>
            <div className="text-sm text-primary tabular-nums">{r.conf}%</div>
          </div>
        ))}
      </div>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
        <span className="inline-flex items-center gap-1.5 text-xs rounded-full bg-background/90 border border-border px-3 py-1">
          <Lock className="w-3 h-3" /> {Math.max(0, (signalCount ?? 0) - 2)} more signals
        </span>
      </div>
    </div>
  );
}
