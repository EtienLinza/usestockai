// Start a portfolio-mode backtest job. Validates inputs, creates the job
// row, and fires the first tick asynchronously (fire-and-forget). Returns
// job_id so the client can start polling status immediately.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TICKER_RE = /^[A-Z]{1,10}(-[A-Z]{2,4})?$/;

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
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ELITE-ONLY GATE ─────────────────────────────────────────────────
    // Portfolio backtest is compute-heavy and reserved for Elite. Anon key
    // client can read the caller's own profile via RLS.
    const { data: prof } = await supabase
      .from("profiles").select("subscription_tier").eq("user_id", user.id).maybeSingle();
    if ((prof?.subscription_tier ?? "free") !== "elite") {
      return new Response(JSON.stringify({ error: "Portfolio backtest is an Elite-only feature." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const start_date = String(body?.start_date || "");
    const end_date = String(body?.end_date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      return new Response(JSON.stringify({ error: "start_date and end_date must be YYYY-MM-DD" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (start_date >= end_date) {
      return new Response(JSON.stringify({ error: "start_date must be before end_date" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── UNLIMITED MODE ──────────────────────────────────────────────────
    // Resolves the universe to every ticker that was a member of the target
    // index at any point inside [start_date, end_date]. No 250-ticker cap.
    // Time-accuracy is enforced downstream in the simulator via the
    // constituents effective_from/effective_to windows.
    const unlimited = Boolean(body?.unlimited);
    const indexName = typeof body?.index_name === "string" ? body.index_name : "SP500";
    let universe: string[] = [];
    if (unlimited) {
      const { data: rows, error: histErr } = await service
        .from("historical_constituents")
        .select("ticker")
        .eq("index_name", indexName)
        .lte("effective_from", end_date)
        .or(`effective_to.is.null,effective_to.gt.${start_date}`);
      if (histErr) throw histErr;
      universe = Array.from(new Set((rows ?? []).map((r: any) => String(r.ticker).toUpperCase())));
      if (universe.length === 0) {
        return new Response(JSON.stringify({ error: `No constituents found for index ${indexName} in that date range.` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      universe = Array.isArray(body?.universe)
        ? body.universe.map((s: string) => String(s).toUpperCase().trim()).filter(Boolean)
        : [];
      const bad = universe.filter(t => !TICKER_RE.test(t));
      if (universe.length === 0 || bad.length > 0) {
        return new Response(JSON.stringify({
          error: `Invalid universe. ${bad.length ? "Bad tickers: " + bad.slice(0, 5).join(", ") : "Empty."}`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (universe.length > 250) {
        return new Response(JSON.stringify({ error: "Universe capped at 250 tickers per job. Use Unlimited mode for the full index." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const starting_nav = Number(body?.starting_nav ?? 100_000);
    if (!Number.isFinite(starting_nav) || starting_nav < 1_000 || starting_nav > 100_000_000) {
      return new Response(JSON.stringify({ error: "starting_nav must be between $1k and $100M" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const name = typeof body?.name === "string" ? body.name.slice(0, 120) : null;
    const rawParams = body?.params && typeof body.params === "object" ? body.params : {};
    // Attach index_name so the tick worker can enforce time-accurate membership.
    const params = unlimited ? { ...rawParams, index_name: indexName, unlimited: true } : rawParams;

    const { data: job, error } = await service
      .from("backtest_portfolio_jobs")
      .insert({
        user_id: user.id,
        name,
        universe: Array.from(new Set(universe)),
        start_date,
        end_date,
        starting_nav,
        params,
        status: "queued",
        stage: "fetch_bars",
        cursor: { tickerIdx: 0, dayIdx: 0 },
        state: {},
      })
      .select("id")
      .single();
    if (error || !job) throw error ?? new Error("Insert failed");


    // Fire first tick — don't await.
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/backtest-portfolio-tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
      body: JSON.stringify({ job_id: job.id }),
    }).catch(() => {});

    return new Response(JSON.stringify({ job_id: job.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: m }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
