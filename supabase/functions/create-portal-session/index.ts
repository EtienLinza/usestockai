import { createStripeClient, type StripeEnv } from "../_shared/stripe.ts";
import { corsHeaders, handleCors, jsonResponse } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase-client.ts";

const supabase = adminClient();

const ALLOWED_RETURN_ORIGINS = [
  "https://usestockai.lovable.app",
  "https://id-preview--138571be-2acf-489f-a179-4a5c3d779ba1.lovable.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function isAllowedReturnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (ALLOWED_RETURN_ORIGINS.includes(parsed.origin)) return true;
    if (parsed.origin.endsWith(".lovable.app") || parsed.origin.endsWith(".lovableproject.com")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { environment, returnUrl } = body ?? {};
    if (environment !== "sandbox" && environment !== "live") throw new Error("Invalid environment");
    const env = environment as StripeEnv;

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) throw new Error("Unauthorized");
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .eq("environment", env)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub?.stripe_customer_id) throw new Error("No subscription found");

    const stripe = createStripeClient(env);
    const safeReturnUrl = returnUrl && typeof returnUrl === "string" && isAllowedReturnUrl(returnUrl)
      ? returnUrl
      : undefined;
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id as string,
      ...(safeReturnUrl && { return_url: safeReturnUrl }),
    });

    return jsonResponse({ url: portal.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("create-portal-session error:", message);
    return jsonResponse({ error: message }, 400);
  }
});
