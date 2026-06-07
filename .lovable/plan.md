# Medium-Effort / Strong-Value — Batch 2

We already shipped **#7 Regime Detection**, **#8 Meta-Labeling**, and **H-6 realKelly Wiring**.
Remaining medium-effort items from the 20-idea list are: #5, #9, #10, #12, #14, #16, #17, #18, #19, #20.

Picking 4 with the best value-to-effort ratio that compound with what's already in the engine. Skipping the rest for stated reasons.

---

## 1. #5 Portfolio CVaR Budget (≤2% NAV at 95% ES)

**Why:** Pairs with the 6% portfolio heat cap and the CDaR₀.₉₅ breaker — heat cap bounds *worst-case sum of stops*, CDaR bounds *realized drawdown*, but neither bounds *expected tail loss on the live book right now*. CVaR is the missing rail.

**Approach:**
- New `_shared/portfolio-cvar.ts`: given current open `virtual_positions` + last 60 daily returns per ticker, simulate 1,000 historical-bootstrap P&L paths over a 5-day horizon → compute 95% Expected Shortfall as % of NAV.
- `autotrader-scan` calls it pre-entry: if adding the candidate pushes book CVaR above **2% NAV**, block the entry (treated like heat-cap — hard block, not warn).
- New column `autotrader_log.cvar_block_count`; reasoning string appends `cvar=X.XX%`.
- Persists scan-level snapshot to `portfolio_cvar_snapshots` (date, user_id, cvar_pct, n_positions).

## 2. #9 Almgren–Chriss Slippage / Impact Model

**Why:** Current cost model is a flat bps haircut. Real fills scale with `(orderSize / ADV)^0.5`. Closes the audit gap where backtests overstate edge on small-cap or sized-up entries, and lets autotrader downsize when impact would eat the expected edge.

**Approach:**
- New `_shared/slippage-model.ts` implementing simplified Almgren–Chriss permanent + temporary impact:
  - `slippageBps = γ × (Q / ADV) + η × σ × √(Q / ADV)` with γ=10bps, η=12bps, σ=daily vol.
  - Inputs: orderNotional, ADV (already fetched), atrPct.
- Wire into `signal-engine-v2.ts`:
  - `computePositionSize` adds an impact-aware shrink: if expected impact > 30% of `expectedEdgeBps`, shrink position until ratio ≤ 30%.
  - Persist `slippage_bps_est` to `signal_outcomes.contributing_rules`.
- Wire into backtester (`backtest/index.ts`): replace flat slippage with the same function so backtest = live.

## 3. #17 Short-Interest Velocity Filter

**Why:** Cheapest orthogonal alpha left — Finnhub already in stack (no new key). Rising SI on a long candidate is a yellow flag; collapsing SI (short squeeze fuel) is a green flag for breakouts. Mirror of the EPS-revision overlay we just shipped, on a different fundamental axis.

**Approach:**
- New `_shared/short-interest.ts` + nightly cron `refresh-short-interest` (03:00 UTC) that pulls `/stock/insider-transactions` short-interest endpoint for active tickers, persists to `short_interest_history (ticker, report_date, si_pct_float, days_to_cover, velocity_30d)`.
- `signal-engine-v2.ts`: add supporting conviction delta **±6 pts**:
  - Long candidate with SI rising > 20% over 30d → −4 to −6
  - Long breakout with SI falling > 30% AND days-to-cover ≥ 3 → +4 to +6
  - Short candidate inverts the signs
- Persist `si_velocity, si_delta` to outcomes for closed-loop calibration.

## 4. #14 ADWIN Drift Detector

**Why:** The meta-labeler retrains nightly on 180d. If the market shifts (regime break, post-event drift), the model is stale **before** retrain. ADWIN (Bies-Castro–Gavaldà adaptive windowing) flags drift in realized hit-rate within hours, not nights.

**Approach:**
- New `_shared/adwin.ts`: streaming ADWIN over the last N closed `signal_outcomes` (sliding pointer + Hoeffding bound, ~50 LOC).
- `autotrader-scan` runs ADWIN on hit-rate at scan start. On drift detection:
  - Soft mode: tighten meta-label gate (PASS threshold lifts from 0.45 → 0.55, SKIP from 0.30 → 0.40).
  - Snapshot to new `drift_events` table (detected_at, window_size, pre_mean, post_mean).
  - Surfaced as a chip in `TradingTab` next to the regime badge.
- Cron job `train-meta-labeler` reads recent drift events and weights the most-recent 30d ×3 instead of the default ×2 when drift was flagged in that window.

---

## Technical Details

**New files:**
- `supabase/functions/_shared/portfolio-cvar.ts`
- `supabase/functions/_shared/slippage-model.ts`
- `supabase/functions/_shared/short-interest.ts`
- `supabase/functions/_shared/adwin.ts`
- `supabase/functions/refresh-short-interest/index.ts`
- 4 memory files under `.lovable/memory/architecture/prediction-engine/`

**Edited files:**
- `_shared/signal-engine-v2.ts` — slippage shrink + SI velocity delta
- `autotrader-scan/index.ts` — CVaR pre-trade gate + ADWIN drift sensing
- `scan-orchestrator/index.ts` + `scan-worker/index.ts` + `market-scanner/index.ts` — propagate SI fields
- `backtest/index.ts` — swap flat slippage for Almgren–Chriss
- `train-meta-labeler/index.ts` — drift-aware reweighting
- `src/components/dashboard/TradingTab.tsx` — drift chip
- `supabase/config.toml` — schedule `refresh-short-interest` 03:00 UTC

**Migration:**
- `short_interest_history` table (ticker, report_date PK, si_pct_float, days_to_cover, velocity_30d)
- `portfolio_cvar_snapshots` (id, user_id, taken_at, cvar_pct, n_positions, nav)
- `drift_events` (id, detected_at, window_size, pre_mean, post_mean, severity)
- `live_signals.si_velocity numeric`, `live_signals.slippage_bps_est numeric`
- `signal_outcomes.si_velocity numeric`, `signal_outcomes.slippage_bps_est numeric`
- GRANTs + RLS (public read on `short_interest_history` + `drift_events`; user-scoped read on `portfolio_cvar_snapshots`)

**Out of scope (intentionally):**
- **#10 Conformal prediction intervals** — overlaps too much with the just-shipped meta-labeler; revisit once we have 6 months of meta-score history.
- **#12 Options flow / #16 Form 4** — both require new paid data feeds; punt until a feed is wired.
- **#18 Fractional differentiation** — marginal lift on top of existing features; better tackled as part of a meta-labeler v2.
- **#19 TWAP/VWAP slicing** — only matters once we wire a real broker; virtual positions are atomic fills.
- **#20 Factor neutralization** — needs a full Fama-French factor model; high effort, separate batch.

---

Reply **"go"** to ship all four, or tell me which to drop/reorder.
