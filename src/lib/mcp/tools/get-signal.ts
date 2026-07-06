import { createClient } from "@supabase/supabase-js";
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "get_signal",
  title: "Get live signal for ticker",
  description: "Return the current live trading signal for a specific ticker symbol, if one is active.",
  inputSchema: {
    ticker: z.string().trim().min(1).max(15).describe("Ticker symbol, e.g. AAPL or BTC-USD."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ ticker }) => {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await supabase
      .from("live_signals")
      .select("*")
      .eq("ticker", ticker.toUpperCase())
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: `No active signal for ${ticker.toUpperCase()}.` }] };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { signal: data },
    };
  },
});
