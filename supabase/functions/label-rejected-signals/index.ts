// ============================================================================
// LABEL-REJECTED-SIGNALS — Milestone 4 counterfactual labeler.
//
// For every unlabeled row in `rejected_signals` older than `horizon_bars`
// trading days, fetch price history and compute what actually happened:
//   • counterfactual_return_pct — realized % move over the horizon (side-aware)
//   • counterfactual_hit_target — reached +1 ATR before -1 ATR
//   • counterfactual_hit_stop   — reached -1 ATR before +1 ATR
//
// Runs nightly. Batched, per-ticker so we hit Yahoo once per symbol. Feeds
// the "would-have-won" signal for future entry/meta-label training.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireCronOrUser } from "../_shared/cron-auth.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { fetchDailyHistory } from "../_shared/yahoo-history.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MAX_ROWS = 2000;
const MIN_AGE_DAYS = 8; // give the market time to play out (>= horizon)

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireCronOrUser(req);
  if (denied) return denied;

  const started = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const cutoffIso = new Date(Date.now() - MIN_AGE_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from("rejected_signals")
      .select("id, ticker, entry_price, horizon_bars, feature_snapshot, created_at")
      .is("labeled_at", null)
      .not("entry_price", "is", null)
      .lte("created_at", cutoffIso)
      .order("created_at", { ascending: true })
      .limit(MAX_ROWS);
    if (error) throw error;

    const pending = rows ?? [];
    if (pending.length === 0) {
      await recordHeartbeat("label-rejected-signals", started, "ok", "nothing to label");
      return new Response(JSON.stringify({ ok: true, labeled: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by ticker so each symbol is fetched once.
    const byTicker = new Map<string, typeof pending>();
    for (const r of pending) {
      const t = String(r.ticker).toUpperCase();
      (byTicker.get(t) ?? byTicker.set(t, []).get(t)!).push(r);
    }

    let labeled = 0, skipped = 0;
    const tickers = [...byTicker.keys()];
    const PAR = 8;
    for (let i = 0; i < tickers.length; i += PAR) {
      const slice = tickers.slice(i, i + PAR);
      const bars = await Promise.all(slice.map(t => fetchDailyHistory(t, "6mo").catch(() => null)));
      const updates: Array<{ id: string; row: Record<string, unknown> }> = [];

      slice.forEach((t, k) => {
        const d = bars[k];
        const items = byTicker.get(t)!;
        if (!d || d.close.length < 30 || !d.timestamp) {
          items.forEach(r => { skipped++; updates.push({ id: r.id, row: { labeled_at: new Date().toISOString() } }); });
          return;
        }
        for (const r of items) {
          const entryPx = Number(r.entry_price);
          const horizon = Math.max(1, Math.min(60, Number(r.horizon_bars ?? 10)));
          const createdMs = new Date(r.created_at).getTime();
          // Find first bar strictly after created_at.
          const startIdx = d.timestamp.findIndex((ts: number) => ts * 1000 > createdMs);
          if (startIdx < 0 || startIdx + horizon >= d.close.length) {
            skipped++; updates.push({ id: r.id, row: { labeled_at: new Date().toISOString() } });
            continue;
          }
          const snap = (r.feature_snapshot ?? {}) as Record<string, unknown>;
          const side = snap.side === "short" ? -1 : 1;
          const atrPct = Number(snap.atr_pct) || 0.015;
          const stopMult = 1.0, targetMult = 1.0;
          const stopPx = side > 0 ? entryPx * (1 - atrPct * stopMult) : entryPx * (1 + atrPct * stopMult);
          const targetPx = side > 0 ? entryPx * (1 + atrPct * targetMult) : entryPx * (1 - atrPct * targetMult);

          let hitTarget = false, hitStop = false;
          for (let j = startIdx; j <= startIdx + horizon; j++) {
            const hi = d.high[j], lo = d.low[j];
            if (side > 0) {
              if (lo <= stopPx) { hitStop = true; break; }
              if (hi >= targetPx) { hitTarget = true; break; }
            } else {
              if (hi >= stopPx) { hitStop = true; break; }
              if (lo <= targetPx) { hitTarget = true; break; }
            }
          }
          const finalPx = d.close[startIdx + horizon];
          const rawRet = ((finalPx - entryPx) / entryPx) * 100 * side;
          updates.push({
            id: r.id,
            row: {
              counterfactual_return_pct: Math.round(rawRet * 100) / 100,
              counterfactual_hit_target: hitTarget,
              counterfactual_hit_stop: hitStop,
              labeled_at: new Date().toISOString(),
            },
          });
          labeled++;
        }
      });

      // Batch update — Supabase has no bulk upsert-on-pk update, so chunk parallel.
      await Promise.all(updates.map(u =>
        supabase.from("rejected_signals").update(u.row).eq("id", u.id)
      ));
    }

    const ms = Date.now() - started;
    await recordHeartbeat("label-rejected-signals", started, "ok",
      `labeled=${labeled} skipped=${skipped} tickers=${tickers.length}`);
    return new Response(JSON.stringify({ ok: true, labeled, skipped, tickers: tickers.length, ms }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[label-rejected-signals] fatal:", msg);
    await recordHeartbeat("label-rejected-signals", started, "error", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
