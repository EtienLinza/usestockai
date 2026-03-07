

# Smart Parameter Guardrails — Give Control Without Letting Users Self-Destruct

## The Problem
Right now, every parameter slider has wide ranges and no guidance. A user could set RSI Oversold to 40, ADX to 15, and Max Hold to 60 — a combination that would generate tons of low-quality trades. The adaptive profile system we built gets overridden when users change any parameter from its default, so a single bad slider move can nuke the algorithm's edge.

## Solution: Three-Tier Control System

### Tier 1 — Replace Raw Sliders with a "Strategy Mode" Selector (Primary Control)

Replace the "Signal Parameters" section with a single dropdown/radio group:

- **Adaptive (Recommended)** — Algorithm auto-detects stock type and optimizes all parameters. No signal sliders shown. This is the default.
- **Conservative** — Wider stops, higher conviction thresholds, fewer trades. Shows a read-only summary of what changed.
- **Aggressive** — Lower thresholds, longer holds, more trades. Shows a read-only summary.
- **Custom** — Unlocks all sliders (current behavior), but with guardrails (see Tier 2).

When Adaptive/Conservative/Aggressive is selected, signal parameter sliders are hidden entirely — users can't accidentally override profiles. The engine receives a `strategyMode` field instead of individual params.

### Tier 2 — Guardrailed Sliders (Custom Mode Only)

When "Custom" is selected, show the current sliders BUT with:

1. **Clamped ranges** — Tighter min/max to prevent extreme values:
   - Conviction: 50-85 (not 40-90)
   - ADX: 18-35 (not 15-40)
   - RSI Oversold: 20-35 (not 15-40)
   - RSI Overbought: 65-80 (not 60-85)
   - Max Hold: 8-40 bars (not 5-60)
   - Trailing Stop: 1.5-3.0 ATR (not 1.0-4.0)

2. **Visual danger zones** — Slider shows a colored zone (green = recommended, yellow = risky, red = dangerous). Simple color-coded text under each slider.

3. **Validation warnings** — If a user picks a bad combination (e.g., RSI Oversold > 35 AND low conviction), show an inline warning: "This combination may generate many low-quality signals."

### Tier 3 — Safe Defaults for Non-Signal Parameters

Keep Capital, Risk Per Trade, Position Size, Stop Loss, Take Profit, and Monte Carlo as always-visible sliders since these are risk management (not signal quality) and harder to break.

Tighten Risk Per Trade to 0.5-3% (currently 0.5-5%). 5% risk per trade is reckless for most users.

## Implementation

### File: `src/pages/Backtest.tsx`

**UI Changes:**
- Add `strategyMode` state: `"adaptive" | "conservative" | "aggressive" | "custom"` (default: `"adaptive"`)
- Add a 4-option radio group or segmented control above the signal parameters section
- Conditionally render signal sliders only when `strategyMode === "custom"`
- For non-custom modes, show a compact summary card: "Auto-optimized for each stock's behavior" or "Higher thresholds, fewer but safer trades"
- Tighten slider ranges in custom mode
- Add combination warnings (simple conditional text)

**Payload Changes:**
- When mode is not "custom", send `strategyMode` field instead of individual signal params
- When mode is "custom", send params as today but mark `explicitOverride: true`

### File: `supabase/functions/backtest/index.ts`

**Engine Changes:**
- Accept `strategyMode` field in the request body
- When `strategyMode === "conservative"`: apply a modifier to profiles — bump conviction thresholds by +10, reduce max holds by 20%, tighten trailing stops
- When `strategyMode === "aggressive"`: lower conviction by -5, extend holds by 25%, widen trailing stops
- When `strategyMode === "adaptive"` (or absent): current behavior — pure profile-based params
- When `strategyMode === "custom"`: current behavior — user params override profiles
- Remove the fragile "is this the UI default?" detection logic (lines 913-921) — replace with explicit `strategyMode` check

This eliminates the brittle default-detection code that was already causing bugs.

## What This Achieves

- **90% of users** pick Adaptive or Conservative and get optimal performance without touching anything
- **Power users** can go Custom but with guardrails that prevent the worst combinations
- The engine gets a clean signal about user intent instead of guessing from default values
- No more "user sent buyThreshold=65 which is the default but we can't tell if they meant it" bugs

