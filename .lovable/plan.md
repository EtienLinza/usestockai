

## Expanding the Market Scanner to Cover the Whole Market

### The Question
You currently have ~75 hardcoded tickers in the market scanner. Can we expand to the whole market using the same Yahoo Finance screener approach the Guide tab uses?

### Short Answer
**Yes, absolutely.** The Guide tab already does this — it pulls 150-180 tickers dynamically from Yahoo Finance screeners (`day_gainers`, `most_actives`, `undervalued_growth_stocks`, etc.) and then filters them down. We can apply the same layered approach to the market scanner.

### How It Would Work

**Layer 1 — Dynamic Discovery (Yahoo Screeners)**
Instead of a hardcoded 75-ticker list, fetch tickers from multiple Yahoo screeners:
- `most_actives` — high volume movers
- `day_gainers` — momentum candidates
- `undervalued_growth_stocks` — value plays
- `aggressive_small_caps` — small cap opportunities
- `growth_technology_stocks` — tech momentum

This alone gives 150-200 unique tickers per scan, covering a much broader slice of the market.

**Layer 2 — Quick Pre-Filter (no data fetch needed)**
From the screener response we already get volume, market cap, and percent change. Use these to immediately reject illiquid/penny stocks:
- Minimum volume threshold (e.g., 500K daily)
- Minimum market cap (e.g., $1B)
- Skip ADRs, warrants, and non-equity tickers

This cuts the list to ~80-120 quality candidates.

**Layer 3 — Full Technical Analysis (existing engine)**
The surviving tickers go through the existing pipeline: fetch 1Y daily data → weekly bias → daily entry signal → conviction scoring. Only signals with conviction ≥ 55 get saved.

### Key Design Decisions

**Keep the hardcoded universe as a fallback.** If Yahoo screeners fail (rate limits, API changes), the scanner falls back to the existing 75 tickers so it never returns zero results.

**Merge, don't replace.** Combine screener-discovered tickers with the hardcoded universe to guarantee sector coverage. The hardcoded list ensures blue-chips are always checked; screeners add dynamic market movers.

**Batch size stays the same.** The scanner already batches (25 tickers per edge function call). We just increase the total number of batches. Frontend already handles this with the progress bar.

**Unique constraint handles overlap.** Since we added the `UNIQUE(ticker)` constraint and use `upsert`, duplicate tickers from screeners + hardcoded list are handled automatically.

### Changes Required

1. **`supabase/functions/market-scanner/index.ts`**
   - Add `fetchMarketScreeners()` function (adapted from stock-predict's `fetchMarketScreener`)
   - Merge screener results with existing `SCAN_UNIVERSE` for a combined ticker list
   - Add pre-filter logic (volume, market cap thresholds)
   - Pass the merged list to the existing batch processing pipeline

2. **`src/pages/Dashboard.tsx`**
   - Update the total batch count display since there will be more batches (~6-8 instead of 3-4)
   - No other UI changes needed — the existing batch progress bar and signal list already handle variable counts

### Tradeoffs
- **Scan time increases** from ~30s to ~60-90s (more tickers to fetch data for), but the batching + progress bar already handles this gracefully
- **Yahoo rate limits** — the existing 200ms delay between fetch batches should be sufficient; if not, we can increase to 500ms
- **Edge function timeout** — each batch stays within the 25-ticker limit, so individual function calls won't timeout

