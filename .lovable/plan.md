# Autotrader Algorithm: Audit, Upgrade Plan & Competitive Analysis

This is a **research deliverable**, not a single-shot implementation. Each item below is a self-contained workstream; we'll pick which to implement and in what order after you review.

---

## 1. Audit — Issues Found in the Current Code

A deep read of `signal-engine-v2.ts`, `indicators.ts`, `calibration.ts`, `scan-pipeline.ts`, `autotrader-scan`, `scan-orchestrator`, `scan-worker`, and `market-scanner` surfaced the following. Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low.

### 🔴 Critical (correctness bugs — fix first)

| # | File:line | Issue |
|---|---|---|
| C-1 | `scan-orchestrator/index.ts:87–99` | Discovery-cache TTL check exists but the cached branch is empty. **Every** scan re-fetches GitHub + 12 Yahoo screener endpoints. Any network blip → 0 tickers → silent empty scan. |
| C-2 | `signal-engine-v2.ts:1027–1036` | `signalTrackerCache` is module-level in-memory. Edge functions cold-start between cron runs → cooldown tracker resets every invocation → **cooldown is effectively disabled**. |
| C-3 | `autotrader-scan/index.ts:981` | Position sizing uses `settings.starting_nav` (static) instead of current NAV. After a 20% drawdown the system sizes 25% too large; after a 20% gain, 17% too small. Only correct at account inception. |
| C-4 | `signal-engine-v2.ts:346–351` | `safeGet(sma50, spyPrice)` — when SMA is NaN the default is current price, so `spyPrice < s50` becomes `spyPrice < spyPrice` → false. Macro filter is silently bypassed on short data. |
| C-5 | `market-scanner/index.ts:1163–1164` | Batches >0 receive only the last 30 SPY bars as `spyContext`. The macro SMA200 guard needs 200 bars and defaults to "permit" with fewer → **macro regime filter only active for batch 0**. |

### 🟠 High

- **H-1** `businessDaysSince` (autotrader-scan:866) uses calendar-days × 5/7; ignores holidays. R-progress stall and time-stop fire late.
- **H-2** `atrPct` heuristic `atr <= 1` (indicators:312) misclassifies low-priced stocks; sizing collapses to $0 silently for any stock under ~$5.
- **H-4** `market-scanner` **duplicates** `computeMacroRegime`, `discoverTickers`, `fetchSectorMomentum`, `getSectorConvictionModifier`, `TICKER_TO_SECTOR_ETF`, `macroFloorAdjust` locally instead of importing from `scan-pipeline.ts`. Already drifting — silent fork risk for every future calibration change.
- **H-5** Bonus pool (signal-engine-v2:636) scales by `base × 0.25`, so the same indicator bonuses add ~11pts to a 45-conviction signal but ~15pts to a 60-signal. Convex amplification, no backtest justification, and it **defeats the calibration layer's linearity assumption**.
- **H-6** `realKelly` (signal-engine-v2:976) is **dead code** — `evaluateSignal:1249` never passes the `edge` arg, so cold-start ramp is permanent and live trade outcomes never feed sizing.
- **H-7** R-ladder and R-progress stop silently skip any position without `hard_stop_price` — legacy positions get no protection.
- **H-8** Correlation gate (autotrader-scan:403–415) computes Pearson over `min(a.length, b.length)` — short-history tickers compared against the same 0.75 threshold calibrated for 60 bars.

### 🟡 Medium (incomplete list, full one in audit report)

- **M-2** `calculateVolatility` uses population (n) not sample (n−1) variance → vol underestimated ~5% → positions ~2.5% oversized.
- **M-6** Vol-target uses only 20-bar SPY lookback; transient VIX spikes halve sizing for a month. Institutional standard is 63 bars.
- **M-9** HYG/LQD credit-spread ratio aligned by array index, not timestamp — silently corrupted on any data gap.
- **M-10** `preScreen` runs the full ADX/RSI/BBands/MA indicator suite as "fast rejection" — it isn't fast.
- **M-4** `blendProfiles` rounds all integer params → step discontinuities in the blending region.
- **M-5** Short entries use a double-negative regime guard; shorts can fire above 200-SMA in mixed regimes.

### 🟢 Low / Hygiene

- Dynamic `import("../_shared/cron-auth.ts")` inside the handler (autotrader-scan:1042) — should be top-level.
- Dead ternary `INDEX_TICKERS.has(t) ? "index" : "index"` (signal-engine-v2:311).
- SMA loop is O(n × period) instead of O(n) with a running sum.

### Pipeline / Operational

- **P-2** `signal_outcomes` upsert with `ignoreDuplicates` on `signal_id` — rows with null IDs silently duplicate, **corrupting calibration win-rate**.
- **P-3** Per-user loop is strictly serial — 50 users may exceed the 30s edge-function budget; tail users get stale or no evaluation.
- **P-4** No idempotency on `virtual_positions` inserts — retry after partial failure can create duplicate positions.
- **P-5** `scan-worker` swallows per-ticker errors with no counter — a complete Yahoo outage looks like a healthy zero-signal scan.
- **P-7** `strategy_weights` is read independently by `autotrader-scan` and `market-scanner` — concurrent runs during nightly recalibration use different weights.
- **P-8** `algoScanIntervalMinutes` (autotrader-scan:371) hardcodes UTC−4 (EDT). Wrong for 5 months/year (EST) — cadence misaligns with market hours during winter.

### Institutional Gaps (no code to fix — features absent)

- **G-1** Zero slippage / spread / market-impact modeling.
- **G-2** Drawdown circuit breaker fires on **closed** P&L only; ignores open MTM losses until realized.
- **G-3** Earnings blackout blocks new entries but **does not exit positions already held into earnings**.
- **G-5** No per-sector exposure cap. NVDA + AMD + AVGO at ρ=0.68 each pass the gate but the book is 3× XLK.
- **G-7** No portfolio-level VaR / CVaR / scenario stress.
- **G-8** No corporate-event handling (splits corrupt ATR; dividends trip the gap-pct rejection).
- **G-10** No automated model-decay alarm — `signal_outcomes` is logged but no monitor freezes the model if win-rate falls below calibration baseline.

---

## 2. Twenty Improvement Ideas (Prioritized)

Synthesis of competitor research (Trade Ideas, Composer, TrendSpider AI Strategy Lab, Tickeron, Numerai, López de Prado/Hudson & Thames practice). Difficulty: **S** < 2 weeks, **M** 2–6 weeks, **L** 6+ weeks.

| # | Idea | Why it helps *this* app | Diff. |
|---|---|---|---|
| 1 | **Earnings & FOMC blackout that also exits open positions** | Closes G-3. Eliminates the single largest tail-risk source (gap-through-stop). | S |
| 2 | **Purged k-fold CV + sample-uniqueness weighting in backtester** | Overlapping holding periods are leaking into the current walk-forward — almost certainly inflating Sharpe. Standard fix from López de Prado. | S |
| 3 | **Switch position sizing to current NAV (fix C-3)** | One-line fix that aligns sizing with actual equity. | S |
| 4 | **Persist signal-tracker cooldown to DB (fix C-2)** | Makes the documented cooldown actually work. | S |
| 5 | **Portfolio CVaR budget (e.g. ≤2% NAV at 95% ES)** | Closes G-7. Per-position sizing can't prevent a concentrated book from blowing past 5% daily. | M |
| 6 | **Sector exposure cap (≤25% per GICS sector) + beta target** | Closes G-5. The correlation gate misses cluster risk. | S |
| 7 | **HMM regime detection (bull / bear / volatile / choppy)** | Upgrade the single-threshold regime floor to a probabilistic soft state that modulates every signal's conviction. | M |
| 8 | **Triple-barrier labeling + meta-labeling filter** | A second model that filters the primary signal — cleanest López-de-Prado ML upgrade that doesn't replace the signal engine. | M |
| 9 | **Slippage / impact model (Almgren–Chriss square-root) feeding both backtest and live conviction** | Backtests with end-of-day fills overstate edge for any ticker traded at >0.5% of ADV. | M |
| 10 | **Conformal prediction intervals on conviction → uncertainty-aware sizing** | Wide band → smaller position; tight band → full Kelly. Lets the engine express forecast confidence. | M |
| 11 | **Analyst revision-momentum factor (EPS estimate trend velocity)** | Best documented orthogonal factor that's not in the stack. Cheap to add via FMP. | S |
| 12 | **Options flow / dark-pool prints as overlay (confirm or block)** | Leading indicator institutional desks watch. Polygon.io or Tradier API. | M |
| 13 | **Conditional Drawdown-at-Risk (CDaR) circuit breaker on MTM equity** | Closes G-2. Half exposure when rolling 30-day drawdown > 8% — before realization. | S |
| 14 | **Online drift detector (river/ADWIN) on signal win-rate** | Nightly recalibration is too slow for intra-day regime breaks. | M |
| 15 | **Natural-language explanation for each fired signal** | Composer/TrendSpider's biggest UX moat. Cheap LLM narrative over existing factor weights. | S |
| 16 | **Insider purchase clustering (Form 4) as signal multiplier** | Orthogonal to technicals, low-cost, well-documented anomaly. | S |
| 17 | **Short-interest velocity (FINRA biweekly) as decay filter** | Catches squeezes and deteriorating fundamentals. | S |
| 18 | **Fractional differentiation of price features (d ∈ (0,1))** | Principled stationarity-with-memory fix for any future ML layer. | S |
| 19 | **TWAP/VWAP execution slicing (live mode)** | For any position > 0.2% of ADV. 5–20 bps saving per trade. | M |
| 20 | **Factor neutralization (market + momentum + size via Fama-French)** | Decompose signals into systematic vs idiosyncratic; size only on the idiosyncratic piece. Prevents momentum-crash blowups. | L |

**Suggested first sprint (highest impact, lowest effort):**
1. Fix the 5 Critical bugs (C-1 → C-5) — these are pure correctness wins.
2. Purged k-fold + uniqueness weighting in the backtester (#2) — restores backtest integrity.
3. Earnings/FOMC blackout (#1) and sector cap (#6) — pure tail-risk elimination.
4. CDaR drawdown circuit breaker on MTM (#13) — closes the biggest portfolio risk gap.

That sprint alone fixes the things most likely to silently hurt performance today.

---

## 3. Competitive Landscape — What Others Are Doing

What modern peers ship that we don't:

- **Composer** ($28B traded, 15M+ orders): GPT-4 strategy authoring + a marketplace of shareable "symphonies" — explainability and community are their moat.
- **TrendSpider AI Strategy Lab**: natural-language strategy generation, automated walk-forward, multi-asset backtests — explainability + automated robustness.
- **Trade Ideas (Holly AI)**: continuously-rerun overnight strategy search, real-time alerts ranked by simulated edge.
- **Tickeron**: explicit confidence/explanation per signal, "AI agents" per regime.
- **Tradytics / Flowtopia / AI FlowTrader**: options-flow + dark-pool prints as the primary differentiator (our #12).
- **QuantConnect retail**: Almgren–Chriss slippage built in since 2023 (our #9), realistic fill simulation (#17 in research).
- **Numerai**: stacked ensemble of weak signals — diverse-but-weak beats single-strong; the tournament structure is the moat (#19).
- **Institutional-to-retail leakage 2024–26**: HMM regime models, conformal prediction intervals, meta-labeling, purged k-fold CV, fractional differentiation, online learning with drift detection (`river`). All represented in the 20-list above.

Things we already have that competitors mostly don't: isotonic calibration, walk-forward + Monte Carlo + robustness/stress in the backtester, SPY-vol-target sizing, correlation gating, half-Kelly, nightly regime-floor tuning. The product is genuinely ahead on calibration and backtest depth; it's behind on **portfolio-level risk**, **alt-data**, and **execution realism**.

---

## What I'm Asking For

This plan is research + a menu. Reply with the slice you want me to actually build first — likely candidates:

- **"Fix the 5 Criticals"** (≈ half-day each, all in one PR)
- **"Sprint 1 as outlined above"** (Criticals + backtest CV + earnings blackout + sector cap + CDaR breaker)
- **A specific subset of the 20** (e.g. "do 1, 6, 11, 13, 15")
- **All of section 1's bugs, then we plan section 2 separately**

I won't touch code until you pick.