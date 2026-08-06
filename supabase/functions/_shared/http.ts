// Shared HTTP helpers for edge functions: CORS, preflight, and JSON responses.
// Every function previously carried its own copy of these — the header lists
// had drifted apart, so this module defines one superset used everywhere.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, " +
    "x-supabase-client-platform, x-supabase-client-platform-version, " +
    "x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const jsonHeaders: Record<string, string> = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

// Returns a preflight response for OPTIONS requests, or null to continue.
export function handleCors(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response("ok", { headers: corsHeaders });
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...extraHeaders },
  });
}

export function errorResponse(
  message: string,
  status = 500,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ error: message, ...extra }, status);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
