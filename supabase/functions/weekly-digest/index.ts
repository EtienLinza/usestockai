import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { requireCronOrUser } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireCronOrUser(req);
  if (denied) return denied;

  const startedAt = Date.now();
  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    if (!resendApiKey) {
      console.log("RESEND_API_KEY not configured, skipping digest");
      return new Response(
        JSON.stringify({ success: false, reason: "Email not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get users with weekly digest enabled
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("user_id, email, full_name")
      .eq("weekly_digest_enabled", true)
      .not("email", "is", null);

    if (profilesError) {
      throw new Error(`Failed to fetch profiles: ${profilesError.message}`);
    }

    if (!profiles || profiles.length === 0) {
      console.log("No users have weekly digest enabled");
      return new Response(
        JSON.stringify({ success: true, sent: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resend = new Resend(resendApiKey);

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    let sentCount = 0;

    for (const profile of profiles) {
      try {
        // Get user's predictions this week
        const { data: predictions } = await supabase
          .from("prediction_runs")
          .select("ticker, predicted_price, current_price, confidence, created_at")
          .eq("user_id", profile.user_id)
          .gte("created_at", oneWeekAgo.toISOString())
          .order("created_at", { ascending: false })
          .limit(10);

        // Get user's triggered alerts this week
        const { data: triggeredAlerts } = await supabase
          .from("price_alerts")
          .select("ticker, target_price, direction, triggered_at")
          .eq("user_id", profile.user_id)
          .eq("is_triggered", true)
          .gte("triggered_at", oneWeekAgo.toISOString());

        // Get user's watchlist count
        const { count: watchlistCount } = await supabase
          .from("watchlist")
          .select("*", { count: "exact", head: true })
          .eq("user_id", profile.user_id);

        const predictionsHtml = predictions && predictions.length > 0
          ? predictions.slice(0, 5).map(p => {
              const change = ((p.predicted_price - p.current_price) / p.current_price) * 100;
              return `
                <tr>
                  <td style="padding: 8px 0; font-family: monospace; color: #4a9d6e;">${p.ticker}</td>
                  <td style="padding: 8px 0; font-family: monospace;">$${p.current_price?.toFixed(2) || "—"}</td>
                  <td style="padding: 8px 0; font-family: monospace;">$${p.predicted_price.toFixed(2)}</td>
                  <td style="padding: 8px 0; color: ${change >= 0 ? "#22c55e" : "#ef4444"};">${change >= 0 ? "+" : ""}${change.toFixed(1)}%</td>
                </tr>
              `;
            }).join("")
          : `<tr><td colspan="4" style="padding: 16px 0; color: #666; text-align: center;">No predictions this week</td></tr>`;

        const alertsHtml = triggeredAlerts && triggeredAlerts.length > 0
          ? triggeredAlerts.map(a => `
              <li style="margin: 8px 0;">
                <span style="font-family: monospace; color: #4a9d6e;">${a.ticker}</span> hit 
                $${a.target_price.toFixed(2)} (${a.direction})
              </li>
            `).join("")
          : `<p style="color: #666;">No alerts triggered this week</p>`;

        await resend.emails.send({
          from: "StockAI <digest@resend.dev>",
          to: [profile.email],
          subject: `Your StockAI Weekly Digest`,
          html: `
            <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="color: #4a9d6e; margin: 0; font-size: 24px;">StockAI</h1>
                <p style="color: #666; margin: 8px 0 0 0;">Weekly Digest</p>
              </div>
              
              <p>Hi ${profile.full_name || "there"},</p>
              <p>Here's your weekly summary from StockAI:</p>
              
              <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="margin: 0 0 16px 0; color: #1a1a1a;">📊 Recent Predictions</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                  <thead>
                    <tr style="border-bottom: 1px solid #e5e5e5;">
                      <th style="text-align: left; padding: 8px 0; color: #666; font-weight: 500;">Ticker</th>
                      <th style="text-align: left; padding: 8px 0; color: #666; font-weight: 500;">Current</th>
                      <th style="text-align: left; padding: 8px 0; color: #666; font-weight: 500;">Predicted</th>
                      <th style="text-align: left; padding: 8px 0; color: #666; font-weight: 500;">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${predictionsHtml}
                  </tbody>
                </table>
              </div>
              
              <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h3 style="margin: 0 0 16px 0; color: #1a1a1a;">🔔 Triggered Alerts</h3>
                <ul style="margin: 0; padding-left: 20px;">
                  ${alertsHtml}
                </ul>
              </div>
              
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0;">
                <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; text-align: center;">
                  <div style="font-size: 24px; font-weight: 600; color: #4a9d6e;">${predictions?.length || 0}</div>
                  <div style="color: #666; font-size: 12px;">Predictions this week</div>
                </div>
                <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; text-align: center;">
                  <div style="font-size: 24px; font-weight: 600; color: #4a9d6e;">${watchlistCount || 0}</div>
                  <div style="color: #666; font-size: 12px;">Watchlist items</div>
                </div>
              </div>
              
              <div style="text-align: center; margin: 32px 0;">
                <a href="https://stockai.lovable.app/dashboard" 
                   style="display: inline-block; background: #4a9d6e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500;">
                  Open StockAI →
                </a>
              </div>
              
              <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5e5; text-align: center; color: #999; font-size: 12px;">
                <p>You're receiving this weekly digest because you have it enabled in your preferences.</p>
              </div>
            </div>
          `,
        });

        sentCount++;
        console.log(`Sent digest to ${profile.email}`);
      } catch (error) {
        console.error(`Failed to send digest to ${profile.email}:`, error);
      }
    }

    await recordHeartbeat("weekly-digest", startedAt, "ok", `sent=${sentCount}`);

    return new Response(
      JSON.stringify({ success: true, sent: sentCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Weekly digest error:", error);
    await recordHeartbeat(
      "weekly-digest",
      startedAt,
      "error",
      error instanceof Error ? error.message : "Unknown error",
    );
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});