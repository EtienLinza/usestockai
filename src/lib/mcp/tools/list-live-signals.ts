import { createClient } from "@supabase/supabase-js";
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sb() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export default defineTool({
  name: "list_live_signals",
  title: "List live trading signals",
  description:
    "Return the current live AI-generated stock/crypto trading signals (BUY/SELL) with confidence, entry price, regime, strategy, and reasoning. Signals expire after 24h.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(25).describe("Max signals to return."),
    signal_type: z.enum(["BUY", "SELL"]).optional().describe("Filter by direction."),
    min_confidence: z.number().min(0).max(100).optional().describe("Minimum confidence score (0-100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, signal_type, min_confidence }) => {
    let q = sb()
      .from("live_signals")
      .select("ticker,signal_type,entry_price,confidence,regime,stock_profile,strategy,reasoning,explanation,expires_at,created_at,source")
      .gt("expires_at", new Date().toISOString())
      .order("confidence", { ascending: false })
      .limit(limit);
    if (signal_type) q = q.eq("signal_type", signal_type);
    if (typeof min_confidence === "number") q = q.gte("confidence", min_confidence);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { signals: data ?? [], count: data?.length ?? 0 },
    };
  },
});
