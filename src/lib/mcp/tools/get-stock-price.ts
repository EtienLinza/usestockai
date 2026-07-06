import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "get_stock_price",
  title: "Get current stock price",
  description: "Fetch the latest price and daily change for a stock or crypto ticker via the app's server-side Yahoo Finance proxy.",
  inputSchema: {
    ticker: z.string().trim().min(1).max(15).describe("Ticker symbol, e.g. AAPL, TSLA, BTC-USD."),
  },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: true },
  handler: async ({ ticker }) => {
    const url = `${process.env.SUPABASE_URL}/functions/v1/fetch-stock-price`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ ticker: ticker.toUpperCase() }),
    });
    const text = await res.text();
    if (!res.ok) return { content: [{ type: "text", text: `Error ${res.status}: ${text}` }], isError: true };
    return { content: [{ type: "text", text }] };
  },
});
