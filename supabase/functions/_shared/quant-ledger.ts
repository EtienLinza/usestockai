// ============================================================================
// QUANT-LEDGER — best-effort writer for the research decision ledger.
//
// Shadow logging must never be able to break a live scan: every write is
// fire-and-forget and swallows its own errors (including "table not found"
// before the migration has run).
// ============================================================================
import { RISK_KERNEL_VERSION } from "./risk-kernel.ts";

export const QUANT_LEDGER_MODEL_VERSION = `autotrader+${RISK_KERNEL_VERSION}`;
export const QUANT_LEDGER_FEATURE_SET_VERSION = "signal-engine-v2";

export interface QuantDecisionRecord {
  userId: string | null;
  ticker: string;
  side: "long" | "short";
  sleeve: string;
  mode: "shadow" | "paper" | "live" | "backtest";
  allowed: boolean;
  blockReasons?: string[];
  rawScore?: number | null;
  calibratedProbability?: number | null;
  expectedNetEdgePct?: number | null;
  proposedNotional?: number | null;
  approvedNotional?: number | null;
  approvedRiskPct?: number | null;
  signalId?: string;
  decisionAt?: string;
  generatedAt?: string;
  intentId?: string | null;
  provenance?: unknown[];
}

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const nonNegative = (value: unknown): number => Math.max(0, finite(value) ?? 0);

/** Convert a record into the ledger row shape. Exported for tests. */
export function toLedgerRow(record: QuantDecisionRecord, now = new Date().toISOString()) {
  const ticker = record.ticker.toUpperCase();
  return {
    user_id: record.userId,
    intent_id: record.intentId ?? null,
    signal_id: record.signalId ?? `${record.userId ?? "system"}:${ticker}:${now}`,
    ticker,
    side: record.side,
    sleeve: record.sleeve,
    mode: record.mode,
    decision_at: record.decisionAt ?? now,
    generated_at: record.generatedAt ?? record.decisionAt ?? now,
    model_version: QUANT_LEDGER_MODEL_VERSION,
    feature_set_version: QUANT_LEDGER_FEATURE_SET_VERSION,
    raw_score: finite(record.rawScore),
    calibrated_probability: finite(record.calibratedProbability),
    expected_net_edge_pct: finite(record.expectedNetEdgePct),
    proposed_notional: nonNegative(record.proposedNotional),
    approved_notional: nonNegative(record.approvedNotional),
    approved_risk_pct: nonNegative(record.approvedRiskPct),
    allowed: record.allowed,
    block_reasons: record.blockReasons ?? [],
    provenance: record.provenance ?? [],
  };
}

interface InsertableClient {
  from(table: string): { insert(row: unknown): PromiseLike<unknown> };
}

/**
 * Queue a ledger write. Pushes the settled promise onto `sink` when given so
 * the caller can drain writes at a natural checkpoint.
 */
export function queueQuantDecision(
  client: InsertableClient,
  record: QuantDecisionRecord,
  sink?: Promise<unknown>[],
): void {
  try {
    const p = Promise.resolve(client.from("quant_decision_log").insert(toLedgerRow(record)))
      .then(() => {}, (e: unknown) => {
        console.warn("quant_decision_log insert failed", e instanceof Error ? e.message : e);
      });
    if (sink) sink.push(p);
  } catch (e) {
    console.warn("quant_decision_log queue failed", e instanceof Error ? e.message : e);
  }
}
