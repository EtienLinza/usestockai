// Lightweight, fire-and-forget audit logger. Failures are swallowed —
// never block the user action they describe.
import { supabase } from "@/integrations/supabase/client";

export type AuditAction =
  | "login"
  | "password_change"
  | "mfa_enabled"
  | "mfa_disabled"
  | "position_opened"
  | "position_closed_manual"
  | "autotrader_toggled"
  | "settings_changed"
  | "alert_created"
  | "alert_deleted"
  | "api_key_rotated"
  | "account_deleted";

export async function logAudit(
  action: AuditAction,
  target?: { type?: string; id?: string },
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("audit_log").insert({
      user_id: user.id,
      action,
      target_type: target?.type ?? null,
      target_id: target?.id ?? null,
      metadata,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch (err) {
    console.warn("[audit] insert failed", err);
  }
}
