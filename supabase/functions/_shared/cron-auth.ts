// Shared auth gate for cron-only or admin-only edge functions.
// Accepts requests if EITHER:
//   1. x-cron-secret header matches CRON_SECRET env var, OR
//   2. (when allowAuthenticatedUser=true) Authorization: Bearer <jwt> is a valid user JWT
//
// Returns null if allowed, or a Response (401) if rejected.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

export async function requireCronOrUser(
  req: Request,
  opts: { allowAuthenticatedUser?: boolean } = {},
): Promise<Response | null> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  if (cronSecret && provided && provided === cronSecret) return null;

  if (opts.allowAuthenticatedUser) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
        );
        const token = authHeader.replace("Bearer ", "");
        const { data, error } = await supabase.auth.getUser(token);
        if (!error && data?.user?.id) return null;
      } catch (_) { /* fall through to 401 */ }
    }
  }

  return new Response(
    JSON.stringify({ error: "Unauthorized" }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

export const cronSecretHeader = (): Record<string, string> => {
  const s = Deno.env.get("CRON_SECRET");
  return s ? { "x-cron-secret": s } : {};
};
