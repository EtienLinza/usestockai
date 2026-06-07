// ============================================================================
// EPS REVISIONS CLIENT — fetches EPS estimate trend (revision momentum) per
// ticker via Finnhub's /stock/earnings endpoint.
//
// Used as a SUPPORTING CONVICTION FACTOR in the signal engine — never a hard
// gate. The score is added to long conviction and subtracted from short
// conviction with a small weight, so the adaptive weighting loop can tune
// its actual influence over time.
//
// Methodology (free-tier friendly):
//   • Pull last 4 quarterly EPS estimates from /stock/earnings
//   • Compute % change of latest vs ~one quarter ago (≈ 90d revision proxy)
//   • Map to revision_score ∈ [-10, +10] via clamp(((cur - old) / |old|) * 50)
//
// Behavior on failure / missing key / unknown ticker → null. Callers MUST
// treat missing as "neutral" (no conviction adjustment). Never block on it.
// ============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const DEFAULT_TIMEOUT_MS = 6000;

export interface EpsRevision {
  ticker: string;
  currentEstimate: number | null;
  estimate30dAgo: number | null;
  estimate90dAgo: number | null;
  /** Revision momentum score, range -10..+10. */
  revisionScore: number;
  asOf: string; // YYYY-MM-DD
}

function getKey(): string | null {
  return Deno.env.get("FINNHUB_API_KEY") ?? null;
}

export function isEpsRevisionsConfigured(): boolean {
  return getKey() !== null;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Fetch the latest EPS revision score for a ticker from Finnhub.
 * Returns null on any failure / missing key / unknown ticker / rate limit.
 */
export async function getEpsRevision(ticker: string): Promise<EpsRevision | null> {
  const t = ticker.toUpperCase();
  const key = getKey();
  if (!key) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const url = `${FINNHUB_BASE}/stock/earnings?symbol=${encodeURIComponent(t)}`;
    const r = await fetch(url, {
      headers: { "X-Finnhub-Token": key },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!r.ok) {
      if (r.status !== 401 && r.status !== 402 && r.status !== 429 && r.status !== 403) {
        console.warn(`eps ${t} → HTTP ${r.status}`);
      }
      return null;
    }
    const j = await r.json();
    const rows: Array<Record<string, unknown>> = Array.isArray(j) ? j : [];
    if (rows.length === 0) return null;

    // Sort by period desc, take last 4 quarters of estimates.
    const sorted = [...rows].sort((a, b) =>
      String(b.period ?? "").localeCompare(String(a.period ?? "")),
    );
    const estimates: number[] = [];
    for (const row of sorted) {
      const est = toNum(row.estimate);
      if (est !== null) estimates.push(est);
      if (estimates.length >= 4) break;
    }
    if (estimates.length < 2) return null;

    const current = estimates[0];
    const older = estimates[Math.min(1, estimates.length - 1)]; // ≈ one quarter back
    const oldest = estimates[estimates.length - 1];

    let score = 0;
    if (Math.abs(older) > 1e-6) {
      score = clamp(((current - older) / Math.abs(older)) * 50, -10, 10);
    }

    return {
      ticker: t,
      currentEstimate: current,
      estimate30dAgo: older,
      estimate90dAgo: oldest,
      revisionScore: Math.round(score * 10) / 10,
      asOf: new Date().toISOString().slice(0, 10),
    };
  } catch (e) {
    clearTimeout(timer);
    console.warn(`eps ${t} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── Persistent-cache loader ─────────────────────────────────────────────────
let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return _client;
}

const MAX_STALENESS_DAYS = 14;

/** Map<ticker, revisionScore>. Tickers without a fresh row are omitted. */
export async function loadEpsRevisions(tickers: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (tickers.length === 0) return out;
  const cutoff = new Date(Date.now() - MAX_STALENESS_DAYS * 86400000).toISOString().slice(0, 10);
  const upper = tickers.map(t => t.toUpperCase());
  const CHUNK = 200;
  for (let i = 0; i < upper.length; i += CHUNK) {
    const slice = upper.slice(i, i + CHUNK);
    const { data, error } = await client()
      .from("eps_revisions")
      .select("ticker, revision_score, as_of")
      .in("ticker", slice)
      .gte("as_of", cutoff)
      .order("as_of", { ascending: false });
    if (error) {
      console.warn("loadEpsRevisions err", error.message);
      continue;
    }
    for (const row of (data ?? []) as Array<{ ticker: string; revision_score: number }>) {
      if (!out.has(row.ticker) && Number.isFinite(row.revision_score)) {
        out.set(row.ticker, Number(row.revision_score));
      }
    }
  }
  return out;
}

/**
 * Conviction delta from an EPS revision score for the given side.
 *   long:  round(score * 0.8)  → range -8 … +8
 *   short: -round(score * 0.8)
 * Missing/null → 0 (neutral, never blocks).
 */
export function epsRevisionConvictionDelta(
  revisionScore: number | undefined | null,
  side: "long" | "short",
): number {
  if (revisionScore === undefined || revisionScore === null || !Number.isFinite(revisionScore)) return 0;
  const raw = Math.round(revisionScore * 0.8);
  return side === "long" ? raw : -raw;
}

export async function upsertEpsRevisions(rows: EpsRevision[]): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = rows.map(r => ({
    ticker: r.ticker.toUpperCase(),
    as_of: r.asOf,
    current_estimate: r.currentEstimate,
    estimate_30d_ago: r.estimate30dAgo,
    estimate_90d_ago: r.estimate90dAgo,
    revision_score: r.revisionScore,
  }));
  const CHUNK = 200;
  let total = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error, count } = await client()
      .from("eps_revisions")
      .upsert(slice, { onConflict: "ticker,as_of", count: "exact" });
    if (error) console.warn("eps upsert err", error.message);
    else total += count ?? slice.length;
  }
  return total;
}
