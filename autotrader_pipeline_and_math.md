# AutoTrader Pipeline + Full Math Notes

## Response 1: Full structure/pipeline from turning on autotrader to finalizing a trade

Perfect question. Here’s the **full end-to-end autotrader pipeline** from enabling it to a trade being finalized.

---

## 0) User turns AutoTrader ON

This starts with a row in `autotrade_settings` where `enabled = true`. On each cron run, the service first loads only enabled users. 【F:supabase/functions/autotrader-scan/index.ts†L566-L571】

It also supports:
- kill switch (`kill_switch`)
- advanced/adaptive mode
- max positions/exposure/conviction controls
- paper mode toggle. 【F:supabase/functions/autotrader-scan/index.ts†L106-L122】【F:supabase/functions/autotrader-scan/index.ts†L600-L615】

---

## 1) Scheduled scan starts (global preflight)

The autotrader function runs periodically and does shared prefetch:
- SPY, VIX
- latest active `strategy_weights.regime_floors`. 【F:supabase/functions/autotrader-scan/index.ts†L578-L592】

Then it builds macro context:
- `spyTrend` from SPY SMA slope
- `vixRegime` buckets. 【F:supabase/functions/autotrader-scan/index.ts†L145-L168】【F:supabase/functions/autotrader-scan/index.ts†L589-L591】

---

## 2) Per-user gating and adaptive risk tuning

For each enabled user:

1. **Kill switch check** (if ON → skip entries/exits and log). 【F:supabase/functions/autotrader-scan/index.ts†L600-L615】  
2. **Cadence check** (`next_scan_at`) to avoid scanning too frequently. 【F:supabase/functions/autotrader-scan/index.ts†L617-L621】  
3. **Recent P&L computation** (rolling 7-day closed P&L). 【F:supabase/functions/autotrader-scan/index.ts†L623-L635】  
4. **Effective settings recomputed** from risk profile + VIX + SPY trend + recent P&L + calibration floors, then clamped to safety bounds. 【F:supabase/functions/autotrader-scan/index.ts†L170-L276】  
5. Optional state persisted to `autotrader_state` so UI can show “why settings changed.” 【F:supabase/functions/autotrader-scan/index.ts†L647-L664】

---

## 3) Build user universe (positions + watchlist)

Within `processUser(...)`:

- Load open positions + watchlist.
- Optionally auto-add/remove watchlist names from fresh `live_signals` (discovery loop). 【F:supabase/functions/autotrader-scan/index.ts†L896-L911】【F:supabase/functions/autotrader-scan/index.ts†L782-L883】

Then dedupe all symbols and batch-fetch 1Y OHLCV into an in-memory cache for this invocation. 【F:supabase/functions/autotrader-scan/index.ts†L917-L925】【F:supabase/functions/autotrader-scan/index.ts†L50-L68】

---

## 4) Data quality circuit breaker

Before any decisioning, it runs a scan-health verdict on fetched data and can abort the run if data quality is bad. 【F:supabase/functions/autotrader-scan/index.ts†L926-L952】

If tripped:
- logs circuit-breaker status for users
- heartbeat marks error
- no trading decisions proceed. 【F:supabase/functions/autotrader-scan/index.ts†L690-L710】

---

## 5) Exit pass runs first (risk-first lifecycle)

For each existing position:

1. Compute live-ish context (current price, P&L).
2. Re-run canonical signal context for thesis checks (`evaluateSignal`).
3. Classify profile (momentum/value/index/volatile).
4. Apply **loss exit** first; if none, apply **win/peak exit**. 【F:supabase/functions/autotrader-scan/index.ts†L973-L1008】

### Exit brains:
- **Loss engine**: hard stop, thesis invalidation while losing, strategy-specific failure, time stop. 【F:supabase/functions/autotrader-scan/index.ts†L422-L475】
- **Win engine**: 5-signal peak detector (trailing hit, RSI divergence, volume climax, MACD rollover, thesis completion), full/partial exits. 【F:supabase/functions/autotrader-scan/index.ts†L301-L419】

### Exit execution:
- FULL_EXIT closes row, writes cooldown, logs trade, posts `sell_alerts`.
- PARTIAL_EXIT splits shares and logs partial.
- HOLD updates trail/peak if needed. 【F:supabase/functions/autotrader-scan/index.ts†L1127-L1224】

This is where a trade can be **finalized** on the exit side.

---

## 6) Entry pass (only after exits)

If slots are still available after exits:

1. Enforce portfolio-level blockers:
   - daily loss limit
   - max positions
   - max NAV exposure. 【F:supabase/functions/autotrader-scan/index.ts†L495-L504】

2. Run canonical `evaluateSignal(...)` for each watchlist ticker. 【F:supabase/functions/autotrader-scan/index.ts†L506-L509】

3. Keep only candidates above min conviction and with valid sizing after exposure caps. 【F:supabase/functions/autotrader-scan/index.ts†L509-L525】

4. Build entry payload with:
   - decision (BUY/SHORT)
   - kellyFraction (capped by user risk)
   - ATR-based hard stop
   - strategy/profile metadata. 【F:supabase/functions/autotrader-scan/index.ts†L527-L548】

5. Rank candidates by conviction and stagger with `MAX_ENTRIES_PER_SCAN = 2`. 【F:supabase/functions/autotrader-scan/index.ts†L1038-L1043】

---

## 7) Canonical signal engine internals (how ENTER signal is born)

`evaluateSignal(...)` requires all of the following:

1. weekly bias not flat
2. strategy signal direction matches weekly bias
3. daily timing trigger confirms
4. conviction nonzero
5. macro permits direction. 【F:supabase/functions/_shared/signal-engine-v2.ts†L966-L1003】

Only then it returns BUY/SHORT with conviction + Kelly fraction. 【F:supabase/functions/_shared/signal-engine-v2.ts†L1005-L1019】

---

## 8) Entry execution (trade opens)

When executing an ENTER:

1. Block if not paper mode.
2. Block if market closed.
3. Fetch live quote (fallback-enabled).
4. Reject suspicious quote gaps (>8% from previous close).
5. Recompute fill + hard stop from live quote.
6. Compute shares from `starting_nav * kellyFraction`.
7. Insert open `virtual_positions` row and log `ENTRY`. 【F:supabase/functions/autotrader-scan/index.ts†L1226-L1320】

At this point the trade is **opened/finalized on entry**.

---

## 9) Ongoing lifecycle after entry

Once open, subsequent scans:
- update/ratchet trailing state,
- can partially or fully close,
- enforce cooldown days post-close. 【F:supabase/functions/autotrader-scan/index.ts†L1127-L1181】

So finalization can occur via:
- immediate open (ENTRY),
- partial close,
- full close with reason and alert.

---

## 10) Optional external portfolio gate (separate service)

There is also a dedicated `portfolio-gate` function that computes sector concentration, beta, and correlated-position violations and returns allow/warn/block. 【F:supabase/functions/portfolio-gate/index.ts†L124-L144】【F:supabase/functions/portfolio-gate/index.ts†L209-L244】

It’s a pre-trade risk gate service. In this codebase, autotrader currently does not directly call it inside `executeEntry`, but it exists as part of the broader pipeline architecture. 【F:supabase/functions/portfolio-gate/index.ts†L245-L260】

---

## Response 2: Full math for each step in detail

Absolutely — here is the **full math layer** behind the autotrader pipeline, step by step, from signal generation through sizing, entry, and risk gates.

---

## 1) Regime / macro gating math

### 1.1 SPY trend slope (autotrader adaptive context)

Autotrader computes SPY trend from 50-SMA slope over ~5 bars:

\[
\text{slope}=\frac{SMA50_t - SMA50_{t-5}}{SMA50_{t-5}}
\]

Then classifies:
- up if slope \(> 0.005\)
- down if slope \(< -0.005\)
- else flat. 【F:supabase/functions/autotrader-scan/index.ts†L145-L156】

### 1.2 VIX regime bucket

\[
\text{regime}=
\begin{cases}
\text{calm} & VIX<15\\
\text{normal} & 15\le VIX<22\\
\text{elevated} & 22\le VIX<30\\
\text{crisis} & VIX\ge 30
\end{cases}
\]

Used later for dynamic tightening/loosening of risk settings. 【F:supabase/functions/autotrader-scan/index.ts†L162-L168】

### 1.3 Macro direction permission (shared engine)

Given SPY closes:
- compute \(SMA50, SMA200\)
- 5-bar momentum:

\[
m_5=\frac{SPY_t-SPY_{t-5}}{SPY_{t-5}}
\]

Bear regime:

\[
SPY_t<SMA50_t \land SPY_t<SMA200_t \land m_5<-0.02
\]

Bull regime:

\[
SPY_t>SMA50_t \land SMA50_t>SMA200_t
\]

Rules:
- block longs in bear regime,
- block shorts in bull regime,
- block longs if stressed flag set. 【F:supabase/functions/_shared/signal-engine-v2.ts†L313-L336】

---

## 2) Adaptive settings math (user-level risk transformation)

Starting from profile baseline (or advanced settings), autotrader modifies four core controls:
- `min_conviction`
- `max_positions`
- `max_nav_exposure_pct`
- `max_single_name_pct`. 【F:supabase/functions/autotrader-scan/index.ts†L170-L207】

Then adds deterministic deltas:

- VIX layer (e.g., crisis: +10 conviction, hard cap positions/nav/single-name)
- SPY trend layer (downtrend: +4 conviction, -10 NAV)
- recent 7-day P&L layer (drawdown -> tighter)
- optional calibration floor uplift. 【F:supabase/functions/autotrader-scan/index.ts†L208-L257】

Final hard clamps:

\[
\begin{aligned}
\text{minConv} &\in [55,95]\\
\text{maxPos} &\in [1,20]\\
\text{maxNav} &\in [20,100]\\
\text{maxSingle} &\in [5,50]
\end{aligned}
\]

【F:supabase/functions/autotrader-scan/index.ts†L260-L275】

---

## 3) Signal engine core math

## 3.1 Stock classification (shared)

### Daily returns:
\[
r_i=\frac{C_i-C_{i-1}}{C_{i-1}}
\]

### Return mean:
\[
\bar r=\frac{1}{N}\sum r_i
\]

### Volatility (std):
\[
\sigma=\sqrt{\frac{1}{N}\sum (r_i-\bar r)^2}
\]

### MA alignment ratio over recent window:
\[
\text{maAlignment}=\frac{\#\{C_i>SMA50_i>SMA200_i\}}{\#\text{valid bars}}
\]

### Higher-highs ratio across 20-bar chunks:
\[
\text{HHratio}=\frac{\#(\max\text{current chunk} > \max\text{previous chunk})}{\#\text{chunks}}
\]

### Trend score:
\[
\text{trendScore}=0.6\cdot\text{maAlignment}+0.4\cdot\text{HHratio}
\]

Then mean-reversion-rate and ATR%-based branch logic select profile (momentum/value/index/volatile), sometimes blending profile parameters. 【F:supabase/functions/_shared/signal-engine-v2.ts†L190-L220】【F:supabase/functions/_shared/signal-engine-v2.ts†L126-L147】

## 3.2 Weekly bias math

Weekly bars are aggregated; then weekly EMA/RSI/ADX drive directional allocation ladder:
- long allocations: \(0.25, 0.5, 1.0\)
- short allocations: \(-0.25, -0.5, -1.0\)
- or flat \(0\), with macro veto integrated. 【F:supabase/functions/_shared/signal-engine-v2.ts†L153-L181】【F:supabase/functions/_shared/signal-engine-v2.ts†L342-L406】

## 3.3 Daily timing confirmation math

For directional timing:

- EMA relation (12 vs 26)
- RSI band constraints
- MACD histogram sign
- volume adequacy:
\[
\text{volOK}: \quad V_t \ge 0.7\cdot \overline{V}_{20}
\]
- range adequacy:
\[
\text{rangeOK}: \quad (H_t-L_t)\ge 0.5\cdot ATR_{14}
\]

Need at least 2/3 core signals + vol/range filters. 【F:supabase/functions/_shared/signal-engine-v2.ts†L412-L453】

Low-vol mean-reversion timing uses:
- long: \(RSI<40\) and \(P_t < 1.01\cdot SMA20\)
- short: \(RSI>60\) and \(P_t > 0.99\cdot SMA20\). 【F:supabase/functions/_shared/signal-engine-v2.ts†L455-L477】

## 3.4 Final decision conjunction

`evaluateSignal` returns BUY/SHORT only if all gates pass:

\[
\text{decision} \neq HOLD \iff
(\text{bias matches signal dir}) \land
(\text{daily timing true}) \land
(\text{confidence} > 0) \land
(\text{macroOk})
\]

Else HOLD with explanation. 【F:supabase/functions/_shared/signal-engine-v2.ts†L966-L1003】

---

## 4) Position sizing math (Kelly-like + vol targeting)

Core formula:

\[
kellyBase = 0.10 + \frac{\text{conviction}-60}{40}\cdot 0.15
\]

(valid only if conviction \(\ge 60\), otherwise 0)

\[
volScalar = \min\left(1.5,\frac{targetVol}{atrPct}\right),\quad targetVol=0.01
\]

\[
raw = kellyBase \cdot volScalar
\]

\[
kellyFraction = \pm \min(0.25,\max(0,raw))
\]

(sign negative for shorts). 【F:supabase/functions/_shared/signal-engine-v2.ts†L818-L830】

So sizing rises with conviction and falls with ATR%.

---

## 5) Entry decision math (autotrader layer)

After signal output, autotrader applies portfolio caps:

\[
\text{headroom}=\frac{maxNavExposurePct-totalNavExposurePct}{100}
\]

\[
cappedFrac = \min(\text{sig.kellyFraction},\; maxSingleNamePct/100,\; headroom)
\]

\[
targetDollars = startingNav \cdot cappedFrac
\]

Reject if \(targetDollars < currentPrice\) (can’t buy at least one share). 【F:supabase/functions/autotrader-scan/index.ts†L516-L525】

Initial hard stop from ATR:

\[
hardStop =
\begin{cases}
price - ATR\cdot hardStopATRMult & \text{long}\\
price + ATR\cdot hardStopATRMult & \text{short}
\end{cases}
\]

【F:supabase/functions/autotrader-scan/index.ts†L527-L535】

---

## 6) Execution math at fill time

At actual entry, it re-prices using live quote and recomputes stop to preserve ATR multiple:

\[
stopATRMult = \frac{|signalPrice-hardStop_{signal}|}{ATR}
\]

\[
hardStop_{live}=
\begin{cases}
fillPrice - ATR\cdot stopATRMult & \text{long}\\
fillPrice + ATR\cdot stopATRMult & \text{short}
\end{cases}
\]

Dollar allocation:

\[
dollars = startingNav \cdot kellyFraction
\]

Shares:

\[
shares = \left\lfloor \frac{dollars}{fillPrice} \right\rfloor
\]

Logged slippage:

\[
slipPct = \frac{fillPrice-signalPrice}{signalPrice}\cdot 100
\]

【F:supabase/functions/autotrader-scan/index.ts†L1279-L1316】

---

## 7) Exit math (trade finalization)

## 7.1 P&L percent
For long:
\[
pnlPct=\frac{P_t-entry}{entry}
\]
For short:
\[
pnlPct=\frac{entry-P_t}{entry}
\]

Used throughout win/loss exits. 【F:supabase/functions/autotrader-scan/index.ts†L314-L317】【F:supabase/functions/autotrader-scan/index.ts†L430-L433】

## 7.2 Win-exit trailing ratchet

Peak updates:
- long: \(peak=\max(oldPeak, P_t)\)
- short: \(peak=\min(oldPeak, P_t)\)

Trailing candidate:
\[
trailCandidate=
\begin{cases}
peak-ATR\cdot trailingStopATRMult & \text{long}\\
peak+ATR\cdot trailingStopATRMult & \text{short}
\end{cases}
\]

Monotone ratchet:
- long: \(trail=\max(oldTrail, trailCandidate)\)
- short: \(trail=\min(oldTrail, trailCandidate)\)

Then `trailingHit` if price crosses trail. 【F:supabase/functions/autotrader-scan/index.ts†L318-L332】

## 7.3 Peak detector voting

After minimum profit floor (+6%), it scores 5 booleans:
1. trailing hit
2. RSI divergence
3. volume climax
4. MACD rollover
5. thesis completion

Exit logic:
- FULL_EXIT if fired \(\ge 3\)
- PARTIAL_EXIT (50%) if fired \(=2\) and profit near target
- else HOLD. 【F:supabase/functions/autotrader-scan/index.ts†L338-L419】

## 7.4 Loss-exit hierarchy

- hard stop hit
- thesis invalidation if \(pnlPct<-3\%\)
- time stop after profile hold window. 【F:supabase/functions/autotrader-scan/index.ts†L434-L475】

This is how a trade mathematically reaches final state (`FULL_EXIT` or `PARTIAL_EXIT`).

---

## 8) Optional portfolio gate math (external pre-trade service)

If used, it computes:

### 8.1 Beta of each ticker vs SPY
From returns \(r^s_i, r^m_i\):
\[
\beta=\frac{\sum (r^s_i-\bar r^s)(r^m_i-\bar r^m)}
{\sum (r^m_i-\bar r^m)^2}
\]
(default 1.0 if insufficient data/zero variance). 【F:supabase/functions/portfolio-gate/index.ts†L60-L79】

### 8.2 Portfolio beta
\[
\beta_{portfolio}=\frac{\sum (\beta_j \cdot value_j)}{\sum value_j}
\]

### 8.3 Candidate sector concentration
\[
sectorPct=\frac{sectorValue_{afterCandidate}}{totalValue_{afterCandidate}}\cdot 100
\]

### 8.4 Correlated count
\[
correlatedCount = |\text{tickers in candidate sector after add}|
\]

Violations compare these to user caps and output allow/warn/block. 【F:supabase/functions/portfolio-gate/index.ts†L168-L207】【F:supabase/functions/portfolio-gate/index.ts†L209-L240】
