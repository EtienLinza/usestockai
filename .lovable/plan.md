# High-Impact Clean Wins — Implementation Plan

Three orthogonal upgrades from the remaining roadmap, all rated **S** difficulty, each closing a distinct gap (risk, alpha, UX).

---

## 1. #6 — Hard Sector Exposure Cap (closes G-5)

**Gap:** `portfolio_caps` already has `sector_max_pct` (default 35%) and `portfolio-gate` enforces it on the **client buy path**. The **autotrader** path bypasses this — it has its own correlation gate but no sector ceiling, so NVDA+AMD+AVGO can all open as a 3× XLK cluster.

**Change:**
- In `autotrader-scan/index.ts`, mirror the heat-cap pre-pass: compute current sector exposure $ from `open virtual_positions` using the existing `TICKER_TO_SECTOR_ETF` map in `_shared/scan-pipeline.ts`.
- Per candidate: `(sectorDollars[sector] + candidateDollars) / currentNAV > sector_max_pct` → **block** (regardless of `enforcement_mode`, same precedent as portfolio heat cap — sector concentration is a non-negotiable rail when ≥35%).
- Update `sectorDollars` after each successful entry within the scan.
- Log block reason to `autotrade_log.reason`.

**File:** `supabase/functions/autotrader-scan/index.ts` only.
**Memory:** `mem://architecture/prediction-engine/sector-exposure-cap.md`.

---

## 2. #11 — EPS-Revision Factor (orthogonal fundamental tilt)

**Gap:** Engine is 100% technical. EPS-estimate-revision momentum is the best-documented orthogonal factor and the cheapest to add (Finnhub already in stack — `FINNHUB_API_KEY` configured).

**Data source:** Finnhub `/stock/recommendation` + `/stock/earnings` gives quarter-over-quarter EPS estimate trend. Free tier covers it.

**Schema:**
```sql
CREATE TABLE public.eps_revisions (
  ticker text NOT NULL,
  as_of date NOT NULL,
  current_estimate numeric,
  estimate_30d_ago numeric,
  estimate_90d_ago numeric,
  revision_score numeric,  -- -10..+10
  PRIMARY KEY (ticker, as_of)
);
-- Public read, server-only write (mirrors danelfin_scores pattern)
```

**Refresh:** New `refresh-eps-revisions` edge fn + nightly cron at 02:45 UTC (after Danelfin). Throttled ~1 req/sec, capped at 300 tickers, same universe selection as Danelfin (`scan_universe_log.sample_tickers` ∪ watchlist ∪ open positions).

**Factor formula** (in `_shared/signal-engine-v2.ts`, parallel to existing Danelfin overlay):
- `revisionScore = clamp(((current - est_90d_ago) / |est_90d_ago|) * 50, -10, +10)`
- Long:  `delta = round(revisionScore * 0.8)` → range −8…+8
- Short: `delta = -round(revisionScore * 0.8)`
- Missing/null/crypto → 0 (never blocks)
- Applied **after** Danelfin delta, clamped 0..100, mirrored into `consensusScore`

**Wiring:**
- `scan-orchestrator` pre-loads `epsRevisions` map once per run, forwards to workers under `body.epsRevisions` (mirrors `danelfinScores` flow).
- `autotrader-scan` pre-loads once per scan, passes to `runEntryDecision` → `evaluateSignal`.
- `evaluateSignal` returns `epsRevisionDelta` and `epsRevisionScore`; persisted to `signal_outcomes.contributing_rules.eps_revision*` so `calibrate-weights` can measure incremental edge.
- Reasoning string appends ` | epsΔ=±N` when non-zero.

**Memory:** `mem://architecture/prediction-engine/eps-revision-overlay.md` (hard rule: supporting factor only, never a gate — same pattern as Danelfin overlay).

---

## 3. #15 — Natural-Language Signal Explanations (UX moat)

**Gap:** Signals show factor weights as opaque numbers. Composer/TrendSpider's biggest UX advantage is plain-English "why."

**Approach:** Cheap LLM overlay using **Lovable AI Gateway** (`google/gemini-2.5-flash-lite` — fastest/cheapest tier, perfect for short structured summaries; no user API key required).

**Where rendered:** `signal_outcomes` already stores `contributing_rules` (regime, strategy_tilt, danelfinΔ, ticker_calibration, etc.). On signal write, generate a 2-3 sentence explanation and persist alongside.

**Schema:**
```sql
ALTER TABLE public.live_signals ADD COLUMN explanation text;
ALTER TABLE public.signal_outcomes ADD COLUMN explanation text;
```

**Flow:**
- New shared helper `_shared/signal-explainer.ts` exports `explainSignal(sig, factors): Promise<string>`.
- Called from `scan-worker` and `market-scanner` after `evaluateSignal`, **non-blocking** (Promise.all with timeout). On error/timeout → empty string, never blocks signal write.
- Prompt: structured JSON of top 5 contributing factors + side + regime → return 2-3 sentence retail-friendly explanation.
- Rate limit awareness: skip generation if scan batch >50 signals, generate top-20 by conviction only.

**UI:** `TradingTab` signal cards already have a `HoverCard` for the Danelfin badge. Add a `?` icon next to conviction → popover showing `explanation`. Hidden when empty.

**Memory:** `mem://features/trading-hub/signal-explanations.md`.

---

## Execution Order (single sprint)

```text
Step 1: Migration — eps_revisions table + GRANTs/RLS + live_signals.explanation + signal_outcomes.explanation
Step 2: Sector cap in autotrader-scan (no schema)
Step 3: refresh-eps-revisions edge fn + cron + config.toml (verify_jwt=false)
Step 4: _shared/eps-revisions.ts loader + signal-engine-v2 factor wiring
Step 5: scan-orchestrator + scan-worker + market-scanner + autotrader-scan pass-through
Step 6: _shared/signal-explainer.ts + non-blocking call sites
Step 7: TradingTab UI popover for explanation
Step 8: Three memory files
Step 9: Deploy all touched edge fns
```

## Files Touched
- **New:** `supabase/functions/refresh-eps-revisions/index.ts`, `supabase/functions/_shared/eps-revisions.ts`, `supabase/functions/_shared/signal-explainer.ts`, 3 memory files
- **Edited:** `supabase/functions/autotrader-scan/index.ts`, `supabase/functions/_shared/signal-engine-v2.ts`, `supabase/functions/scan-orchestrator/index.ts`, `supabase/functions/scan-worker/index.ts`, `supabase/functions/market-scanner/index.ts`, `supabase/config.toml`, `src/components/dashboard/TradingTab.tsx`
- **Migration:** eps_revisions + 2 ALTER TABLEs + cron job

## Out of Scope (explicit)
- Backtest doesn't get EPS data (no history on free tier) — engine no-ops with delta=0, identical to Danelfin's backtest behavior.
- No new gate, no minimum EPS score, no veto — supporting factor only.
- Sector cap uses existing `TICKER_TO_SECTOR_ETF`; no GICS upgrade.

Reply **"go"** to ship, or tell me which of the three to drop / reorder.