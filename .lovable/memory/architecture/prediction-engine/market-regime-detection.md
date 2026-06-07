---
name: Market Regime Detection
description: SPY-derived 4-state market regime classification with soft strategy-conditional conviction tilts (±15%)
type: feature
---
**Regime states (classified daily from SPY):**
- `bull_quiet`: 50d > 200d SMA AND ATR% < 1.2
- `bull_volatile`: 50d > 200d SMA AND ATR% ≥ 1.2
- `bear_quiet`: 50d < 200d SMA AND ATR% < 1.5
- `bear_volatile`: 50d < 200d SMA AND ATR% ≥ 1.5
- `neutral`: fallback when SMAs unavailable

**Tilt matrix (capped ±15%, applied AFTER eps-revision overlay in `signal-engine-v2.ts`):**
- trend × bull_quiet ×1.10, × bear_volatile ×0.85
- mean_reversion × bull_volatile ×1.12, × bull_quiet ×0.92
- breakout × bull_quiet ×1.10, × bear_volatile ×0.85

**Persistence:** `market_regime` table (date PK). Classified once per scan in `scan-orchestrator`, surfaced as a UI chip in `TradingTab` via `MarketRegimeBadge`. Soft tilt only — never blocks an entry, never gates a HOLD.

**Module:** `supabase/functions/_shared/regime-detector.ts` exports `classifyRegime`, `upsertRegimeSnapshot`, `loadLatestRegime`, `regimeConvictionMultiplier`.
