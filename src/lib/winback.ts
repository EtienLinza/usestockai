import { WINBACK_DELAY_MS } from "@/lib/paywall";

/** The offer stays visible for this long after it is first shown. */
export const WINBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WinbackInput {
  tier: string;
  paywallDismissedAt: string | null;
  winbackShownAt: string | null;
  dismissedLocally: boolean;
  now: number;
}

/**
 * Single, time-boxed win-back moment: free users who declined the onboarding
 * paywall at least 24h ago, shown once, visible for 24h, never again after a
 * dismissal.
 */
export function winbackState(i: WinbackInput): { show: boolean; expiresAt: number | null; firstShow: boolean } {
  const no = { show: false, expiresAt: null, firstShow: false };
  if (i.tier !== "free" || !i.paywallDismissedAt || i.dismissedLocally) return no;
  const dismissed = Date.parse(i.paywallDismissedAt);
  if (!Number.isFinite(dismissed) || i.now - dismissed < WINBACK_DELAY_MS) return no;
  if (!i.winbackShownAt) return { show: true, expiresAt: i.now + WINBACK_WINDOW_MS, firstShow: true };
  const shown = Date.parse(i.winbackShownAt);
  if (!Number.isFinite(shown)) return no;
  const expiresAt = shown + WINBACK_WINDOW_MS;
  return i.now < expiresAt ? { show: true, expiresAt, firstShow: false } : no;
}
