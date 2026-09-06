// ============================================================================
// QUANT-DECISION — the only endpoint that turns a candidate into an order
// intent, and the only writer of the decision ledger.
//
// Every call is recorded (allowed or blocked) with score, expected edge,
// proposed vs approved size, block reasons, and feature provenance, so any
// decision can be replayed later.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { withAuth } from "../_shared/function-auth.ts";
import { createOrderIntent } from "../_shared/quant-decision-gateway.ts";
import { RISK_KERNEL_VERSION, type PortfolioRiskState } from "../_shared/risk-kernel.ts";
import type { DecisionMode, PortfolioCandidate, RiskLimits } from "../_shared/quant-contracts.ts";

function isMode(value: unknown): value is DecisionMode {
  return value === "shadow" || value === "paper" || value === "live" || value === "backtest";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

serve(withAuth("quant-decision", async (req, { userId, cors }) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const mode = body?.mode;
    if (!isMode(mode)) return json({ error: "mode must be shadow, paper, live, or backtest" }, 400);
    if (!body?.candidate || !body?.state || !body?.limits) {
      return json({ error: "candidate, state, and limits are required" }, 400);
    }

    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCron = Boolean(cronSecret && req.headers.get("x-cron-secret") === cronSecret);
    // Live intents may only be produced by the cron-controlled execution path.
    if (mode === "live" && !isCron) return json({ error: "Live intents require the automated execution path" }, 403);

    const candidate = body.candidate as PortfolioCandidate;
    const state = body.state as PortfolioRiskState;
    const limits = body.limits as RiskLimits;
    const now = typeof body.now === "string" ? body.now : new Date().toISOString();
    const ownerId = userId ?? (isCron && typeof body.userId === "string" ? body.userId : null);

    const result = createOrderIntent({
      candidate,
      mode,
      now,
      limitPrice: numberOrNull(body.limitPrice),
      maxSlippageBps: numberOrNull(body.maxSlippageBps) ?? 50,
      timeInForce: body.timeInForce,
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
    }, state, limits);

    const risk = result.intent?.risk ?? {
      allowed: false,
      approvedNotionalDollars: 0,
      approvedRiskPct: 0,
      reasons: result.blockedReasons,
      evaluatedAt: now,
      limitsVersion: RISK_KERNEL_VERSION,
    };

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const signal = candidate.signal;
    const { data: logged, error: logError } = await admin.from("quant_decision_log").insert({
      user_id: ownerId,
      experiment_id: typeof body.experimentId === "string" ? body.experimentId : null,
      intent_id: result.intent?.intentId ?? null,
      signal_id: signal.signalId,
      ticker: signal.ticker,
      side: signal.side,
      sleeve: signal.sleeve,
      mode,
      decision_at: signal.decisionAt,
      generated_at: signal.generatedAt,
      model_version: signal.modelVersion,
      feature_set_version: signal.featureSetVersion,
      raw_score: signal.rawScore,
      calibrated_probability: signal.calibratedProbability,
      expected_net_edge_pct: candidate.economics?.expectedNetEdgePct ?? null,
      proposed_notional: Math.max(0, Number(candidate.proposedNotionalDollars) || 0),
      approved_notional: risk.approvedNotionalDollars,
      approved_risk_pct: risk.approvedRiskPct,
      allowed: risk.allowed,
      block_reasons: risk.reasons,
      provenance: (signal.features ?? []).flatMap((feature) => feature.provenance ?? []),
    }).select("id").maybeSingle();

    if (logError) return json({ error: "Decision was not persisted", detail: logError.message }, 500);

    return json({
      intent: result.intent,
      blockedReasons: result.blockedReasons,
      decisionId: logged?.id ?? null,
      mode,
      audit: { signalId: signal.signalId, evaluatedAt: risk.evaluatedAt, limitsVersion: risk.limitsVersion },
    });
  } catch (error) {
    console.error("quant-decision error", error);
    return json({ error: error instanceof Error ? error.message : "Invalid request" }, 400);
  }
}));
