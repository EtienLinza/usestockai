# Algo Improvement Roadmap

A prioritized, end-to-end plan to push **scanner edge**, **exits/risk**, **portfolio construction**, and the **learning loop** further. Grouped into 4 phases — each phase is independently shippable. Rough impact tags: **[E]** edge / win-rate, **[R]** risk-adjusted return, **[L]** learning speed, **[O]** ops cost.

---

## Phase 1 — Signal Quality (scanner edge)

Goal: fewer false positives, better entry timing, more honest conviction.

1. **Multi-timeframe confirmation** [E]
   - Add a weekly-bar agreement check inside `evaluateSignal`: long signals require weekly EMA20 > EMA50 (or weekly RSI > 50 + rising); shorts require the inverse. Disagreement → cap conviction at floor or downgrade to HOLD.
   - Already pulling `weeklyBias` — extend it to a hard gate, not just a tag.

2. **Volume / liquidity quality score** [E]
   - Replace the binary "volume confirmed" check with a `volumeZ` (today vs 20-day avg, z-scored). Feed it as a continuous conviction modifier (±5).
   - Add a hard min-ADV gate (e.g. $20M/day) and dollar-spread proxy (ATR/price < X) to prune illiquid noise before AI/scoring.

3. **Breadth-aware divergence detection** [E]
   - Track RSI/MACD bullish divergence over the last 20 bars (lower price low, higher indicator low) as a discrete contributing rule with weight. Same for bearish.
   - Currently only end-of-window levels are checked; divergence is a real edge.

4. **Earnings & event blackout** [E][R]
   - Use Finnhub (already a secret) to fetch upcoming earnings and **block new entries within 3 trading days** of an earnings date, or downgrade conviction by 10 pts.
   - Same for ex-dividend gaps if relevant.

5. **Honest conviction calibration** [E][L]
   - Apply **Platt scaling / isotonic regression** on raw conviction → realized win-rate, instead of the current ±8 bucket adjust. Fit nightly in `calibrate-weights`.
   - Output: a smooth monotonic mapping per strategy. Improves probability quality everywhere downstream (sizing, exits, portfolio gate).

6. **Pre-screen tightening** [O][E]
   - In `scan-pipeline.preScreen`, add: trend coherence (ADX > 18 OR BB squeeze release), and an "unactionable" filter (gap > 5% today, halted, post-earnings whipsaw).

---

## Phase 2 — Risk & Exits (where most P&L is actually made)

7. **Partial profit-taking ladder** [R]
   - Replace single take-profit with a 3-tier scale-out: 1/3 at 1R, 1/3 at 2R, trail the last 1/3 with widened ATR trail. Hugely improves expectancy + capture ratio.
   - Backtest evidence already shows capture ratio is the key lever; `exit_calibration` is in place — extend it to per-strategy scale-out fractions, not just trail mult.

8. **Time-based stops** [R]
   - If a position hasn't moved ≥0.5R in N bars (N depends on strategy: 5 for scalp, 10 for swing, 20 for position), close it. Cuts dead-money tail risk.
   - Already have `bars_held` in `signal_outcomes` — calibrate N from data.

9. **Chandelier / Supertrend trailing stop** [R]
   - Swap the static ATR trail for **Chandelier (highest-high − k·ATR)** or **Supertrend**. Preserves more of the trend, gives back less on pullbacks. k auto-tuned per regime by `exit_calibration`.

10. **Stop placement quality** [R]
    - Stops should sit just beyond *structural* levels (recent swing low, VWAP, 20-EMA), not pure ATR. Add a `structuralStop = max(swingLow_10bars, ema20 − 0.25·ATR)` and use the tighter of structural vs ATR.

11. **Exit-side signal evaluation** [R]
    - Run `evaluateSignal` on open positions every bar in `autotrader-scan` (not just on entry). If the engine flips to opposite-side or HOLD with deteriorating regime, exit immediately rather than waiting for stop. Adds an "intent" exit alongside price-based exits.

---

## Phase 3 — Portfolio Construction (autotrader)

12. **Risk-parity sizing v2** [R]
    - Current vol-target sizing uses SPY vol as a scalar. Upgrade to **per-position risk budget**: each position contributes equal % portfolio σ. Compute via 60-day cov matrix of open names + candidate.
    - Combined with correlation gating already in place, this is the "real" institutional portfolio layer.

13. **Regime-conditional exposure curve** [R]
    - Replace the binary risk-on/off NAV cap with a **continuous max-NAV curve** as a function of `macro.score`: e.g. NAV cap = 30% + 0.7 × score. Lets capital lean in during clear risk-on without manual tweaking.

14. **Sector / factor caps refinement** [R]
    - Extend `portfolio-gate` from sector ETF only → **factor exposure**: long-only momentum/quality/value/size buckets via a small ticker→factor table. Cap any single factor at 40%. Prevents "all momentum" books.

15. **Pyramiding / position adds** [R]
    - Allow adding 0.5× initial size to a winner that re-triggers within 10 bars and is up ≥1R, **only if** new conviction ≥ original. Cap total position at 1.5× initial. Mirrors trend-following best practice.

16. **Drawdown circuit breaker** [R]
    - Beyond per-day loss limit: rolling 5-day and 20-day drawdown gates. If portfolio is in top decile of historical drawdown speed, halve sizing for the next N entries until equity recovers above prior peak × 0.97.

---

## Phase 4 — Learning Loop (faster, sharper adaptation)

17. **Contextual bandit on strategy selection** [L]
    - Replace static `strategy_tilts` with a **Thompson-sampling bandit** keyed on `(strategy, regime, profile)`. Each closed trade updates a Beta(α,β) for that arm. Scanner samples from posterior to choose tilts → faster exploration/exploitation than 90-day weighted average.

18. **Per-feature attribution** [L]
    - Log `contributing_rules` weights per signal (already a column!) and run **logistic regression** nightly: rule presence → outcome. Down-weight underperforming rules, boost overperforming ones. Auto-pruning of dead signals.

19. **Walk-forward validation guardrail** [L][R]
    - Before activating a new `strategy_weights` row, paper-validate it on the most recent 2 weeks of held-out outcomes. If win-rate regresses >5 pts vs current active row, skip the swap and alert.

20. **Per-ticker memory horizon** [L]
    - Current ticker_calibration uses 90 days flat. Add an **EWMA half-life of 30 days** — a stock that changed character (e.g. NVDA 2022 vs 2024) adapts faster. Bayesian shrinkage stays.

21. **Outcome enrichment** [L]
    - Capture **MAE-time** (bars to max adverse excursion) and **slippage proxy** (fill vs next-bar open). These unlock smarter stop calibration and execution-cost modeling.

---

## Suggested ship order (8 weeks of work, but each item is independent)

```
Week 1-2  →  #1 multi-TF, #2 volume z-score, #6 prescreen, #4 earnings blackout
Week 3    →  #7 partial exits, #9 chandelier, #8 time stop
Week 4    →  #5 isotonic calibration, #11 intent exit
Week 5-6  →  #12 risk-parity v2, #13 continuous NAV curve, #14 factor caps
Week 7    →  #15 pyramiding, #16 drawdown breaker
Week 8    →  #17 bandit, #18 rule attribution, #19 WF guardrail, #20 EWMA, #21 enrichment
```

## Technical Notes

- **Where most code lands**: `_shared/signal-engine-v2.ts` (Phase 1, #11), `autotrader-scan/index.ts` (Phase 2, 3), `calibrate-weights/index.ts` (Phase 4), `_shared/scan-pipeline.ts` (Phase 1 #6), `portfolio-gate/index.ts` (Phase 3 #14).
- **Schema changes**: extend `strategy_weights.exit_calibration` JSON with `{scaleOuts, timeStopBars, chandelierK}`; add `signal_outcomes.mae_bars`, `slippage_bps`; add `factor_map` table for #14.
- **Backtester parity**: each item must be mirrored in the backtest path (per existing "shared logic replication" rule) so we can validate before live.
- **CPU**: bandit + isotonic stay nightly only — zero live cost. Multi-TF and divergence add ~10-15% to scanner CPU; offset by tighter prescreen.
- **Risk of overfitting**: WF guardrail (#19) is the kill-switch for any new weights row. Ship it before #17.

---

## What I'd do first if forced to pick 5

1. #7 Partial exits ladder — biggest expectancy win
2. #5 Isotonic calibration — fixes everything downstream
3. #1 Multi-TF gate — kills a class of false longs
4. #9 Chandelier trail — better capture without more risk
5. #19 WF guardrail — protects the system from itself

Tell me which subset to implement, or say "go" for the full Week 1-2 batch.
