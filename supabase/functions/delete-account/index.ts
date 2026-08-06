// Permanently deletes the authenticated user's account and all associated data.
// Requires a valid user JWT. Uses the service role to call admin.deleteUser.
import { handleCors, jsonResponse } from "../_shared/http.ts";
import { adminClient, anonClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Verify the requester
    const userClient = anonClient(authHeader);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userId = userData.user.id;

    // Admin client deletes the auth user; ON DELETE CASCADE / triggers
    // (where present) clean child rows. We also best-effort delete profile.
    const admin = adminClient();

    // Best-effort cleanup of user-owned rows (no FK cascade on auth.users)
    const tables = [
      "watchlist",
      "price_alerts",
      "virtual_positions",
      "virtual_portfolio_log",
      "sell_alerts",
      "autotrade_settings",
      "autotrade_log",
      "autotrader_state",
      "portfolio_caps",
      "usage_counters",
      "upgrade_waitlist",
      "prediction_runs",
      "subscriptions",
      "profiles",
    ];
    await Promise.all(
      tables.map((t) =>
        admin.from(t).delete().eq("user_id", userId).then(() => null, () => null),
      ),
    );

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      return jsonResponse({ error: delErr.message }, 500);
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
