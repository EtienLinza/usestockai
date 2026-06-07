// ============================================================================
// SHORT-INTEREST CLIENT — fetches reported short interest per ticker via
// Finnhub's /stock/insider-sentiment endpoint (which exposes SI fields in
// the company-profile / short-interest payloads on free tier).
//
// Used as a SUPPORTING CONVICTION FACTOR — never a hard gate. Conviction
// delta is symmetric (±6 pts) and applied AFTER eps-revision in the engine
// so the calibration loop can attribute each layer separately.
//
// Methodology (free-tier friendly):
//   • Pull last 2 short-interest observations (~biweekly settle).
//   • Compute 30-day velocity = (latest_si_pct - prev_si_pct) / prev_si_pct.
//   • Persist {ticker, report_date, si_pct_float, days_to_cover, velocity_30d}.
//
// Behavior on failure / missing key / unknown ticker → null. Callers MUST
// treat missing as "neutral" (no conviction adjustment).
// ============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const DEFAULT_TIMEOUT_MS = 6000;

export interface ShortInterestSnapshot {
  ticker: string;
  reportDate: string;       // YYYY-MM-DD
  siPctFloat: number | null;
  daysToCover: number | null;
  velocity30d: number | null;
}

function getKey(): string | null {
  return Deno.env.get("FINNHUB_API_KEY") ?? null;
}

export function isShortInterestConfigured(): boolean {
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

/**
 * Fetch the latest short-interest snapshot for a ticker from Finnhub.
 * Endpoint: /stock/short-interest. Returns null on any failure.
 */
export async function getShortInterest(ticker: string): Promise<ShortInterestSnapshot | null> {
  const t = ticker.toUpperCase();
  const key = getKey();
  if (!key) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const url = `${FINNHUB_BASE}/stock/short-interest?symbol=${encodeURIComponent(t)}&from=${
      new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10)
    }&to=${new Date().toISOString().slice(0, 10)}`;
    const r = await fetch(url, {
      headers: { "X-Finnhub-Token": key },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      if (![401, 402, 403, 429].includes(r.status)) {
        console.warn(`si ${t} → HTTP ${r.status}`);
      }
      return null;
    }
    const j = await r.json();
    const rows: Array<Record<string, unknown>> = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
    if (rows.length === 0) return null;
    // Sort by settlementDate desc.
    const sorted = [...rows].sort((a, b) =>
      String(b.settlementDate ?? b.recordDate ?? "").localeCompare(
        String(a.settlementDate ?? a.recordDate ?? ""),
      ),
    );
    const latest = sorted[0];
    const prev = sorted[1] ?? null;
    const reportDate = String(latest.settlementDate ?? latest.recordDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    const siLatest = toNum(latest.shortPercent ?? latest.shortPercentOfFloat ?? latest.shortInterestRatio);
    const dtc = toNum(latest.daysToCover ?? latest.shortRatio);
    let velocity30d: number | null = null;
    if (prev && siLatest !== null) {
      const siPrev = toNum(prev.shortPercent ?? prev.shortPercentOfFloat ?? prev.shortInterestRatio);
      if (siPrev !== null && Math.abs(siPrev) > 1e-6) {
        velocity30d = Math.round(((siLatest - siPrev) / Math.abs(siPrev)) * 10000) / 10000;
      }
    }
    return {
      ticker: t,
      reportDate,
      siPctFloat: siLatest,
      daysToCover: dtc,
      velocity30d,
    };
  } catch (e) {
    clearTimeout(timer);
    console.warn(`si ${t} failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── DB helpers ──────────────────────────────────────────────────────────────
let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return _client;
}

const MAX_STALENESS_DAYS = 30;

export interface ShortInterestRow {
  velocity30d: number | null;
  daysToCover: number | null;
}

/** Map<ticker, {velocity30d, daysToCover}>. Tickers without fresh rows omitted. */
export async function loadShortInterestMap(tickers: string[]): Promise<Map<string, ShortInterestRow>> {
  const out = new Map<string, ShortInterestRow>();
  if (tickers.length === 0) return out;
  const cutoff = new Date(Date.now() - MAX_STALENESS_DAYS * 86400000).toISOString().slice(0, 10);
  const upper = tickers.map(t => t.toUpperCase());
  const CHUNK = 200;
  for (let i = 0; i < upper.length; i += CHUNK) {
    const slice = upper.slice(i, i + CHUNK);
    const { data, error } = await client()
      .from("short_interest_history")
      .select("ticker, velocity_30d, days_to_cover, report_date")
      .in("ticker", slice)
      .gte("report_date", cutoff)
      .order("report_date", { ascending: false });
    if (error) {
      console.warn("loadShortInterestMap err", error.message);
      continue;
    }
    for (const row of (data ?? []) as Array<{ ticker: string; velocity_30d: number | null; days_to_cover: number | null }>) {
      if (!out.has(row.ticker)) {
        out.set(row.ticker, {
          velocity30d: row.velocity_30d != null && Number.isFinite(row.velocity_30d) ? Number(row.velocity_30d) : null,
          daysToCover: row.days_to_cover != null && Number.isFinite(row.days_to_cover) ? Number(row.days_to_cover) : null,
        });
      }
    }
  }
  return out;
}

export async function upsertShortInterest(rows: ShortInterestSnapshot[]): Promise<number> {
  if (rows.length === 0) return 0;
  const payload = rows.map(r => ({
    ticker: r.ticker,
    report_date: r.reportDate,
    si_pct_float: r.siPctFloat,
    days_to_cover: r.daysToCover,
    velocity_30d: r.velocity30d,
  }));
  const CHUNK = 200;
  let total = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error, count } = await client()
      .from("short_interest_history")
      .upsert(slice, { onConflict: "ticker,report_date", count: "exact" });
    if (error) console.warn("si upsert err", error.message);
    else total += count ?? slice.length;
  }
  return total;
}

/**
 * Conviction delta from a short-interest snapshot.
 *
 * Long candidates:
 *   • SI rising > 20% over 30d           →  -4 to -6  (yellow flag)
 *   • SI falling > 30% AND DTC ≥ 3       →  +4 to +6  (squeeze fuel)
 * Short candidates: signs invert.
 * Missing / neutral → 0.
 */
export function shortInterestConvictionDelta(
  row: ShortInterestRow | undefined | null,
  side: "long" | "short",
  strategy: string,
): number {
  if (!row || row.velocity30d === null || !Number.isFinite(row.velocity30d)) return 0;
  const v = row.velocity30d;
  let raw = 0;
  if (v >= 0.20) {
    raw = -Math.min(6, Math.round((v - 0.20) * 20 + 4));
  } else if (v <= -0.30 && (row.daysToCover ?? 0) >= 3 && strategy === "breakout") {
    raw = Math.min(6, Math.round((-v - 0.30) * 15 + 4));
  } else if (v <= -0.30) {
    raw = Math.min(4, Math.round((-v - 0.30) * 10 + 2));
  }
  return side === "long" ? raw : -raw;
}
