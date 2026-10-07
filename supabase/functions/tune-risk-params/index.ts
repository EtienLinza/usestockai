// TUNE-RISK-PARAMS — nightly per-user learner for Aggressive-mode numbers.
// Bounded: one pass over aggressive users, no AI calls, single-flight via
// cron_heartbeat recency. All math lives in _shared/adaptive-risk.ts.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronOrUser } from "../_shared/cron-auth.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { loadRiskParams, tuneRiskParams } from "../_shared/adaptive-risk.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const MAX_USERS = 50;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const denied = await requireCronOrUser(req);
  if (denied) return denied;
  const t0 = Date.now();
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const { data: hb } = await sb.from("cron_heartbeat").select("last_run_at,status")
      .eq("job_name", "tune-risk-params").maybeSingle();
    if (hb && hb.status === "running" && Date.now() - new Date(hb.last_run_at).getTime() < 10 * 60_000) {
      return new Response(JSON.stringify({ ok: true, skipped: "already running" }), { headers: cors });
    }
    await sb.from("cron_heartbeat").upsert({ job_name: "tune-risk-params", last_run_at: new Date().toISOString(), status: "running" });

    const { data: users } = await sb.from("autotrade_settings").select("user_id")
      .eq("risk_profile", "aggressive").limit(MAX_USERS);
    const since = new Date(Date.now() - 60 * 86400_000).toISOString();
    const out: any[] = [];
    for (const u of users ?? []) {
      const uid = (u as any).user_id;
      const prev = await loadRiskParams(sb, uid);
      const [{ data: pos }, { data: st }, { data: logs }] = await Promise.all([
        sb.from("virtual_positions").select("ticker,entry_price,exit_price,peak_price,entry_conviction,position_type,closed_at")
          .eq("user_id", uid).eq("status", "closed").gte("closed_at", since).limit(500),
        sb.from("autotrader_state").select("vix_regime").eq("user_id", uid).maybeSingle(),
        sb.from("autotrade_log").select("ticker,reason,created_at").eq("user_id", uid)
          .eq("action", "ENTRY").gte("created_at", since).limit(500),
      ]);
      const pnl: number[] = []; const mfe: number[] = []; const low: number[] = [];
      const pnlByTicker = new Map<string, number>();
      for (const p of (pos ?? []) as any[]) {
        const e = Number(p.entry_price), x = Number(p.exit_price);
        if (!(e > 0 && x > 0)) continue;
        const sign = p.position_type === "short" ? -1 : 1;
        const r = sign * (x - e) / e;
        pnl.push(r); pnlByTicker.set(p.ticker, r);
        if (r > 0 && Number(p.peak_price) > 0) mfe.push(Math.abs(Number(p.peak_price) - e) / e * 100);
        if ((p.entry_conviction ?? 100) < prev.min_conviction + 5) low.push(r);
      }
      const corrF: number[] = []; const atrF: number[] = [];
      for (const l of (logs ?? []) as any[]) {
        const r = pnlByTicker.get(l.ticker); if (r === undefined) continue;
        if (String(l.reason ?? "").includes("corr")) corrF.push(r);
        if (String(l.reason ?? "").includes("atr-ceiling")) atrF.push(r);
      }
      const dd = 0;
      const { params, reasons } = tuneRiskParams(prev, {
        closedPnlPct: pnl, winnerMfePct: mfe, lowConvPnlPct: low,
        vixRegime: (st as any)?.vix_regime ?? null, drawdownPct: dd,
        corrFlaggedPnl: corrF, atrFlaggedPnl: atrF,
      });
      await sb.from("adaptive_risk_params").upsert({
        user_id: uid, params, reasons, sample_size: pnl.length, computed_at: new Date().toISOString(),
      });
      out.push({ uid, n: pnl.length, reasons });
    }
    await recordHeartbeat("tune-risk-params", t0, "ok", `users=${out.length}`);
    return new Response(JSON.stringify({ ok: true, out }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await recordHeartbeat("tune-risk-params", t0, "error", m);
    return new Response(JSON.stringify({ error: m }), { status: 500, headers: cors });
  }
});
