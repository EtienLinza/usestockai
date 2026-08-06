// Shared Supabase client factories for edge functions.
// Every function used to inline `createClient(Deno.env.get("SUPABASE_URL")!, ...)`
// against a locally pinned supabase-js version; this module is the single place
// where the version and the env var names are defined.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export { createClient };

// Service-role client — bypasses RLS. Never expose its results unfiltered.
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// Anon client — subject to RLS. Pass a caller's Authorization header to act
// as that user.
export function anonClient(authHeader?: string | null): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    authHeader ? { global: { headers: { Authorization: authHeader } } } : undefined,
  );
}
