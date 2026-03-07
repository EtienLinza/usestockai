Redesign Trading Strategy Logic — From Toy Signals to Real Quant Strategies

The Problem

The current computeSignal function (lines 166-240) is a naive indicator poll: it looks at the last bar's RSI, MACD, Stochastic, etc., tallies bullish/bearish scores, and fires a trade if the consensus crosses a threshold. This means:

• RSI drops from 52 to 49 → triggers a bearish vote change → can flip the entire signal

• No confirmation — a single bar's noise triggers entries

• No trend filter — it shorts into raging bull markets

• No volatility filter — it trades in dead-flat chop where all signals are noise

• No cooldown — it can reverse positions every 5 bars (the STEP size)

• Same strategy in every regime — uses momentum logic in mean-reversion environments and vice versa

• Fixed position sizing — same % regardless of signal conviction or volatility

Real quant firms use regime-adaptive multi-strategy systems. Here is what needs to change.

Implementation Plan

Backend Changes (supabase/functions/backtest/index.ts)

1. Replace computeSignal with computeStrategySignal — A Multi-Strategy Regime-Adaptive Engine

Instead of one consensus poll, implement 3 distinct strategies that activate based on market regime:

Strategy A: Trend Following (activates when ADX > 25)

• Requires EMA12 > EMA26 AND price > SMA50 for BUY (all three aligned)

• MACD histogram must be positive AND increasing (momentum confirmation)

• RSI must be between 40-70 (not overbought — trend continuation zone)

• Signal must persist for 3 consecutive bars before triggering (confirmation filter)

Strategy B: Mean Reversion (activates when ADX < 20, Bollinger bandwidth < threshold)

• RSI < 25 for BUY, RSI > 75 for SHORT (extreme levels only, not 30/70)

• Price must be outside Bollinger Bands (statistical extreme)

• Stochastic must confirm (< 15 for BUY, > 85 for SHORT)

• Volume must spike > 1.5x 20-period average (institutional activity)

Strategy C: Breakout (activates when Bollinger bandwidth squeeze detected)

• Bandwidth contracts to < 50% of its 50-period average (squeeze)

• Price breaks above/below the band with volume > 2x average

• ADX must be rising (new trend forming)

• Wait for close outside band, not just wick (false breakout filter)

Each strategy returns a conviction score (0-100) based on how many sub-conditions are met.

2. Add Signal Confirmation System

New function SignalTracker that:

• Requires the same directional signal for N consecutive evaluation windows (default 2) before triggering

• Prevents whipsaw trades from single-bar noise

• Resets if signal flips back to neutral

3. Add Trade Cooldown

After exiting a trade, enforce a minimum cooldown of 3 evaluation steps (15 bars) before re-entering. Prevents overtrading in choppy conditions.

4. Add Volatility-Adjusted Position Sizing

Replace fixed positionSizePct with:

adjustedSize = baseSizePct * (targetVolatility / currentVolatility)

• High volatility → smaller positions (risk parity)

• High conviction signal → up to 1.5x base size

• Capped at 2x base and floored at 0.25x base

5. Add Trend Filter (200-period SMA Guard)

Global filter: Do NOT short when price is above 200 SMA. Do NOT buy when price is below 200 SMA. This single rule eliminates a huge class of losing trades in real markets.

6. Track Which Strategy Generated Each Trade

Add strategy: "trend" | "mean_reversion" | "breakout" to the Trade interface so the frontend can show strategy attribution.

Frontend Changes (src/pages/Backtest.tsx)

7. Add Strategy Attribution Section

New card showing:

• Trades per strategy (Trend / Mean Reversion / Breakout)

• Win rate per strategy

• Avg return per strategy

• This tells users which strategy is actually working

8. Update Trade Log

Add strategy column to trade log table.

What Stays the Same

• All existing metrics computation (Sharpe, Sortino, drawdown, etc.)

• All robustness tests, Monte Carlo, stress testing

• All existing charts and UI

• Walk-forward structure (train/test windows)

• Transaction cost model

• Stop-loss / take-profit execution

Scope

• Backend: ~200 lines rewritten (computeSignal → computeStrategySignal), ~60 lines added (cooldown, confirmation, vol-adjusted sizing, trend filter)

• Frontend: ~40 lines added (strategy attribution card + trade log column)

• Trade interface: 1 field added (strategy)

&nbsp;

# Replace Signal Logic with Strict Mean-Reversion Entry Conditions

## Current Problem

`computeSignal` (lines 166-240) is a voting system where 7 indicators each cast partial votes. A tiny RSI change (e.g. 31→29) can flip the whole signal. Real strategies require **all conditions true simultaneously**.

## What Changes

### `supabase/functions/backtest/index.ts` — Replace lines 166-240

Replace the voting body with a strict conjunction-based strategy:

**BUY signal requires ALL of:**

1. RSI(14) < 25 (real extreme, not 30)
2. Price < Lower Bollinger Band (2σ break)
3. Price > 3% below SMA(50) — `(sma50 - price) / sma50 > 0.03`
4. Volume > 1.2× its 20-period average
5. ADX < 30 (mean reversion only works in non-trending markets)

**SHORT signal requires ALL of:**

1. RSI(14) > 75
2. Price > Upper Bollinger Band
3. Price > 3% above SMA(50)
4. Volume > 1.2× average
5. ADX < 30

**If any condition fails → HOLD (consensusScore ≈ 0)**

**Conviction scoring** — based on how far past thresholds each condition is:

- RSI distance from threshold (RSI at 15 → higher conviction than RSI at 24)
- Price distance beyond BB (further = stronger)
- SMA deviation magnitude (6% > 3.1%)

**Regime classification** stays the same (ADX + DI based) since it's used for reporting only.

### Return values stay compatible

The function still returns `{ consensusScore, regime, predictedReturn, confidence }` — same interface, so no other code changes needed. The difference is `consensusScore` will be 0 most of the time (no trade) and only spike to high values when real setups form.

### Scope

- ~75 lines replaced in one function
- No interface changes, no frontend changes, no new files