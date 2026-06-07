---
name: Vol-Target Lookback 63d (M-6)
description: SPY-vol-target scalar now uses 63-bar realized vol (institutional standard) instead of 20; logs the fast 20d alongside for transparency
type: feature
---

`autotrader-scan/index.ts` — `VOL_LOOKBACK` changed from 20 → 63 (≈ one quarter), matching the institutional risk-parity standard. The previous 20-bar window was too noisy: a single transient VIX spike halved sizing for ~30 trading days after the spike rolled off, even when realized vol had already normalized.

- `VOL_TARGET_ANNUAL = 0.16` unchanged.
- `VOL_LOOKBACK = 63` (slow / sizing driver).
- `VOL_LOOKBACK_FAST = 20` retained — measured every scan, logged alongside the 63d value, returned via `volTargetScalar()` as `spyVolFast` for future overlays. Not used for sizing today.
- Fallback chain: if SPY history < 64 bars, fall back to the 20-bar measurement so fresh universes still get a non-trivial scalar.
- `VOL_SCALAR_MIN/MAX = 0.5/1.25` unchanged.

Closes audit gap **M-6** ("Vol-target uses only 20-bar SPY lookback; transient VIX spikes halve sizing for a month").
