import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, X, ArrowRight, ArrowLeft, User as UserIcon, CreditCard,
  Activity, Bot, Compass, SlidersHorizontal, Skull, Shield, Gauge, CheckCircle2,
} from "lucide-react";

export type TourSectionKey =
  | "account" | "billing" | "at-status" | "at-core"
  | "at-discovery" | "at-advanced" | "at-danger" | "risk" | "system";


interface Step {
  section: TourSectionKey | null;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  tip?: string;
}

const STEPS: Step[] = [
  {
    section: null,
    icon: Sparkles,
    title: "Welcome to Settings",
    body: "This is mission control for your account and the AutoTrader. We'll walk through each section in about 60 seconds.",
    tip: "You can exit anytime and restart from the 'Take tour' button.",
  },
  {
    section: "account",
    icon: UserIcon,
    title: "Profile",
    body: "Update your display name, email, and notification preferences. This is also where you can delete your account.",
  },
  {
    section: "billing",
    icon: CreditCard,
    title: "Plan & billing",
    body: "See your current tier, manage your subscription, and upgrade when you want more scans, alerts, and AutoTrader features.",
  },
  {
    section: "at-status",
    icon: Activity,
    title: "AutoTrader — Live status",
    body: "A real-time snapshot of what the bot is doing right now: last scan, next scan, VIX regime, SPY trend, and any adaptive adjustments.",
    tip: "Green = healthy. If you see warnings here, check Danger zone or System health.",
  },
  {
    section: "at-core",
    icon: Bot,
    title: "Core setup",
    body: "The essentials: turn the bot on, choose Paper or Live, pick a risk profile, and enable Adaptive mode so the system reacts to market regime.",
    tip: "Start in Paper mode until you trust the behavior.",
  },
  {
    section: "at-discovery",
    icon: Compass,
    title: "Watchlist discovery",
    body: "Let the bot auto-add promising tickers from the live signal feed. You control the conviction floor and how long stale tickers stick around.",
  },
  {
    section: "at-advanced",
    icon: SlidersHorizontal,
    title: "Advanced controls",
    body: "Fine-tune scan interval, conviction floor, position count, NAV exposure, single-name cap, daily loss limit, and rotation rules. Sensible defaults are already set.",
  },
  {
    section: "at-danger",
    icon: Skull,
    title: "Danger zone",
    body: "Kill switch and emergency modes. Use 'Freeze entries' to stop new buys or 'Liquidate' to flatten everything on the next scan.",
    tip: "This is your panic button — always available.",
  },
  {
    section: "risk",
    icon: Shield,
    title: "Portfolio risk caps",
    body: "Hard guardrails: per-sector concentration, portfolio beta ceiling, and max correlated positions. Choose 'warn' for nudges or 'block' to hard-stop violations.",
  },
  {
    section: "system",
    icon: Gauge,
    title: "System health",
    body: "Status of background jobs: market scanner, alert checks, cron tasks. If something looks off here, that's the first place to investigate.",
  },
  {
    section: null,
    icon: CheckCircle2,
    title: "You're set",
    body: "Don't forget to hit Save Settings at the bottom after any change. You can replay this tour anytime.",
  },
];

const STORAGE_KEY = "settings-tour-completed-v1";

interface Props {
  setActive: (k: TourSectionKey) => void;
  open: boolean;
  onClose: () => void;
}

export function SettingsTour({ setActive, open, onClose }: Props) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) return;
    const s = STEPS[step];
    if (s.section) setActive(s.section);
  }, [step, open, setActive]);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const finish = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
    onClose();
  };

  if (!open) return null;
  const s = STEPS[step];
  const Icon = s.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-background/60 backdrop-blur-sm flex items-end md:items-center justify-center p-4"
        onClick={finish}
      >
        <motion.div
          initial={{ y: 20, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0 }}
          transition={{ type: "spring", damping: 22, stiffness: 240 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md"
        >
          <Card variant="glow" className="p-5 space-y-4 relative">
            <button
              type="button"
              onClick={finish}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close tour"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <Badge variant="outline" className="text-[10px] mb-1">
                  Step {step + 1} of {STEPS.length}
                </Badge>
                <h3 className="text-base font-medium tracking-tight leading-tight">{s.title}</h3>
              </div>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">{s.body}</p>

            {s.tip && (
              <div className="text-xs text-primary/80 bg-primary/5 border border-primary/20 rounded-md px-3 py-2">
                💡 {s.tip}
              </div>
            )}

            {/* Progress */}
            <div className="flex gap-1">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    i <= step ? "bg-primary" : "bg-muted"
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={finish}>
                Skip
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStep((p) => Math.max(0, p - 1))}
                  disabled={step === 0}
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back
                </Button>
                {isLast ? (
                  <Button variant="default" size="sm" onClick={finish}>
                    Finish <CheckCircle2 className="w-3.5 h-3.5" />
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setStep((p) => Math.min(STEPS.length - 1, p + 1))}
                  >
                    Next <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function shouldAutoOpenSettingsTour(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "1";
  } catch {
    return false;
  }
}
