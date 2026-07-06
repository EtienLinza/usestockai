import { defineMcp } from "@lovable.dev/mcp-js";
import listLiveSignals from "./tools/list-live-signals";
import getSignal from "./tools/get-signal";
import getStockPrice from "./tools/get-stock-price";

export default defineMcp({
  name: "usestockai-mcp",
  title: "UseStockAI Signals",
  version: "0.1.0",
  instructions:
    "Tools for UseStockAI. Use `list_live_signals` to browse the current AI-generated BUY/SELL trading signals ranked by confidence, `get_signal` to check the active signal for a specific ticker, and `get_stock_price` to fetch a live quote. Signals are informational, not financial advice.",
  tools: [listLiveSignals, getSignal, getStockPrice],
});
