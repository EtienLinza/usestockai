
You've correctly diagnosed that the current system is a static rule lookup table, not a decision-making system. The fix isn't more indicators — it's adding three architectural layers the system entirely lacks: outcome memory, adaptive weighting, and portfolio-level awareness.

## Architecture sketch

```text
CURRENT:  rule-table → conviction → trade  (no feedback, no memory, no portfolio view)

PROPOSED:
  rule-table → conviction
       ↓
  [adaptive weights]  ← nightly recalibration
       ↓                  ↑
  [portfolio gate]   [outcome memory]
       ↓                  ↑
     trade  ─────────  exit & log
```

## The phases

**Phase A — Outcome memory (foundation)**
New `signal_outcomes` table. Every signal `market-scanner` emits gets logged with full context (regime, profile, conviction, which rules fired, entry thesis tag). Every exit from `check-sell-alerts` logs realized PnL, exit reason, bars held, max favorable/adverse excursion. New "Calibration" view showing the *real* conviction → win-rate curve from live signals — not just backtest. **This is the substrate. Nothing else can learn without it.**

**Phase B — Adaptive consensus (depends on A)**
Nightly job reads last 90 days of outcomes. Three things it can do (you pick how aggressive):
- Re-fit conviction calibration so "80" actually means 80%
- Tilt strategy weights toward what's working in the current regime
- Auto-tune the conviction floor based on current-regime hit rates

**Phase C — Portfolio-aware gating (independent of A/B)**
Before any new signal opens a virtual position, check it against current holdings: sector concentration, rolling correlation, total portfolio beta. Closes the "long 10 tech names = 1 leveraged tech bet" hole. Critical for "put money in and walk away."

**Phase D — Macro regime layer**
Replace the binary SPY-200SMA filter with a composite score: SPY trend + VIX level + breadth proxy + credit spread proxy (HYG/LQD ratio). Conviction floor moves with the regime score.

**Phase E (deferred) — Forward-looking data + thesis-aware exits**
Earnings calendar, FOMC dates, options flow. And tagging entries with thesis IDs so a mean-reversion entry can exit when RSI normalizes (not just when an ATR stop fires). Larger surface area, possibly paid data — revisit after A-D.

## What's deliberately out

- True ML models. Premature without outcome memory; Phase B is statistical adaptation, not ML.
- Rebuilding the indicator engine. The rules aren't the problem — the lack of feedback around them is.

## Decisions I need before writing code

1. **Sequencing.** Phase A is a hard prerequisite for B. C and D can run before or in parallel with A. Build A first (highest leverage, no immediate user-visible payoff)? Or C first (most immediate user impact)? Or all of A+C+D in one push?
2. **How aggressive should Phase B's adaptation be?** Calibration only / + strategy reweighting / + auto-tuned thresholds. The aggressive option is the most "learning" but also the most surprising for users.
3. **Phase C cap strictness.** Soft warnings, hard auto-blocks, or per-user configurable caps?
4. **Phase E forward data.** Free sources only (Yahoo earnings + FOMC calendar), one paid feed (~$30-100/mo), or defer entirely until A-D prove out?

Answer those four and I'll cut a concrete build plan with specific tables, edge functions, and validation steps for the chosen phase.
