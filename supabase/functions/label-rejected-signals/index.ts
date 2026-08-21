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
// Must exceed the horizon in trading days (10 bars ≈ 14 calendar days) or every
// row gets skipped for lack of forward bars. 20 calendar days was too strict:
// the whole table is younger than that on any given night, so the labeler
// reported "nothing to label" forever. 15 days covers a 10-bar horizon plus a
// weekend, and partial-horizon pricing below handles the rest.
const MIN_AGE_DAYS = 15;
// Minimum forward bars we accept when the full horizon hasn't completed.
const MIN_FORWARD_BARS = 5;

// Only give up permanently once the row is too old for the data to ever arrive.
const ABANDON_AGE_DAYS = 60;

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
    // Newest-first. The calibrator only benefits from counterfactuals that
    // describe the gates as they behave *now*; an oldest-first sweep spent the
    // whole nightly budget on an ancient backlog and left every rejection from
    // the past week unlabeled, which is exactly what starved conviction
    // recalibration.
    const { data: rows, error } = await supabase
      .from("rejected_signals")
      .select("id, ticker, entry_price, horizon_bars, feature_snapshot, created_at")
      .is("labeled_at", null)
      .lte("created_at", cutoffIso)
      .order("created_at", { ascending: false })
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
    // Wall-clock budget: with the null-price filter removed the backlog is
    // thousands of rows, so stop cleanly and let the next nightly run continue.
    const BUDGET_MS = 110_000;
    let stoppedEarly = false;
    for (let i = 0; i < tickers.length; i += PAR) {
      if (Date.now() - started > BUDGET_MS) { stoppedEarly = true; break; }
      const slice = tickers.slice(i, i + PAR);

      const bars = await Promise.all(slice.map(t => fetchDailyHistory(t, "6mo").catch(() => null)));
      const updates: Array<{ id: string; row: Record<string, unknown> }> = [];

      const abandonBefore = Date.now() - ABANDON_AGE_DAYS * 24 * 3600 * 1000;
      const giveUp = (r: any) => new Date(r.created_at).getTime() < abandonBefore;

      slice.forEach((t, k) => {
        const d = bars[k];
        const items = byTicker.get(t)!;
        // NOTE: fetchDailyHistory returns `timestamps` as ISO yyyy-mm-dd
        // strings — not a numeric `timestamp` array. Reading the wrong field
        // made every row fall into the "data unavailable" branch, which is why
        // nothing was ever labeled.
        if (!d || d.close.length < 30 || !d.timestamps?.length) {
          // Data unavailable — retry next night unless the row is ancient.
          items.forEach(r => {
            skipped++;
            if (giveUp(r)) updates.push({ id: r.id, row: { labeled_at: new Date().toISOString() } });
          });
          return;
        }
        for (const r of items) {
          const horizon = Math.max(1, Math.min(60, Number(r.horizon_bars ?? 10)));
          const createdDay = String(r.created_at).slice(0, 10);
          // First bar strictly after the rejection date.
          const startIdx = d.timestamps.findIndex((ts: string) => ts > createdDay);
          const lastIdx = d.close.length - 1;
          const available = startIdx >= 0 ? lastIdx - startIdx : -1;

          if (startIdx < 0 || available < MIN_FORWARD_BARS) {
            // Not enough forward bars yet — leave unlabeled so we can price it
            // once they exist. Never mark labeled on a skip.
            skipped++;
            if (giveUp(r)) updates.push({ id: r.id, row: { labeled_at: new Date().toISOString() } });
            continue;
          }
          // Price against the full horizon when it has completed, otherwise
          // against however many bars exist (≥ MIN_FORWARD_BARS).
          const effHorizon = Math.min(horizon, available);
          const snap = (r.feature_snapshot ?? {}) as Record<string, unknown>;
          // Entry-price fallback chain: stored price → snapshot → the close on
          // the rejection day itself. Requiring a stored entry_price left ~94%
          // of the table (mostly earnings blackouts) permanently unlabelable.
          let entryPx = Number(r.entry_price);
          if (!Number.isFinite(entryPx) || entryPx <= 0) entryPx = Number(snap.entry_price);
          if (!Number.isFinite(entryPx) || entryPx <= 0) entryPx = Number(snap.last_close);
          if (!Number.isFinite(entryPx) || entryPx <= 0) entryPx = Number(d.close[Math.max(0, startIdx - 1)]);
          if (!Number.isFinite(entryPx) || entryPx <= 0) {
            skipped++;
            if (giveUp(r)) updates.push({ id: r.id, row: { labeled_at: new Date().toISOString() } });
            continue;
          }
          const side = snap.side === "short" ? -1 : 1;

          const atrPct = Number(snap.atr_pct) || 0.015;
          const stopMult = 1.0, targetMult = 1.0;
          const stopPx = side > 0 ? entryPx * (1 - atrPct * stopMult) : entryPx * (1 + atrPct * stopMult);
          const targetPx = side > 0 ? entryPx * (1 + atrPct * targetMult) : entryPx * (1 - atrPct * targetMult);

          let hitTarget = false, hitStop = false;
          for (let j = startIdx; j <= startIdx + effHorizon; j++) {
            const hi = d.high[j], lo = d.low[j];
            if (side > 0) {
              if (lo <= stopPx) { hitStop = true; break; }
              if (hi >= targetPx) { hitTarget = true; break; }
            } else {
              if (hi >= stopPx) { hitStop = true; break; }
              if (lo <= targetPx) { hitTarget = true; break; }
            }
          }
          const finalPx = d.close[startIdx + effHorizon];
          const rawRet = ((finalPx - entryPx) / entryPx) * 100 * side;

          updates.push({
            id: r.id,
            row: {
              entry_price: Math.round(entryPx * 10000) / 10000,
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
      `labeled=${labeled} skipped=${skipped} tickers=${tickers.length}${stoppedEarly ? " (budget hit — backlog continues next run)" : ""}`);

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
