// ============================================================================
// FUNCTION-AUTH — one place that declares how each edge function is protected.
//
// Every function deploys with verify_jwt = false (signing-keys system), so the
// gate has to run in code. This module declares the mode per function and
// applies the matching check, plus a CORS policy that is permissive for public
// endpoints and origin-allowlisted for user-authenticated ones.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type AuthMode =
  /** No credentials required (marketing/data reads, Stripe webhook signature). */
  | "public"
  /** Requires a valid end-user JWT. */
  | "user"
  /** Requires x-cron-secret, or a valid user JWT for manual admin triggers. */
  | "cron-admin";

/** Declared protection mode per function name. Keep in sync with the folders. */
export const FUNCTION_AUTH_REGISTRY: Record<string, AuthMode> = {
  // Public reads / signature-verified endpoints
  "fetch-stock-price": "public",
  "fetch-stock-chart": "public",
  "market-sentiment": "public",
  "sector-analysis": "public",
  "news-sentiment": "public",
  "health-check": "public",
  "payments-webhook": "public",
  "mcp": "public",

  // End-user endpoints
  "analyze-ticker": "user",
  "backtest": "user",
  "create-checkout": "user",
  "create-portal-session": "user",
  "delete-account": "user",
  "log-audit": "user",
  "portfolio-gate": "user",

  // Cron / admin only
  "market-scanner": "cron-admin",
  "scan-orchestrator": "cron-admin",
  "scan-worker": "cron-admin",
  "autotrader-scan": "cron-admin",
  "prefetch-bars": "cron-admin",
  "calibrate-weights": "cron-admin",
  "check-price-alerts": "cron-admin",
  "clear-signals": "cron-admin",
  "detect-drift": "cron-admin",
  "evaluate-rejections": "cron-admin",
  "label-rejected-signals": "cron-admin",
  "manage-models": "cron-admin",
  "refresh-danelfin-scores": "cron-admin",
  "refresh-eps-revisions": "cron-admin",
  "refresh-short-interest": "cron-admin",
  "send-alert-email": "cron-admin",
  "train-exit-meta": "cron-admin",
  "train-meta-labeler": "cron-admin",
  "train-user-models": "cron-admin",
  "tune-exit-params": "cron-admin",
  "tune-signal-thresholds": "cron-admin",
  "weekly-digest": "cron-admin",
};

const ALLOWED_ORIGIN_SUFFIXES = [".lovable.app", ".lovableproject.com"];
const ALLOWED_ORIGINS = ["https://usestockai.lovable.app", "http://localhost:8080"];

function originAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return ALLOWED_ORIGIN_SUFFIXES.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
}

/** CORS headers appropriate for the mode. Public = `*`, user = allowlist. */
export function corsFor(mode: AuthMode, req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowOrigin = mode === "public"
    ? "*"
    : originAllowed(origin)
      ? origin!
      : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Vary": "Origin",
  };
}

export interface AuthResult {
  ok: boolean;
  userId?: string;
  response?: Response;
}

/** Run the declared gate. Returns `ok:false` with a ready-to-return Response. */
export async function authorize(
  functionName: string,
  req: Request,
): Promise<AuthResult> {
  const mode = FUNCTION_AUTH_REGISTRY[functionName] ?? "user";
  const cors = corsFor(mode, req);
  const deny = (status: number, error: string): AuthResult => ({
    ok: false,
    response: new Response(JSON.stringify({ error }), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    }),
  });

  if (mode === "public") return { ok: true };

  if (mode === "cron-admin") {
    const secret = Deno.env.get("CRON_SECRET");
    const provided = req.headers.get("x-cron-secret");
    if (secret && provided && provided === secret) return { ok: true };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return deny(401, "Unauthorized");
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data, error } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (error || !data?.user?.id) return deny(401, "Unauthorized");
    return { ok: true, userId: data.user.id };
  } catch (_) {
    return deny(401, "Unauthorized");
  }
}

/** Wrap a handler with the declared gate and CORS preflight handling. */
export function withAuth(
  functionName: string,
  handler: (req: Request, ctx: { userId?: string; cors: Record<string, string> }) => Promise<Response>,
): (req: Request) => Promise<Response> {
  const mode = FUNCTION_AUTH_REGISTRY[functionName] ?? "user";
  return async (req: Request) => {
    const cors = corsFor(mode, req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const auth = await authorize(functionName, req);
    if (!auth.ok) return auth.response!;
    return handler(req, { userId: auth.userId, cors });
  };
}
