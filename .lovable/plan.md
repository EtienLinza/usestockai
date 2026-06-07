# Medium-Effort / Strong-Value Batch

Picking the three roadmap items with the best value-to-effort ratio. Skipping pure tech-debt (H-4, P-3) and data-plumbing (G-8 corp actions) — those are low-value relative to alpha lifts. Skipping #20 factor neutralization (needs full factor model, high effort).

---

## 1. #7 Regime Detection Gate

**Why:** Single biggest unrealized edge. Engine currently treats all market states identically; mean-reversion signals fire in trending tapes and momentum signals fire in chop. A regime classifier lets us tilt strategy weights per regime instead of forcing one config.

**Approach — keep it simple, classical HMM-style states from SPY:**
- New `_shared/regime-detector.ts`: classify market into 4 states using SPY daily bars (already cached):
  - `bull_quiet` — 50d > 200d SMA, ATR% < 1.2
  - `bull_volatile` — 50d > 200d SMA, ATR% ≥ 1.2
  - `bear_quiet` — 50d < 200d SMA, ATR% < 1.5
  - `bear_volatile` — 50d < 200d SMA, ATR% ≥ 1.5 (VIX proxy ≥ 25)
- Persist to new `market_regime` table (one row per day, populated by `market-scanner` once per scan).
- `signal-engine-v2.ts` reads current regime, applies strategy-tilt multipliers:
  - momentum strategies → `bull_quiet` ×1.15, `bear_volatile` ×0.70
  - mean-reversion → `bull_volatile` ×1.20, `bull_quiet` ×0.90
  - breakout → `bull_quiet` ×1.10, `bear_quiet` ×0.85
- Tilts cap at ±20% delta on conviction so they bias, never gate.
- Surface `regime` field in `live_signals` for UI (small badge in TradingTab).

## 2. #8 Meta-Labeling Filter

**Why:** Lopez de Prado's secondary classifier — given the primary signal already fired, predict whether *this specific instance* is likely to be profitable. Historically lifts precision 15-25% with minor recall loss. Fits naturally on top of existing signal pipeline.

**Approach — logistic on persisted features, retrained nightly:**
- New `meta_label_model` table: stores serialized logistic regression coefficients (~20 floats) + timestamp.
- New nightly cron edge function `train-meta-labeler`:
  - Pulls last 180d of `signal_outcomes` with realized PnL
  - Features: conviction, atrPct, relStrength, sectorMomentum, regime (one-hot), epsRevisionScore, hour-of-day, day-of-week
  - Label: 1 if trade hit TP before SL, else 0
  - Fit logistic via plain JS (no deps — ~80 lines of gradient descent)
  - Store coefficients
- `signal-engine-v2.ts` loads latest coefficients, computes `metaScore ∈ [0,1]` per candidate.
- Filter: if `metaScore < 0.45` and conviction < 80, **demote** to consensus-only (no autotrade). Hard skip below 0.30.
- Persist `metaScore` to `signal_outcomes.contributing_rules.meta_score` for closed-loop tracking.

## 3. H-6 realKelly Wiring

**Why:** We have a full realKelly implementation that's never used because `autotrader-scan` runs stateless per-candidate. Switching to a stateful sizing pass closes the audit gap and improves capital efficiency on multi-candidate batches.

**Approach:**
- In `autotrader-scan/index.ts`, after candidate scoring but before entry loop:
  - Collect all approved candidates into array with `{ticker, conviction, atrPct, expectedEdge}`.
  - Pull open positions from `virtual_positions` for correlation context.
  - Call existing `realKelly()` solver with the candidate set + current portfolio → returns per-ticker fraction.
  - Replace per-candidate `kellyFraction` with solver output.
- Falls back to half-Kelly per-ticker if solver fails or batch size = 1.
- Keep existing vol-target scalar and portfolio-heat-cap on top (multiplicative).

---

## Technical Details

**New files:**
- `supabase/functions/_shared/regime-detector.ts`
- `supabase/functions/_shared/meta-labeler.ts` (load + score)
- `supabase/functions/train-meta-labeler/index.ts` (nightly)
- 3 memory files under `.lovable/memory/architecture/prediction-engine/`

**Edited files:**
- `_shared/signal-engine-v2.ts` — regime tilts + meta-label filter
- `autotrader-scan/index.ts` — stateful realKelly pass
- `market-scanner/index.ts` + `scan-orchestrator/index.ts` — persist regime
- `scan-worker/index.ts` — persist metaScore
- `src/components/dashboard/TradingTab.tsx` — regime badge
- `supabase/config.toml` — schedule `train-meta-labeler` nightly 02:30 UTC

**Migration:**
- `market_regime` table (date PK, regime text, atr_pct, sma_ratio)
- `meta_label_model` table (id, coefficients jsonb, trained_at, sample_size, auc)
- `live_signals.regime text`, `live_signals.meta_score numeric`
- `signal_outcomes.meta_score numeric`
- GRANTs + RLS (public read on regime, service-role-only on model)

**Out of scope (intentionally):**
- No GICS sector upgrade
- No corporate action handling
- No factor-model neutralization
- No XGBoost / neural meta-labeler — logistic only for explainability + zero deps
- Meta-labeler defaults to pass-through when `meta_label_model` is empty (cold start safe)

---

Reply **"go"** to ship all three, or tell me which to drop/reorder.