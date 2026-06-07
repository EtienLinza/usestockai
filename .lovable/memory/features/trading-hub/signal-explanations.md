---
name: Signal Explanations (NL)
description: Plain-English 2-3 sentence rationale per fired signal generated via Lovable AI Gateway (gemini-2.5-flash-lite); non-blocking, top-20 by conviction
type: feature
---

Each fired signal can carry a short retail-friendly natural-language explanation of why it fired, surfaced in the UI on hover. Closes the Composer/TrendSpider UX gap without changing signal math.

**Generator:** `_shared/signal-explainer.ts` → `explainSignal({ ticker, side, conviction, strategy, profile, regime, weeklyBias, factors }): Promise<string>`. Uses Lovable AI Gateway (`google/gemini-2.5-flash-lite`) via raw `fetch` to keep the helper self-contained. 8s timeout. Returns `""` on any failure / missing `LOVABLE_API_KEY` / non-2xx — **never throws, never blocks**.

**Prompt contract:** system asks for 2-3 sentences, ≤280 chars, no emojis/disclaimers/greetings, just the rationale citing the strongest 2-3 contributing factors. Inputs are passed as compact JSON (side, conviction, regime, strategy, danelfin/eps deltas, target allocation).

**Where it runs:**
- `scan-worker`: after the signal-push loop, top-20 by conviction get `explainSignal` calls fanned out via `Promise.all`. Failures from any one explainer don't affect any other signal.
- `market-scanner`: same pattern at the end of the per-batch loop.

**Persistence:**
- `live_signals.explanation` (text, nullable) — upserted alongside the rest of the signal row.
- `signal_outcomes.explanation` (text, nullable) — written when the outcome row is opened, so later calibration can A/B with-explanation vs without.

**UI:** `TradingTab` signal card renders a small `?  Why this signal` button under the reasoning line when `signal.explanation` is non-empty, opening a `HoverCard` with the LLM narrative. Hidden when null/empty so old signals don't show an empty popover.

**Rate-limit + cost behavior:** capped at 20 LLM calls per scan batch by sorting on conviction desc and slicing. If Lovable AI returns 429 or 402, the helper silently degrades; callers see "" and the UI hides the popover.

**Constraints:**
- Never gate any signal on the explainer. The explainer's only job is to narrate.
- Don't increase the slice beyond ~20 per batch without first re-measuring scan latency — explainer calls run in parallel but each adds an API round-trip to the worker response.
- Never expose `LOVABLE_API_KEY` client-side; explainer must remain edge-function-only.
