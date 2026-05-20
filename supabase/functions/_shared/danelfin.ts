// ============================================================================
// DANELFIN CLIENT — fetches the daily Danelfin AI Score for a ticker.
//
// Used as a SUPPORTING CONVICTION FACTOR in the signal engine — never a hard
// gate. The score (1–10) is added to long conviction and subtracted from
// short conviction with a small weight, so the adaptive weighting loop can
// tune its actual influence over time.
//
// Free tier constraints:
//   • Low rate limit (we throttle to ~1 req/sec in the nightly refresh)
//   • US-only coverage
//   • Current scores only (no history)
//
// Behavior on failure / missing key / unknown ticker → null. Callers MUST
// treat missing as "neutral" (no conviction adjustment). Never block on it.
// ============================================================================

const DANELFIN_BASE = "https://apirest.danelfin.com";
const DEFAULT_TIMEOUT_MS = 6000;

export interface DanelfinScore {
  aiScore: number;        // 1..10
  technical: number | null;
  fundamental: number | null;
  sentiment: number | null;
  lowRisk: number | null;
  asOf: string;           // YYYY-MM-DD
}

function getKey(): string | null {
  return Deno.env.get("DANELFIN_API_KEY") ?? null;
}

export function isDanelfinConfigured(): boolean {
  return getKey() !== null;
}

// In-memory cache (per-instance) — 24h TTL. The persistent cache lives in
// the `danelfin_scores` Postgres table; this just avoids redundant calls
// inside a single edge function invocation.
const cache = new Map<string, { value: DanelfinScore | null; cachedAt: number }>();
const TTL_MS = 24 * 60 * 60 * 1000;

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Fetch the latest Danelfin AI Score for a ticker.
 * Returns null on any failure / missing key / unknown ticker / rate limit.
 */
export async function getAiScore(ticker: string): Promise<DanelfinScore | null> {
  const t = ticker.toUpperCase();
  const cached = cache.get(t);
  if (cached && Date.now() - cached.cachedAt < TTL_MS) return cached.value;

  const key = getKey();
  if (!key) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const url = `${DANELFIN_BASE}/ranking?ticker=${encodeURIComponent(t)}&fields=date,aiscore,technical,fundamental,sentiment,lowrisk`;
    const r = await fetch(url, {
      headers: { "x-api-key": key, "accept": "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!r.ok) {
      // 401/402/429 are common with free tier — silently return null.
      if (r.status !== 401 && r.status !== 402 && r.status !== 429) {
        console.warn(`danelfin ${t} → HTTP ${r.status}`);
      }
      cache.set(t, { value: null, cachedAt: Date.now() });
      return null;
    }

    const j = await r.json();
    // Response is typically an array of daily rows; take the most recent.
    const rows: unknown[] = Array.isArray(j) ? j : (Array.isArray((j as { data?: unknown[] })?.data) ? (j as { data: unknown[] }).data : []);
    if (rows.length === 0) {
      cache.set(t, { value: null, cachedAt: Date.now() });
      return null;
    }

    // Sort by date desc and pick top.
    const sorted = [...rows].sort((a, b) => {
      const da = String((a as Record<string, unknown>).date ?? "");
      const db = String((b as Record<string, unknown>).date ?? "");
      return db.localeCompare(da);
    });
    const top = sorted[0] as Record<string, unknown>;

    const ai = toNum(top.aiscore ?? top.aiScore ?? top.ai_score);
    if (ai === null) {
      cache.set(t, { value: null, cachedAt: Date.now() });
      return null;
    }

    const score: DanelfinScore = {
      aiScore: Math.round(ai),
      technical: toNum(top.technical),
      fundamental: toNum(top.fundamental),
      sentiment: toNum(top.sentiment),
      lowRisk: toNum(top.lowrisk ?? top.lowRisk ?? top.low_risk),
      asOf: String(top.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
    };

    cache.set(t, { value: score, cachedAt: Date.now() });
    return score;
  } catch (e) {
    clearTimeout(timer);
    console.warn(`danelfin ${t} failed:`, e instanceof Error ? e.message : e);
    cache.set(t, { value: null, cachedAt: Date.now() });
    return null;
  }
}

// ── Persistent-cache loader ─────────────────────────────────────────────────
// Reads pre-fetched scores from the `danelfin_scores` Postgres table. This is
// what the signal engine calls per-scan — fast, no API hits. The nightly
// `refresh-danelfin-scores` cron is what populates the table.
//
// Returns a Map<ticker, aiScore>. Tickers without a fresh row (≤7 days old)
// are simply omitted; callers treat missing as neutral (0 conviction delta).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return _client;
}

const MAX_STALENESS_DAYS = 7;

export async function loadDanelfinScores(tickers: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (tickers.length === 0) return out;

  const cutoff = new Date(Date.now() - MAX_STALENESS_DAYS * 86400000).toISOString().slice(0, 10);
  const upper = tickers.map(t => t.toUpperCase());

  // Chunk to stay under URL length limits.
  const CHUNK = 200;
  for (let i = 0; i < upper.length; i += CHUNK) {
    const slice = upper.slice(i, i + CHUNK);
    const { data, error } = await client()
      .from("danelfin_scores")
      .select("ticker, ai_score, as_of")
      .in("ticker", slice)
      .gte("as_of", cutoff)
      .order("as_of", { ascending: false });
    if (error) {
      console.warn("loadDanelfinScores err", error.message);
      continue;
    }
    // Keep most-recent row per ticker.
    for (const row of (data ?? []) as Array<{ ticker: string; ai_score: number }>) {
      if (!out.has(row.ticker)) out.set(row.ticker, row.ai_score);
    }
  }
  return out;
}

/**
 * Conviction delta from a Danelfin AI Score for the given side.
 *   long:  +(score - 5) * 1.5  → -6 … +7.5
 *   short: -(score - 5) * 1.5  → +6 … -7.5
 * Missing score → 0 (neutral, never blocks).
 */
export function danelfinConvictionDelta(
  aiScore: number | undefined | null,
  side: "long" | "short",
): number {
  if (aiScore === undefined || aiScore === null || !Number.isFinite(aiScore)) return 0;
  const raw = (aiScore - 5) * 1.5;
  return side === "long" ? raw : -raw;
}

export async function upsertDanelfinScores(rows: Array<DanelfinScore & { ticker: string }>): Promise<number> {
  if (rows.length === 0) return 0;
  const as_of = new Date().toISOString().slice(0, 10);
  const payload = rows.map(r => ({
    ticker: r.ticker.toUpperCase(),
    as_of,
    ai_score: r.aiScore,
    technical: r.technical,
    fundamental: r.fundamental,
    sentiment: r.sentiment,
    low_risk: r.lowRisk,
  }));
  const CHUNK = 200;
  let total = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error, count } = await client()
      .from("danelfin_scores")
      .upsert(slice, { onConflict: "ticker,as_of", count: "exact" });
    if (error) console.warn("danelfin upsert err", error.message);
    else total += count ?? slice.length;
  }
  return total;
}
