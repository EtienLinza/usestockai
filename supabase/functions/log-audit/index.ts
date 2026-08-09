import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Server-authoritative audit logging. Clients may only request one of these
// actions; user_id, timestamp and user_agent are derived server-side.
const ALLOWED_ACTIONS = new Set([
  "login",
  "password_change",
  "mfa_enabled",
  "mfa_disabled",
  "position_opened",
  "position_closed_manual",
  "autotrader_toggled",
  "settings_changed",
  "alert_created",
  "alert_deleted",
  "api_key_rotated",
  "account_deleted",
]);

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length === 0 ? null : s.slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Invalid body" }, 400);

    const action = clampStr((body as Record<string, unknown>).action, 64);
    if (!action || !ALLOWED_ACTIONS.has(action)) return json({ error: "Invalid action" }, 400);

    const targetType = clampStr((body as Record<string, unknown>).target_type, 64);
    const targetId = clampStr((body as Record<string, unknown>).target_id, 128);

    let metadata: Record<string, unknown> = {};
    const rawMeta = (body as Record<string, unknown>).metadata;
    if (rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)) {
      const serialized = JSON.stringify(rawMeta);
      if (serialized.length <= 4000) metadata = rawMeta as Record<string, unknown>;
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { error } = await admin.from("audit_log").insert([{
      user_id: userData.user.id,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 512) || null,
      ip_address: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || null,
    }]);

    if (error) {
      console.error("audit insert failed", error.message);
      return json({ error: "Could not record audit event" }, 500);
    }
    return json({ ok: true });
  } catch (e) {
    console.error("log-audit error", e);
    return json({ error: "Unexpected error" }, 500);
  }
});
