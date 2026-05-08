---
name: Multi-Horizon Return Forecasts
description: GBM drift+vol expected returns at 1d/1w/1m/1q/1y, on-demand via forecast-returns and persisted on live_signals
type: feature
---
- Shared math: `supabase/functions/_shared/return-forecasts.ts` (`computeReturnForecasts(close[])`)
  - Uses last 120 daily log returns; annualized drift winsorized to ±60%
  - GBM expected price ratio: `exp(μh + 0.5σ²h)`; 1σ band via `exp(μh ± σ√h)`
- On-demand edge function: `forecast-returns` (POST `{ticker}` → 5-horizon JSON, fetches 1y from Yahoo)
- Scanner integration: market-scanner & scan-worker compute `forecasts` per signal; persisted in `live_signals.forecasts` (jsonb)
- UI: `ReturnForecastPanel` (third dashboard tab "Forecasts") for per-ticker lookup; TradingTab signal cards show inline 1d/1w/1m/1q/1y strip
