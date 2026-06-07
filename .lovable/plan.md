# Engine Speed Bundle — "Hypercar engine" pass

Three optimizations. Zero behavior changes. Same signals, same fills, same math — just faster.

Target: scan latency from ~30-60s → ~5-15s on a 200-candidate run.

---

## 1. Parallelize the autotrader per-candidate gate loop

**File:** `supabase/functions/autotrader-scan/index.ts` (around L2292 / L2478 — the `for (const p of toExecute)` block that runs CVaR + slippage + meta-label + calibration per candidate).

**Today:** serial `await` per candidate. CVaR alone is ~1000 bootstrap paths × N positions × 5 days = ~50-200ms per call. With 50 candidates that's 2.5-10s wall-clock spent waiting on independent computations.

**Change:**
- Wrap the per-candidate gate work in an `evaluateCandidate(p)` async function returning `{ accept, reason, sizedKelly, … }`.
- Replace the loop with a bounded-concurrency map (semaphore = **8**, hand-rolled, no deps):
  ```ts
  async function mapLimit<T,R>(items: T[], limit: number, fn: (t:T)=>Promise<R>): Promise<R[]>
  ```
- Iterate results in original order to preserve heat-cap / sector-cap / single-name accounting (which IS order-dependent). Sequence the *accounting commit* serially after parallel evaluation completes.

**Ordering invariant:** Parallel = "evaluate the gates"; serial = "apply the running portfolio caps + execute". The two are split cleanly so we keep deterministic outcomes.

---

## 2. Cache the CVaR base-book per scan

**File:** `supabase/functions/_shared/portfolio-cvar.ts` + call site in `autotrader-scan/index.ts:2495`.

**Today:** `computePortfolioCvar(positions, nav)` is called once per candidate. The `positions` list is the same N open positions every time — only the candidate's marginal contribution differs. We're re-running 1000 bootstrap paths over the same N positions for every candidate.

**Change:** Add `computePortfolioCvarBase(positions, opts)` that:
1. Pre-draws B×H random indices into a `Int32Array` once.
2. Computes the base `pathPnls[b]` (dollars) over the N open positions once.
3. Returns `{ pathPnlsBase: Float64Array, indices, B, H }`.

Add `computePortfolioCvarMarginal(base, candidate, nav)` that:
1. For each of the B paths, **reuses the same H draws** for the candidate's return series — cumulative return per path is O(H) per candidate per path.
2. Adds `candidate.dollars * cum` to a cloned `pathPnls`.
3. Sorts, computes ES.

Net: per-candidate cost drops from O(B·N·H) to O(B·H). For N=10 open positions that's a **10× speedup** on the CVaR gate, plus the base sim only runs once per scan.

**Determinism:** same RNG seed across candidates so CVaR comparisons are consistent. The existing single-shot `computePortfolioCvar` stays as-is for callers that don't need the marginal form.

---

## 3. Vectorize the hot indicators in `_shared/indicators.ts`

**File:** `supabase/functions/_shared/indicators.ts` (337 lines, called from `evaluateSignal` for every ticker).

**Today:** SMA/EMA/RSI/ATR/stdev are recomputed via nested loops with allocator pressure (each call returns a fresh `number[]`). For 200 tickers × 250 bars × ~8 indicators that adds up.

**Change (incremental rolling forms, no math change):**
- **SMA:** maintain a running sum, subtract leaving bar, add entering bar. O(N) total instead of O(N·window).
- **EMA:** already incremental — verify and switch storage to `Float64Array`.
- **RSI (Wilder):** rolling avgGain/avgLoss with the standard smoothing recursion. Output identical to the textbook RSI.
- **ATR (Wilder):** same Wilder smoothing on True Range.
- **Stdev (rolling window):** Welford's online variance over a sliding window using the West algorithm (numerically stable, single pass).
- **Storage:** all internal buffers become `Float64Array`. Public return type stays `number[]` (or we expose an optional typed-array path for the hot worker loop and keep `number[]` for callers that JSON-serialize).

**Correctness guarantee:** add a one-time unit test that asserts the new forms match the old loop outputs within 1e-9 across a 1000-bar SPY series before deleting the old paths.

---

## Out of scope this pass

- Meta-label precomputed weights, finnhub earnings cache, fire-and-forget LLM explanations, orchestrator-side bars hydration — saved for the next batch so we can measure the impact of these three cleanly.

---

## Files touched

- `supabase/functions/autotrader-scan/index.ts` — gate loop refactor + `mapLimit` helper.
- `supabase/functions/_shared/portfolio-cvar.ts` — add `computePortfolioCvarBase` + `…Marginal`.
- `supabase/functions/_shared/indicators.ts` — vectorize SMA/EMA/RSI/ATR/stdev.
- New: `supabase/functions/_shared/indicators.test.ts` — parity tests.
- New memory note: `mem://architecture/prediction-engine/engine-speed-bundle.md`.

## Verification before declaring done

1. Run `_shared/indicators.test.ts` — must match legacy outputs within 1e-9.
2. Manual scan trigger via `curl_edge_functions` → compare generated `live_signals` row count and conviction distribution to a baseline scan (should be identical).
3. Check `function_edge_logs` for the scan duration delta.

Reply **"go"** to ship, or tell me which of the three to drop.