import { Tier } from "@/lib/tier-features";

/**
 * Single switch for the whole monetization surface.
 * Layer A (false): plan CTAs write an `upgrade_waitlist` row.
 * Layer B (true): plan CTAs open Stripe checkout / start the trial.
 * Flipping this to `true` is the entire migration.
 */
export const PAYMENTS_ENABLED = false;

/** Trial length in days — inside the 17–32 day high-converting band. */
export const TRIAL_DAYS = 21;

export type BillingCycle = "monthly" | "annual";

export type PrimaryGoal = "ideas" | "validate" | "watch" | "automate";

export const PRIMARY_GOALS: {
  id: PrimaryGoal;
  label: string;
  desc: string;
  /** Short phrase mirrored back on the paywall headline. */
  mirror: string;
  recommends: Exclude<Tier, "free">;
}[] = [
  {
    id: "ideas",
    label: "Find trade ideas",
    desc: "Surface high-conviction signals I wouldn't have found myself",
    mirror: "finding trade ideas",
    recommends: "pro",
  },
  {
    id: "validate",
    label: "Validate my own ideas",
    desc: "Backtest strategies before I risk real money",
    mirror: "validating your own ideas",
    recommends: "pro",
  },
  {
    id: "watch",
    label: "Watch my positions",
    desc: "Track my portfolio, alerts, and risk in one place",
    mirror: "watching your positions",
    recommends: "pro",
  },
  {
    id: "automate",
    label: "Automate execution",
    desc: "Let the system trade a strategy for me",
    mirror: "automated execution",
    recommends: "elite",
  },
];

export type ExperienceLevel = "starting" | "sometimes" | "active" | "professional";

export const EXPERIENCE_LEVELS: {
  id: ExperienceLevel;
  label: string;
  desc: string;
  riskProfile: "conservative" | "balanced" | "aggressive";
}[] = [
  { id: "starting", label: "Just starting out", desc: "New to trading or investing", riskProfile: "conservative" },
  { id: "sometimes", label: "I trade sometimes", desc: "A few years in, self-directed", riskProfile: "balanced" },
  { id: "active", label: "I trade actively", desc: "Multiple trades per week", riskProfile: "balanced" },
  { id: "professional", label: "I'm a professional", desc: "This is my job or main income", riskProfile: "aggressive" },
];

export const FOCUS_AREAS: { id: string; label: string }[] = [
  { id: "signals", label: "AI signals" },
  { id: "backtesting", label: "Backtesting strategies" },
  { id: "portfolio", label: "Portfolio tracking" },
  { id: "alerts", label: "Price alerts" },
  { id: "automation", label: "Automated execution" },
];

export function goalMeta(goal: PrimaryGoal | null) {
  return PRIMARY_GOALS.find((g) => g.id === goal) ?? null;
}

/**
 * Which plan card gets the "Recommended for you" badge.
 * Goal drives it first; experience level breaks ties toward Elite for pros.
 */
export function recommendTier(
  goal: PrimaryGoal | null,
  experience: ExperienceLevel | null,
): Exclude<Tier, "free"> {
  if (goal) {
    const base = goalMeta(goal)!.recommends;
    if (base === "pro" && experience === "professional") return "elite";
    return base;
  }
  return experience === "professional" || experience === "active" ? "elite" : "pro";
}

export function riskProfileFor(experience: ExperienceLevel | null) {
  return EXPERIENCE_LEVELS.find((e) => e.id === experience)?.riskProfile ?? "balanced";
}

/** Win-back offer: shown once, 24h after the user declined the onboarding paywall. */
export const WINBACK_DELAY_MS = 24 * 60 * 60 * 1000;
export const WINBACK_DISMISS_KEY = "winback_dismissed";
