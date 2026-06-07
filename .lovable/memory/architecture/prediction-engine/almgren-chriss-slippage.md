---
name: Almgren-Chriss Slippage Model
description: Square-root impact model replaces the flat-bps haircut; auto-shrinks order size when expected slippage exceeds 30% of expected edge
type: feature
---
**Module:** `_shared/slippage-model.ts` exports `estimateSlippage`, `estimateExpectedEdgeBps`, `slippageShrinkFactor`.

**Math:**
```
slippageBps = γ · (Q/ADV) + η · σ · √(Q/ADV)
γ = 10 bps   (permanent impact coefficient)
η = 12 bps   (temporary impact per unit of daily vol)
σ = atrPct   (clamped 0.001..0.20)
```

**Shrink rule:** When `slippageBps > 0.30 × expectedEdgeBps`, shrink the order until the ratio is satisfied. Approximate solver uses the dominant √ term: `factor ≈ (edge·ratio / slippageBps)²`.

**Wiring (autotrader-scan):** After `evaluateSignal` and before `executeEntry`, compute ADV = `mean(last 20 close × volume)`, apply `slippageShrinkFactor` to `kellyFraction`. Persisted as `slippage_bps_est` on `live_signals` and `signal_outcomes`. Append `| slip=Xbps×Y%` to reasoning string when shrink fires.

**Cold-start safety:** No ADV available → no shrink (factor=1). Sane clamps prevent divide-by-zero or runaway shrink.

**Backtest parity:** The same module ships in `_shared` so a future backtest pass can call `estimateSlippage` and replace the flat haircut without forking math.
