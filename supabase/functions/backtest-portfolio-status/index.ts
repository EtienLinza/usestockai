// Read-only status endpoint for portfolio backtest jobs.
// GET ?job_id=... returns the current row (RLS ensures owner-only).
// Optional ?omit_state=1 skips the (potentially large) state blob so the
// polling UI stays cheap. Returns the full report once done.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const url = new URL(req.url);
    const jobId = url.searchParams.get("job_id");
    const omitState = url.searchParams.get("omit_state") === "1";
    const list = url.searchParams.get("list") === "1";

    if (list) {
      const { data, error } = await supabase
        .from("backtest_portfolio_jobs")
        .select("id,name,universe,start_date,end_date,starting_nav,status,stage,progress_pct,current_step_note,cpu_ms_spent,created_at,finished_at,error")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return new Response(JSON.stringify({ jobs: data ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!jobId) {
      return new Response(JSON.stringify({ error: "job_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cols = omitState
      ? "id,name,universe,start_date,end_date,starting_nav,status,stage,progress_pct,current_step_note,cpu_ms_spent,created_at,finished_at,error,report"
      : "*";
    const { data, error } = await supabase
      .from("backtest_portfolio_jobs")
      .select(cols)
      .eq("id", jobId)
      .single();
    if (error) throw error;
    return new Response(JSON.stringify({ job: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: m }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
