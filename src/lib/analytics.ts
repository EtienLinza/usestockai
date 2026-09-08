import { supabase } from "@/integrations/supabase/client";

/**
 * Lightweight first-party event tracking. There is no third-party analytics
 * provider in this app, so events are stored in `product_events` (row-level
 * secured to the user who created them) and mirrored to the console in dev.
 * All writes are best-effort — analytics must never break a user flow.
 */
export type ProductEvent =
  | "onboarding_started"
  | "onboarding_step_completed"
  | "onboarding_experience_selected"
  | "onboarding_goal_selected"
  | "onboarding_focus_selected"
  | "onboarding_disclosure_accepted"
  | "onboarding_completed"
  | "paywall_viewed"
  | "paywall_trial_toggle_changed"
  | "paywall_plan_selected"
  | "paywall_checkout_started"
  | "paywall_checkout_completed"
  | "paywall_dismissed"
  | "waitlist_joined"
  | "winback_shown"
  | "winback_clicked"
  | "winback_dismissed"
  | "feature_gate_hit";

export async function track(
  event: ProductEvent,
  properties: Record<string, unknown> = {},
): Promise<void> {
  if (import.meta.env.DEV) console.debug("[event]", event, properties);
  try {
    const { data } = await supabase.auth.getUser();
    const userId = data.user?.id;
    if (!userId) return;
    await supabase.from("product_events").insert({
      user_id: userId,
      event,
      properties: properties as never,
    });
  } catch (e) {
    console.warn("analytics insert failed", e);
  }
}
