import { createStripeClient, type StripeEnv } from "../_shared/stripe.ts";
import { corsHeaders, handleCors, jsonResponse } from "../_shared/http.ts";
import { anonClient } from "../_shared/supabase-client.ts";

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
    // Allow Lovable preview subdomains
    if (parsed.origin.endsWith(".lovable.app") || parsed.origin.endsWith(".lovableproject.com")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const supabase = anonClient();

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId: string },
): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(options.userId)) {
    throw new Error("Invalid userId");
  }
  const found = await stripe.customers.search({
    query: `metadata['userId']:'${options.userId}'`,
    limit: 1,
  });
  if (found.data.length) return found.data[0].id;

  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    if (existing.data.length) {
      const customer = existing.data[0];
      if (customer.metadata?.userId !== options.userId) {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, userId: options.userId },
        });
      }
      return customer.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    metadata: { userId: options.userId },
  });
  return created.id;
}

Deno.serve(async (req) => {
  const preflight = handleCors(req);
  if (preflight) return preflight;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  // EMERGENCY KILL-SWITCH: payments are paused while billing is finalized.
  // Never create a checkout session — return 503 so any stray frontend
  // caller fails closed instead of charging a test card.
  return jsonResponse({ error: "Payments are temporarily disabled. Please join the waitlist." }, 503);
});

// Legacy handler retained below for reference only — kept intact so we can
// flip payments back on without rewriting the integration.
async function _disabled_handler(req: Request) {
  try {
    // Require authentication. Discard any client-supplied userId.
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const { priceId, returnUrl, environment } = body ?? {};

    if (!priceId || typeof priceId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(priceId)) {
      throw new Error("Invalid priceId");
    }
    if (environment !== "sandbox" && environment !== "live") {
      throw new Error("Invalid environment");
    }
    if (!returnUrl || typeof returnUrl !== "string" || !isAllowedReturnUrl(returnUrl)) {
      throw new Error("Invalid returnUrl");
    }

    const userId = user.id;
    const customerEmail = user.email;

    const env = environment as StripeEnv;
    const stripe = createStripeClient(env);

    const prices = await stripe.prices.list({ lookup_keys: [priceId] });
    if (!prices.data.length) throw new Error("Price not found");
    const stripePrice = prices.data[0];
    const isRecurring = stripePrice.type === "recurring";

    const customerId = await resolveOrCreateCustomer(stripe, {
      email: customerEmail,
      userId,
    });

    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: stripePrice.id, quantity: 1 }],
      mode: isRecurring ? "subscription" : "payment",
      ui_mode: "embedded_page",
      return_url: returnUrl,
      managed_payments: { enabled: true },
      customer: customerId,
      metadata: { userId },
      ...(isRecurring && { subscription_data: { metadata: { userId } } }),
    } as any);

    return jsonResponse({ clientSecret: session.client_secret });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("create-checkout error:", message);
    return jsonResponse({ error: message }, 400);
  }
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _legacy = _disabled_handler;
