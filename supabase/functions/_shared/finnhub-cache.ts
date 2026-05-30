// Postgres-backed Finnhub response cache shared across all edge-function cold
// starts. Replaces per-isolate in-memory Maps that reset every invocation and
// caused O(users × tickers) calls to Finnhub during scans.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

let _client: SupabaseClient | null = null;
function client(): SupabaseClient | null {
  if (_client) return _client;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export async function cacheGet<T>(category: string, key: string): Promise<T | null> {
  const c = client();
  if (!c) return null;
  try {
    const cacheKey = `${category}:${key.toUpperCase()}`;
    const { data } = await c
      .from("finnhub_cache")
      .select("payload, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (!data) return null;
    if (new Date(data.expires_at).getTime() < Date.now()) return null;
    return data.payload as T;
  } catch (e) {
    console.warn("finnhub-cache get failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function cacheSet<T>(
  category: string,
  key: string,
  value: T,
  ttlMs: number,
): Promise<void> {
  const c = client();
  if (!c) return;
  try {
    const cacheKey = `${category}:${key.toUpperCase()}`;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await c.from("finnhub_cache").upsert(
      {
        cache_key: cacheKey,
        category,
        payload: value as unknown as Record<string, unknown>,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" },
    );
  } catch (e) {
    console.warn("finnhub-cache set failed:", e instanceof Error ? e.message : e);
  }
}
