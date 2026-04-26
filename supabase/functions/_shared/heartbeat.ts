// ============================================================================
// HEARTBEAT — record that a scheduled edge function ran.
// Writes are service-role only; failures here must NEVER throw or block the
// caller. The table is best-effort observability, not a critical path.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export async function recordHeartbeat(
  jobName: string,
  startedAtMs: number,
  status: "ok" | "error" = "ok",
  notes?: string,
): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const supabase = createClient(url, key);
    const duration = Math.max(0, Date.now() - startedAtMs);
    await supabase.from("cron_heartbeat").upsert(
      {
        job_name: jobName,
        last_run_at: new Date().toISOString(),
        duration_ms: duration,
        status,
        notes: notes ? notes.slice(0, 500) : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "job_name" },
    );
  } catch (e) {
    console.warn(`recordHeartbeat(${jobName}) failed:`, e instanceof Error ? e.message : e);
  }
}
