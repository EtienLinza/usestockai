import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Crown, Sparkles, ShieldCheck, Eye, ArrowLeft } from "lucide-react";
import {
  Tier,
  TIER_PRICES,
  TIER_LABELS,
  TIER_FEATURE_LIST,
  FEATURE_LABELS,
  FEATURE_REQUIRES,
  FeatureKey,
  tierMeets,
} from "@/lib/tier-features";
import {
  PAYMENTS_ENABLED,
  TRIAL_DAYS,
  BillingCycle,
  PrimaryGoal,
  goalMeta,
} from "@/lib/paywall";
import { track } from "@/lib/analytics";

type PaidTier = Exclude<Tier, "free">;

interface PaywallProps {
  primaryGoal: PrimaryGoal | null;
  recommendedTier: PaidTier;
  busy?: boolean;
  /** Called when a paid plan is chosen (trial start in Layer B, waitlist in Layer A). */
  onChoose: (tier: PaidTier, cycle: BillingCycle, trial: boolean) => void;
  /** Called for the honest, always-visible free exit. */
  onContinueFree: () => void;
}

const PAID_TIERS: PaidTier[] = ["pro", "elite"];
const ALL_TIERS: Tier[] = ["free", "pro", "elite"];
const FEATURE_ROWS = Object.keys(FEATURE_LABELS) as FeatureKey[];

export function Paywall({
  primaryGoal,
  recommendedTier,
  busy,
  onChoose,
  onContinueFree,
}: PaywallProps) {
  const [page, setPage] = useState<1 | 2>(1);
  const [trial, setTrial] = useState(true);
  const [cycles, setCycles] = useState<Record<PaidTier, BillingCycle>>({
    pro: "annual",
    elite: "annual",
  });

  useEffect(() => {
    track("paywall_viewed", { page, recommended_tier: recommendedTier });
  }, [page, recommendedTier]);

  const goal = goalMeta(primaryGoal);
  const ctaLabel = PAYMENTS_ENABLED
    ? trial
      ? `Start ${TRIAL_DAYS}-day free trial`
      : "Get started"
    : "Join the waitlist";

  const setCycle = (tier: PaidTier, cycle: BillingCycle) => {
    setCycles((prev) => ({ ...prev, [tier]: cycle }));
    track("paywall_plan_selected", { tier, cycle });
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      <AnimatePresence mode="wait">
        {page === 1 ? (
          <motion.div
            key="page-1"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <div className="text-center mb-8">
              <h1 className="text-2xl md:text-3xl font-light tracking-tight mb-2">
                {goal ? (
                  <>
                    Because you're focused on{" "}
                    <span className="text-primary">{goal.mirror}</span>, here's what unlocks.
                  </>
                ) : (
                  <>Here's what unlocks.</>
                )}
              </h1>
              <p className="text-muted-foreground text-sm">
                {PAYMENTS_ENABLED
                  ? `${TRIAL_DAYS} days free. Cancel anytime, one click.`
                  : "Payments are paused while we finish billing — join the list and keep full free access."}
              </p>
            </div>

            {PAYMENTS_ENABLED && (
              <div className="flex justify-center mb-6">
                <div
                  role="tablist"
                  aria-label="Purchase option"
                  className="inline-flex rounded-full border border-border p-1 bg-muted/30"
                >
                  {[
                    { id: true, label: "Free trial" },
                    { id: false, label: "Pay now, save 20%" },
                  ].map((opt) => (
                    <button
                      key={String(opt.id)}
                      role="tab"
                      aria-selected={trial === opt.id}
                      onClick={() => {
                        setTrial(opt.id);
                        track("paywall_trial_toggle_changed", { state: opt.id ? "trial" : "pay_now" });
                      }}
                      className={`px-4 py-1.5 text-sm rounded-full transition-all ${
                        trial === opt.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
              {PAID_TIERS.map((t) => {
                const Icon = t === "elite" ? Crown : Sparkles;
                const recommended = t === recommendedTier;
                const cycle = cycles[t];
                const price = cycle === "annual" ? TIER_PRICES[t].annual : TIER_PRICES[t].monthly;
                const alt = cycle === "annual" ? TIER_PRICES[t].monthly : TIER_PRICES[t].annual;
                return (
                  <Card
                    key={t}
                    className={`p-6 flex flex-col relative ${
                      recommended ? "border-primary/50 shadow-[0_0_40px_-15px_hsl(var(--primary))]" : ""
                    }`}
                  >
                    {recommended && (
                      <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap">
                        Recommended for you
                      </Badge>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="w-4 h-4 text-primary" />
                      <span className="font-medium">{TIER_LABELS[t]}</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-light">${price}</span>
                      <span className="text-xs text-muted-foreground">/mo</span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-4">
                      billed {cycle === "annual" ? "annually" : "monthly"} (or ${alt}/mo{" "}
                      {cycle === "annual" ? "monthly" : "annually"})
                    </div>

                    <div className="inline-flex self-start rounded-md border border-border p-0.5 mb-4">
                      {(["annual", "monthly"] as BillingCycle[]).map((c) => (
                        <button
                          key={c}
                          onClick={() => setCycle(t, c)}
                          className={`px-2.5 py-1 text-[11px] rounded transition-all capitalize ${
                            cycle === c ? "bg-primary/10 text-primary" : "text-muted-foreground"
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>

                    <ul className="space-y-1.5 mb-6 flex-1">
                      {TIER_FEATURE_LIST[t].map((f) => (
                        <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                          <Check className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>

                    <Button
                      className="w-full"
                      variant={recommended ? "default" : "outline"}
                      disabled={busy}
                      onClick={() => onChoose(t, cycle, trial && PAYMENTS_ENABLED)}
                    >
                      {ctaLabel}
                    </Button>
                  </Card>
                );
              })}
            </div>

            <div className="mt-6 grid sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                <span>Cancel anytime, one click — manage billing yourself from Settings.</span>
              </div>
              <div className="flex items-start gap-2">
                <Eye className="w-4 h-4 text-primary shrink-0" />
                <span>Signals are transparent — every one shows its full reasoning.</span>
              </div>
            </div>

            <div className="text-center mt-8 space-y-3">
              <button
                onClick={() => setPage(2)}
                className="text-sm text-muted-foreground hover:text-foreground underline"
              >
                Compare all plans
              </button>
              <div>
                <button
                  onClick={onContinueFree}
                  disabled={busy}
                  className="text-sm text-muted-foreground hover:text-foreground underline"
                >
                  Continue with Free →
                </button>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="page-2"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <button
              onClick={() => setPage(1)}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4"
            >
              <ArrowLeft className="w-4 h-4" /> Back to plans
            </button>

            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left font-medium p-3">Feature</th>
                    {ALL_TIERS.map((t) => (
                      <th key={t} className="p-3 font-medium text-center">
                        {TIER_LABELS[t]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_ROWS.map((key) => (
                    <tr key={key} className="border-b border-border/40 last:border-0">
                      <td className="p-3 text-muted-foreground">{FEATURE_LABELS[key]}</td>
                      {ALL_TIERS.map((t) => (
                        <td key={t} className="p-3 text-center">
                          {tierMeets(t, FEATURE_REQUIRES[key]) ? (
                            <Check className="w-4 h-4 text-primary mx-auto" aria-label="Included" />
                          ) : (
                            <span className="text-muted-foreground/60" aria-label="Not included">
                              —
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div className="mt-8 space-y-5">
              <div>
                <h3 className="text-sm font-medium mb-1">Is this financial advice?</h3>
                <p className="text-sm text-muted-foreground">
                  No. StockAI's signals are generated by an AI model for research and education only,
                  and past performance doesn't guarantee future results.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium mb-1">What happens after my trial?</h3>
                <p className="text-sm text-muted-foreground">
                  You're charged the plan price unless you cancel — we'll email you 2 days before,
                  no surprises.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium mb-1">Can I switch plans later?</h3>
                <p className="text-sm text-muted-foreground">
                  Anytime, from Settings. Upgrades apply immediately; downgrades apply next cycle.
                </p>
              </div>
            </div>

            <div className="sticky bottom-0 mt-8 -mx-1 px-1 py-4 bg-background/90 backdrop-blur border-t border-border/40">
              <Button
                className="w-full"
                disabled={busy}
                onClick={() => onChoose(recommendedTier, cycles[recommendedTier], trial && PAYMENTS_ENABLED)}
              >
                {ctaLabel} — {TIER_LABELS[recommendedTier]}
              </Button>
              <div className="text-center mt-3">
                <button
                  onClick={onContinueFree}
                  disabled={busy}
                  className="text-sm text-muted-foreground hover:text-foreground underline"
                >
                  Continue with Free →
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
