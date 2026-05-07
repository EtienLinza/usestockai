// One-time bootstrap: copies CRON_SECRET from edge env into Postgres vault
// so cron jobs can read it. Protected by CRON_SECRET itself.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cs = Deno.env.get("CRON_SECRET");
  if (!cs) return new Response(JSON.stringify({ error: "CRON_SECRET not set" }), { status: 500, headers: corsHeaders });
  if (req.headers.get("x-cron-secret") !== cs) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Upsert into vault via SQL
  const { error } = await supabase.rpc("sync_cron_secret_to_vault", { p_secret: cs });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
