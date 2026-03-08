

# Backtest Results: 15 Sectors, 2000-2025 (Post Deterministic Slippage + Proportional Sizing)

## Results Summary

```text
Batch                   | Tickers                    | Ann. Ret  | Alpha   | Win Rate | W/L Ratio | Avg Ret
========================|============================|===========|=========|==========|===========|========
Tech Core               | AAPL,MSFT,INTC,CSCO,ORCL   | -9.20%   | -17.67  | 46.98%   | 2.61      | +3.09%
Tech Semis 1            | IBM,HPQ,DELL,ADBE,TXN       | -14.36%  | -19.51  | 46.57%   | 2.22      | +2.24%
Tech Semis 2            | QCOM,AMAT,KLAC,LRCX,MU      | +2.72%   | -16.64  | 52.86%   | 3.37      | +5.97%
Tech + Retail           | NVDA,EBAY,WMT,TGT,COST      | -0.84%   | -17.27  | 53.72%   | 2.71      | +4.36%
Consumer Discretionary  | HD,LOW,MCD,SBUX,NKE          | -28.90%  | -34.23  | 38.83%   | 1.53      | -0.05%
Consumer Staples        | KO,PEP,PG,CL,KMB             | -31.33%  | -34.22  | 35.78%   | 1.44      | -0.31%
Financials Core         | JPM,BAC,C,WFC,GS              | -4.86%   | -23.03  | 49.26%   | 2.88      | +3.77%
Healthcare 1            | JNJ,PFE,MRK,LLY,AMGN         | -11.52%  | -13.39  | 43.97%   | 2.78      | +2.13%
Energy                  | XOM,CVX,COP,SLB,HAL           | -14.48%  | -28.41  | 49.60%   | 1.91      | +2.20%
Industrials             | GE,CAT,DE,MMM,HON             | -7.65%   | -16.51  | 45.50%   | 2.98      | +2.82%
Telecom/Utilities       | T,VZ,DUK,SO,AEP               | -21.15%  | -21.18  | 46.45%   | 1.98      | +1.05%
Defense/Transport       | UPS,FDX,BA,LMT,RTX            | -19.47%  | -27.44  | 42.81%   | 2.13      | +1.25%
Financials 2            | MS,AXP,USB,PNC,BK             | -9.35%   | -18.77  | 45.01%   | 3.11      | +2.91%
Healthcare 2            | ABT,MDT,GILD,SYK,ISRG         | -16.45%  | -19.78  | 43.87%   | 2.70      | +1.72%
Energy/Materials 2      | EOG,OXY,APA,DD,DOW            | -14.28%  | -13.59  | 42.65%   | 2.65      | +2.29%
```

## Verdict: Still Deeply Negative — The Core Problem Persists

Results are now **deterministic** (confirmed — identical to last run), but performance is worse than the previous random-slippage run. Only 1/15 sectors is profitable (Tech Semis 2 at +2.72%). The "good" previous run was a lucky random seed.

## The Fundamental Contradiction Remains

Per-trade metrics are positive across 13/15 sectors (avg returns +1% to +6%), yet annualized returns are deeply negative (-5% to -31%). This paradox points to a **compounding capital erosion problem** that the proportional sizing fix did NOT solve.

## Root Cause: Position Sizing Still Destroys Capital

The `capital * allocDelta * 0.90` formula means:
- At 25% allocation: only 22.5% of capital deployed per scale block
- After a -5% loss on 22.5% position: capital drops 1.1%
- But with 4 scale blocks active, 90% of capital is deployed
- A -5% move across all 4 blocks = -4.5% capital hit
- Recovery requires +4.7% just to break even
- Over 25 years with ~200+ trades, this asymmetry compounds into massive drawdowns

The engine makes money per trade on average but **loses money overall** because losing trades compound faster than winning trades recover.

## Proposed Fix: Fundamental Architecture Change

Three options to consider:

### Option A: Fixed Fractional Position Sizing (Kelly-based)
Replace the 25% allocation blocks with Kelly Criterion-derived position sizes. With a 47% win rate and 2.5x W/L ratio, optimal Kelly fraction is ~28% per trade (half-Kelly = 14%). This prevents overexposure while maximizing geometric growth.

### Option B: Stop Trading, Just Hold the Weekly Trend
Replace the allocation scaling entirely with a simple binary system: 100% in when weekly bias is "long", 100% cash when "flat" or "short". One entry, one exit per trend cycle. Eliminates the 4-block scaling overhead and transaction costs entirely.

### Option C: Reduce Transaction Costs to Near-Zero
The current 0.50% round-trip cost (spread + slippage) is destroying returns. With ~200+ trades over 25 years, that's 100%+ in friction. Reduce to 0.10% (realistic for large-cap liquid stocks) and re-test.

All three can be combined. The most impactful is likely Option B — the scaling mechanism itself is the problem.

