
The user has done a rigorous critique of the backtest. They're not asking for new features — they want the **measurement tools fixed** before any more algo work. The three concrete bugs they've identified:

1. **Beta calculation is broken** — returning ~0.04 for a 75-87% deployed long-only equity portfolio (impossible)
2. **Robustness/parameter-sensitivity test is not actually varying parameters** — identical results across ±20/±30/±40 perturbations
3. **Stress test attribution is broken** — showing +75% to +1008% returns during 2008/COVID crashes for long-biased books

Let me read the relevant backtest code to confirm what's actually happening.
<lov-tool-use id="toolu_vrtx_01XVQbUXqtA3TiJWFBYatdVw" name="code--list_dir" integration-id="code" data="{\"dir_path\": \"supabase/functions/backtest\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01SQzuDJfZdaZkbbW3r5Vy2W" name="code--exec" integration-id="code" data="{\"command\": \"wc -l supabase/functions/backtest/index.ts\", \"user_facing_description\": \"Checking backtest engine size\"}">
</lov-tool-use>
I'm in plan mode (read-only). Let me investigate the three bugs the user identified.
<lov-tool-use id="toolu_vrtx_01XoG9NMyq4rJECJD2hfuyiw" name="code--list_dir" integration-id="code" data="{\"dir_path\": \"supabase/functions/backtest\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01FTeGaPu5qCLKieewfcrPJh" name="code--exec" integration-id="code" data="{\"command\": \"wc -l supabase/functions/backtest/index.ts && grep -n -i \\\"beta\\\\|alpha\\\\|robustness\\\\|stress\\\\|sensitivity\\\\|kurtosis\\\\|skewness\\\" supabase/functions/backtest/index.ts | head -120\", \"user_facing_description\": \"Locating beta, robustness and stress test logic in the backtest engine\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01VfEyrK8LEgcUmpgh7vERMh" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/backtest/index.ts\", \"lines\": \"1690-1780\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01GVjBK9SxperBjqvm7GkB5E" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/backtest/index.ts\", \"lines\": \"2160-2300\"}">
</lov-tool-use>
Now I have enough to diagnose all three bugs. Let me also check `runWalkForwardBacktest` to confirm `buyThreshold`/`shortThreshold` are actually consumed:
<lov-tool-use id="toolu_vrtx_01JHU3yXNfCxAa1FPhBnZrmR" name="code--exec" integration-id="code" data="{\"command\": \"grep -n \\\"buyThreshold\\\\|shortThreshold\\\\|runWalkForwardBacktest\\\\b\\\" supabase/functions/backtest/index.ts | head -40\", \"user_facing_description\": \"Checking whether threshold parameters are actually used inside the walk-forward backtest\"}">
</lov-tool-use>
Confirmed. Now I have the full picture of the three bugs. Let me also check the equity curve sampling to understand the beta issue better:
<lov-tool-use id="toolu_vrtx_01A2PHhT1kcCb6p5SnDEuize" name="code--exec" integration-id="code" data="{\"command\": \"grep -n \\\"equityCurve.push\\\\|dailyEqReturns\\\" supabase/functions/backtest/index.ts | head -20\", \"user_facing_description\": \"Checking equity curve sampling cadence\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_013PkMKCMXabv5bXEdz2JoHF" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/backtest/index.ts\", \"lines\": \"1455-1480\"}">
</lov-tool-use>
Now I have a complete diagnosis. Let me also confirm the stress-test attribution issue: `stratReturn` simply *sums* `t.returnPct` of all trades that closed in the window (no notion of position size or direction). For a basket of 5 tickers each compounding ~30% per trade with several trades closed during a long window, that easily produces +1000%. Got it.

<lov-plan>

## Diagnosis — three measurement bugs

**Bug 1: Beta ≈ 0.04 across all baskets**

Equity curve is sampled every 5 bars (line 1462) AND only when an open position exists is `openMTM` mark-to-market — but `capital` itself only changes on trade close, not bar-by-bar. Combined with the `eqReturnsByDate.set` map keyed by date being abandoned (the actual `stratRets` is built from `sortedEqCurve` interval-to-interval), most equity-curve "intervals" show ~0 change while SPY is moving daily. Cov(strat, SPY) collapses → beta → ~0. Alpha is then computed from this broken beta.

Fix: sample equity curve **every bar** (mark-to-market with `close[i]` whether or not a position is open), align strat-vs-SPY returns by exact date intersection (drop missing dates), and compute beta on the resulting daily series. With 75–87% deployment, beta should land around 0.6–0.9 — that's the sanity check.

**Bug 2: Parameter sensitivity returns identical numbers for ±20/±30/±40**

Line 2270: `{ ...config, buyThreshold: thresh, shortThreshold: -thresh }`. But signal generation reads `signalParams?.buyThreshold` (line 507) — and `signalParams` is built inside `runWalkForwardBacktest` from the *adaptive profile* (lines 1109/1117) using `profile.buyThreshold`, **not** from `config.buyThreshold`. So the perturbation is silently dropped and every variation runs the same strategy. Identical numbers to 4 sig figs is the proof.

Fix: thread `config.buyThreshold` / `config.shortThreshold` through to the signal-params override (override the profile after lookup, before passing to the signal function). Verify by logging mean conviction at each threshold — they should diverge.

**Bug 3: Stress-test returns of +1008% / +166% / +75% during crashes**

Line 2189: `stratReturn = windowTrades.reduce((a, t) => a + t.returnPct, 0)` — naively *adds* per-trade percent returns with no weighting. A basket with 5 tickers and 30 trades in a 60-bar window where each trade returned ~25% gives "stratReturn = +750%" even if the actual portfolio was flat. The 60-bar/30-step rolling window also picks the *worst 60-day SPY drawdown inside the window* as the "stress period" — which doesn't necessarily align with the named crisis dates (the COVID/2008 labels are just date-prefix matches on the *start* of the window, which can fall months before the actual crash).

Fix: replace summed `returnPct` with the actual **equity-curve delta** over the stress window (`(eqAtEnd − eqAtStart) / eqAtStart`). And anchor the named periods (COVID, 2008, 2022, Q4 2018) to **fixed historical date ranges**, not pattern-matched 60-bar SPY windows. That way "2008 Financial Crisis" always means 2008-09-01 → 2009-03-31.

## Build plan — fix the measurement layer

### File: `supabase/functions/backtest/index.ts`

**1. Daily equity curve (foundation for fixes 1 & 3)**

Change line 1462 from `if (i % 5 === 0 || i === close.length - 2)` to record **every bar**. Always include open-position MTM. This makes `dailyEqReturns`, beta, and stress-test deltas all correct.

**2. Beta/Alpha rewrite (lines 1703–1764)**

- Build `eqReturnByDate: Map<date, dailyReturn>` from the now-daily equity curve.
- Build `spyReturnByDate` (already exists).
- Take the date intersection, build aligned `stratRets[]` and `benchRets[]`.
- Compute `beta = cov / var(SPY)` on those daily aligned returns.
- Compute `alpha = annualizedReturn − beta * spyAnnReturn` (already correct, just needs valid beta).
- Add a sanity log: `console.log({ beta, expectedRange: '[0.4, 1.2] for long-biased strategy' })`.

**3. Parameter-sensitivity actually varies parameters (lines 2266–2284)**

Pass `config.buyThreshold` / `config.shortThreshold` through to `runWalkForwardBacktest` such that they override the adaptive profile's threshold inside the signal call (modify lines 1109 & 1117 to honor a config override, or pass an explicit `signalOverrides` arg). Add an assertion: if all three sensitivity rows are identical to 2 decimal places, log a warning and tag `parameterSensitivity` with `degenerate: true`.

**4. Stress-test attribution (lines 2163–2211)**

- Replace the sliding 60-bar SPY-drawdown scanner with a **fixed historical periods table**: `[{ label: 'COVID Crash', start: '2020-02-19', end: '2020-04-07' }, { label: '2008 Financial Crisis', start: '2008-09-01', end: '2009-03-31' }, { label: 'Q4 2018 Selloff', start: '2018-10-01', end: '2018-12-31' }, { label: '2022 Bear Market', start: '2022-01-01', end: '2022-10-15' }, { label: 'Aug 2015 China', start: '2015-08-01', end: '2015-09-30' }, { label: 'Aug 2024 Yen Carry', start: '2024-08-01', end: '2024-08-15' }]`.
- For each window present in the data, compute strategy return as **equity curve delta**: find equity at first and last in-window dates, return `(end − start) / start * 100`. This is correct portfolio-level return.
- Benchmark return computed the same way on SPY closes.

**5. Drop-in safety net**

Add a `metricsHealth` field to the response with three booleans: `betaInRange` (0.2–1.5 for long-biased), `parameterSensitivityVaried` (>1% spread across rows), `stressReturnsPlausible` (no row > +200% or < −80%). Render a warning banner on the Backtest page when any are false — so future regressions can't hide.

### File: `src/pages/Backtest.tsx`

- Read `metricsHealth` from the report; if any flag is false, show a yellow banner above the metric cards explaining which measurement is suspect.
- No other UI changes needed — the existing cards will simply now show honest numbers.

## Validation steps after the fix

Re-run the same 5-basket backtest (2000–2025, 25 tickers across the 5 archetypes). Sanity checks:
1. Beta lands in **0.4–1.0** range across baskets (currently 0.04 → broken).
2. Parameter-sensitivity rows differ by at least 2–5% return across thresholds.
3. Indexes basket during 2008 returns somewhere in **−15% to +5%**, not +166%.
4. High-vol basket during COVID returns **−30% to +30%**, not +1008%.

If those four pass, the measurement layer is honest. *Then* — and only then — we can have a real conversation about whether the algo beats buy-and-hold (which, per your read, it currently doesn't for 4 of 5 baskets — that's the next problem to solve, but it's downstream of trustworthy metrics).

## What's deliberately out of scope here

- Fixing the underperformance vs buy-and-hold. That's a strategy problem, not a measurement problem. Once metrics are honest we'll see whether the gap is real or partly a beta-misattribution illusion.
- Touching the live `_shared/signal-engine.ts`. These bugs are confined to the backtest measurement code — the live trading pipeline is unaffected.

