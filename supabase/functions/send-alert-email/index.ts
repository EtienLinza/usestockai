import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { requireCronOrUser } from "../_shared/cron-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface AlertEmailRequest {
  userId: string;
  ticker: string;
  targetPrice: number;
  currentPrice: number;
  direction: "above" | "below";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireCronOrUser(req);
  if (denied) return denied;

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    
    if (!resendApiKey) {
      console.log("RESEND_API_KEY not configured, skipping email");
      return new Response(
        JSON.stringify({ success: false, reason: "Email not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { userId, ticker, targetPrice, currentPrice, direction }: AlertEmailRequest = await req.json();

    // Get user email from Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if user has email alerts enabled
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("email, alert_email_enabled")
      .eq("user_id", userId)
      .single();

    if (profileError || !profile) {
      console.error("Profile fetch error:", profileError);
      return new Response(
        JSON.stringify({ success: false, reason: "User profile not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!profile.alert_email_enabled) {
      console.log("Email alerts disabled for user");
      return new Response(
        JSON.stringify({ success: false, reason: "Email alerts disabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!profile.email) {
      console.log("No email address for user");
      return new Response(
        JSON.stringify({ success: false, reason: "No email address" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send email via Resend
    const resend = new Resend(resendApiKey);

    const directionText = direction === "above" ? "risen above" : "fallen below";
    const timestamp = new Date().toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/New_York",
    });

    const emailResponse = await resend.emails.send({
      from: "StockAI Alerts <alerts@resend.dev>",
      to: [profile.email],
      subject: `StockAI Alert: ${ticker} hit your target`,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #4a9d6e; margin: 0; font-size: 24px;">StockAI</h1>
          </div>
          
          <div style="background: #f8f9fa; border-radius: 8px; padding: 24px; margin-bottom: 24px;">
            <h2 style="margin: 0 0 16px 0; color: #1a1a1a;">
              ${ticker} has ${directionText} your target
            </h2>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div>
                <div style="color: #666; font-size: 12px; margin-bottom: 4px;">Target Price</div>
                <div style="font-size: 20px; font-weight: 600; font-family: monospace;">$${targetPrice.toFixed(2)}</div>
              </div>
              <div>
                <div style="color: #666; font-size: 12px; margin-bottom: 4px;">Current Price</div>
                <div style="font-size: 20px; font-weight: 600; font-family: monospace; color: ${direction === 'above' ? '#22c55e' : '#ef4444'};">$${currentPrice.toFixed(2)}</div>
              </div>
            </div>
            
            <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e5e5;">
              <div style="color: #666; font-size: 12px;">${timestamp} ET</div>
            </div>
          </div>
          
          <div style="text-align: center;">
            <a href="https://stockai.lovable.app/dashboard?ticker=${ticker}" 
               style="display: inline-block; background: #4a9d6e; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500;">
              View in StockAI →
            </a>
          </div>
          
          <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5e5; text-align: center; color: #999; font-size: 12px;">
            <p>You're receiving this because you set a price alert for ${ticker}.</p>
            <p>Manage your alerts in the StockAI Watchlist.</p>
          </div>
        </div>
      `,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailId: (emailResponse as any).data?.id || "sent" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Send alert email error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});