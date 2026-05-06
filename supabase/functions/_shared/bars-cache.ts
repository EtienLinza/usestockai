// ============================================================================
// BARS-CACHE — read/write 1-year daily OHLCV bars from ticker_bars_cache.
// Falls back to a live Yahoo fetch on miss/stale. Identical DataSet shape as
// fetchDailyHistory so callers are interchangeable.
// ============================================================================
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fetchDailyHistory } from "./yahoo-history.ts";
import type { DataSet } from "./signal-engine-v2.ts";

let _client: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return _client;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loadCachedBars(tickers: string[]): Promise<Map<string, DataSet>> {
  if (tickers.length === 0) return new Map();
  const out = new Map<string, DataSet>();
  // Chunk to avoid URL length limits
  const CHUNK = 200;
  for (let i = 0; i < tickers.length; i += CHUNK) {
    const slice = tickers.slice(i, i + CHUNK);
    const { data, error } = await client()
      .from("ticker_bars_cache")
      .select("ticker, as_of, bars")
      .in("ticker", slice);
    if (error) { console.warn("bars-cache load err", error.message); continue; }
    for (const row of data ?? []) {
      out.set((row as any).ticker, (row as any).bars as DataSet);
    }
  }
  return out;
}

export async function fetchOrCachedBars(ticker: string, cached?: DataSet): Promise<DataSet | null> {
  if (cached) return cached;
  return await fetchDailyHistory(ticker, "1y");
}

export async function upsertBars(rows: { ticker: string; bars: DataSet }[]): Promise<number> {
  if (rows.length === 0) return 0;
  const as_of = todayUtc();
  const payload = rows.map(r => ({ ticker: r.ticker, as_of, bars: r.bars }));
  const CHUNK = 200;
  let total = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const slice = payload.slice(i, i + CHUNK);
    const { error, count } = await client()
      .from("ticker_bars_cache")
      .upsert(slice, { onConflict: "ticker", count: "exact" });
    if (error) console.warn("bars-cache upsert err", error.message);
    else total += count ?? slice.length;
  }
  return total;
}
