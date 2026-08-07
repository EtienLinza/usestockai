# Asymmetric Edge Upgrade — Lose Less, Make More

## The honest math (verified from live data, last 90 days)

- 26 closed trades, all from the **trend** strategy: **38.5% win rate, -44.8% cumulative**. One strategy is the entire bleed.
- 11 hard-stop exits = **-88.6% combined**. The five worst (-18.9%, -14.8%, -12.6%, -10.5%, -8.9%) are **overnight gaps through the stop** — the stock opens below the stop, so no stop cap can prevent them. Only position size can.
- Winners already work: earnings pre-exits +22.3%, peak detection +22%. The exit/win logic is not the problem.

**Setting expectations plainly:** a 100% win rate does not exist — not for hedge funds, not for anyone. What we *can* engineer: any single trade's worst case capped near ~1% of NAV, strategies that provably lose get benched automatically, and the setups that actually win get more capital. That is "lose less AND make more" from the same set of changes — it raises expectancy per trade.

## Changes

### 1. Gap-risk position cap — kills the -18.9% class of loss
- Compute each ticker's overnight gap history (`|open / previous close − 1|`) from the 1y daily bars already in the bar cache (open prices are already fetched — no new data source).
- Cap entry dollars so a 95th-percentile bad gap costs **≤ 1% of NAV** (`GAP_LOSS_CAP_NAV_PCT = 1.0`).
- Gappy, stop-jumping names automatically get tiny positions; clean names keep full size.
- Applied in the live entry sizing path after the existing vol-target/slippage caps, and mirrored in the backtest simulator so backtest matches live exactly (shared helper in `_shared/adaptive-context.ts` — the rule both sides already import).

### 2. Gap-through-stop feedback loop
- When an exit fills *worse* than the stop (a gap), record the fill-vs-stop slippage into `signal_outcomes` (fields already exist: `slippage_bps_est`, exit data).
- The nightly per-ticker calibration then automatically penalizes chronically gappy tickers — they get entered less often, smaller, or not at all. Self-healing, no manual work.

### 3. Strategy expectancy circuit breaker — benches the -44.8% trend bleed
- Nightly `calibrate-weights` computes trailing 90-day expectancy per strategy (min 15 closed trades).
- **Negative expectancy → benched**: that strategy's conviction floor jumps +10 (effectively suspends it) until its trailing record recovers.
- **Positive expectancy with strong sample → tilt range widened** from today's ±15% to ±25%, so capital flows harder toward what's working.
- The scanner already reads floors/tilts from `strategy_weights` — this plugs into the existing pipeline, no new plumbing.

### 4. Edge-scaled sizing — bigger bets on A+ setups
- Today every entry gets roughly the same Kelly-fraction size regardless of signal quality.
- New: scale position size by edge quality (calibrated conviction + meta-label score blend) as a **0.5×–1.5× multiplier** — elite setups get up to 1.5× current size, marginal ones half.
- Every existing safety cap still applies on top: single-name cap, 6% portfolio heat cap, CVaR budget, and the new gap cap. Upside scales, downside stays bolted down.

### 5. Learning-loop watchdog — never starve silently again
- The losses you just saw happened because the learner was training on zero data for weeks and nobody got alerted.
- Nightly check: if the autotrader is enabled but **zero closed outcomes landed in 7 days**, mark the system heartbeat degraded and surface it in SystemHealth. A silent starvation becomes impossible to miss.

## Technical details (for reference)

- **Files touched**: `supabase/functions/autotrader-scan/index.ts` (gap cap in sizing, gap-fill logging), `supabase/functions/_shared/adaptive-context.ts` (gap-percentile helper + constants), `supabase/functions/_shared/backtest-sim.ts` (parity), `supabase/functions/calibrate-weights/index.ts` (expectancy breaker + wider tilts), heartbeat watchdog in the nightly job chain.
- **No new tables, no new secrets, no new external APIs** — uses existing bar cache, `strategy_weights`, `signal_outcomes`, and `cron_heartbeat`.
- Constants: `GAP_LOSS_CAP_NAV_PCT = 1.0`, `GAP_LOOKBACK = 1y of bars`, `EXPECTANCY_MIN_SAMPLES = 15`, edge multiplier clamped to `[0.5, 1.5]`.

## What this does NOT do
- No 100% win rate — impossible for any system, full stop. What you get instead: worst single-trade loss ≈ 1% of NAV, provably losing strategies benched automatically, and capital concentrated on verified winners. Losses become small, rare, and survivable; winners get bigger.
