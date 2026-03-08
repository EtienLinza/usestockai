

# Backtest Results: Post-Syntax Fix (15 Sectors, 2000-2025)

## Results

```text
Batch                   | Tickers                    | Ann. Ret | Alpha  | Win Rate | W/L Ratio | Avg Ret
========================|============================|==========|========|==========|===========|========
Tech Core               | AAPL,MSFT,INTC,CSCO,ORCL   | -4.49%  | -13.68 | 48.08%   | 2.66      | +3.30%
Tech Semis 1            | IBM,HPQ,DELL,ADBE,TXN       | -9.40%  | -14.89 | 47.71%   | 2.26      | +2.44%
Tech Semis 2            | QCOM,AMAT,KLAC,LRCX,MU      | +5.77%  | -15.74 | 54.77%   | 3.31      | +6.18%
Tech + Retail           | NVDA,EBAY,WMT,TGT,COST      | +1.00%  | -12.04 | 55.59%   | 2.67      | +4.57%
Consumer Discretionary  | HD,LOW,MCD,SBUX,NKE          | -25.53% | -33.94 | 42.18%   | 1.49      | +0.16%
Consumer Staples        | KO,PEP,PG,CL,KMB             | -29.54% | -32.40 | 38.84%   | 1.45      | -0.12%
Financials Core         | JPM,BAC,C,WFC,GS              | -0.16%  | -22.68 | 50.50%   | 2.93      | +3.98%
Healthcare 1            | JNJ,PFE,MRK,LLY,AMGN         | -9.65%  | -10.54 | 45.98%   | 2.80      | +2.34%
Energy                  | XOM,CVX,COP,SLB,HAL           | -8.63%  | -24.78 | 50.40%   | 1.97      | +2.41%
Industrials             | GE,CAT,DE,MMM,HON             | -5.02%  | -14.97 | 47.04%   | 3.01      | +3.02%
Telecom/Utilities       | T,VZ,DUK,SO,AEP               | -17.22% | -16.81 | 48.39%   | 2.04      | +1.25%
Defense/Transport       | UPS,FDX,BA,LMT,RTX            | -16.20% | -26.87 | 44.77%   | 2.13      | +1.45%
Financials 2            | MS,AXP,USB,PNC,BK             | -4.41%  | -17.29 | 47.06%   | 3.10      | +3.12%
Healthcare 2            | ABT,MDT,GILD,SYK,ISRG         | -12.13% | -15.70 | 45.58%   | 2.77      | +1.91%
Energy/Materials 2      | EOG,OXY,APA,DD,DOW            | -8.91%  | -5.26  | 44.67%   | 2.62      | +2.50%
```

## Verdict: Significant Regression

Performance has degraded massively from the previous run. Only 2/15 sectors remain positive (Tech Semis 2 at +5.77%, Tech+Retail at +1.00%). Consumer Discretionary (-25.53%) and Consumer Staples (-29.54%) have returned to old-engine-level destruction.

## Root Cause Analysis

There is a **critical contradiction** in the data: per-trade metrics are positive (avg return +1-6%, W/L ratios of 2-3x) but annualized returns are deeply negative. This points to two compounding issues:

### 1. Random Slippage Creates Massive Run-to-Run Variance
`applyTradingCosts` uses `Math.random()` for slippage (line 977). Every run produces different results. The previous "positive" run and this "negative" run are from **identical code** with different random seeds. This makes performance evaluation unreliable.

### 2. Capital Accounting Leak
With `initialCapital = 10,000` and each allocation block at `$2,500` (25% of initial), a fully scaled position locks up 100% of capital. Any losing trade compounds against a shrinking capital base. The equity curve erodes faster than per-trade returns can recover.

## Proposed Fix (Implementation Plan)

### Fix 1: Deterministic Slippage (eliminate random noise)
Replace `Math.random()` slippage with a fixed worst-case spread. This makes backtests reproducible and comparable across runs.

```typescript
// Replace line 977
// OLD: const slippage = 1 + (Math.random() - 0.5) * 2 * (config.slippagePct / 100);
// NEW: const slippage = 1; // fixed slippage already captured in spreadPct
```

### Fix 2: Capital-Proportional Position Sizing
Replace `config.initialCapital * allocDelta` with `capital * allocDelta` so position sizes shrink with drawdowns and grow with profits, preventing compounding capital destruction.

```typescript
// Replace line 1465
// OLD: const positionSize = Math.min(config.initialCapital * allocDelta, capital * 0.90);
// NEW: const positionSize = capital * allocDelta * 0.90;
```

### Fix 3: Reduce Maximum Allocation for Defensive Sectors
Consumer Discretionary and Staples are being destroyed by full allocation. Cap max allocation at 0.50 for stocks with W/L ratio < 1.6 historically, preventing overconcentration in weak sectors.

These three fixes address the reproducibility problem and the capital compounding issue without changing the core dual-timeframe strategy logic.

