# Trust-the-money hardening plan

Three concrete changes. No new dependencies. All deterministic.

---

## 1. 🧠 Rip AI out of every trading-adjacent path

**Scope** (per your call: "everything trading-adjacent"):

| Surface | Today | After |
|---|---|---|
| `autotrader-scan` → `getSentiment()` → `news-sentiment` | AI-scored sentiment fed into entry/exit | **Removed.** All `getSentiment()` calls + `use_news_sentiment` setting deleted from autotrader. |
| `news-sentiment` edge function | LOVABLE_API_KEY + Gemini call | **Replaced** with a deterministic headline-keyword scorer (bullish/bearish word lists, source weighting). Same `{score, confidence, headlines, reasoning}` contract so `NewsPanel` keeps working — just pure rules now. |
| `stock-predict` edge function | 2,591 lines, 3 AI calls | **Deleted.** No code path calls it anymore (manual prediction UI was removed weeks ago — it's orphaned). Removes ~$$ exposure + the biggest single attack surface. |
| `WatchlistSuggestions.tsx` | Static seed list (already not AI) | No change — confirmed it's not AI-backed. |
| `weekly-digest` | Pure SQL summary, no AI | No change. |

**Result**: zero AI in any code path that touches a position, signal, stop, or entry. Pure deterministic quant + technicals. Backtest ↔ live parity is preserved (signal-engine-v2 was already AI-free).

**Files touched**:
- `supabase/functions/autotrader-scan/index.ts` — strip `getSentiment`, sentiment cache, sentiment branches in entry/exit logic, the `use_news_sentiment` flag.
- `supabase/functions/news-sentiment/index.ts` — rewrite as keyword scorer (NewsAPI fetch stays; AI call removed).
- `supabase/functions/stock-predict/` — delete the whole function directory.
- `src/pages/Settings.tsx` — remove the "Use news sentiment" toggle from the autotrader settings UI.
- Migration: drop `autotrade_settings.use_news_sentiment` column.

---

## 2. 🔴 Kill switch — per-user + global, "halt entries + freeze exits"

Per your call: when flipped, no new buys AND no automated sells. User must manually close.

### Per-user kill switch
- **New column** on `autotrade_settings`: `kill_switch boolean default false`.
- **In `autotrader-scan`**: at the top of each user's loop, if `kill_switch = true`:
  - Skip both `runEntryDecision` *and* `runExitDecision`.
  - Write a `kill_switch_active` row to `autotrade_log` so it shows up in AutotraderLog.
  - Update `next_scan_at` so the dashboard countdown stays honest.
- **UI**: big red "EMERGENCY STOP" toggle in `Settings.tsx`, separate from the regular `enabled` flag. When ON, surface a persistent banner on Dashboard: *"Kill switch active — autotrader frozen. Manage positions manually."*

### Global kill switch (admin / data-anomaly fallback)
- **New table** `system_flags (key text pk, value jsonb, updated_at timestamptz)`.
- **Seeded row**: `('global_kill_switch', '{"active": false, "reason": null}')`.
- **In `autotrader-scan`**: first thing it does (before loading users) is read this row. If `active = true`, abort the whole scan with a logged reason.
- **Auto-trip**: the circuit breaker (#3) flips this to `true` on its own when thresholds are breached. Manual reset only.
- **UI**: read-only banner on Dashboard when global flag is on; admin reset is a SQL update for now (no admin UI — you're the only admin).

### Why "halt + freeze exits" and not force-close
You picked freeze, which is the right call: force-closing at "last known price" during a suspected data outage is *exactly* how you eat a worse fill than you would have got. Freeze + manual takeover is what real desks do.

**Files touched**:
- Migration: add `autotrade_settings.kill_switch`, create `system_flags` table with RLS (anyone authed can SELECT, no client INSERT/UPDATE — service role only).
- `supabase/functions/autotrader-scan/index.ts` — global flag check + per-user check.
- `src/pages/Settings.tsx` — emergency stop toggle UI.
- `src/pages/Dashboard.tsx` — banner when either flag is active.

---

## 3. 🛡️ Data-quality circuit breaker

You said "whatever I think best" — here's what I'm building. Four signals, any one trips it. Conservative thresholds because false-positives are way cheaper than bad fills:

| Trigger | Threshold | Why |
|---|---|---|
| **Yahoo returns null/zero/NaN price** | >20% of tickers in a single scan | Catches API outages and Yahoo serving stale/garbage. |
| **Quote timestamp stale** | >30 min old during NYSE regular hours | Yahoo sometimes serves you yesterday's close at 11am ET. |
| **Implausible price gap** | Any ticker moved >25% vs its last-scan close with no halt flag | Catches data glitches, splits not yet adjusted, ticker symbol collisions. The position is skipped *and* counted toward the breaker tally. |
| **Scan-wide fetch failure rate** | >50% of tickers errored out | Network / Yahoo rate limit / DNS issue. |

### How it works
- Each scan tracks counters in a `scanHealth` object.
- After the OHLCV batch fetch (before entries/exits run), evaluate all four conditions.
- If any trip, **set `system_flags.global_kill_switch = true`** with a `reason` like `"circuit_breaker: 38% of tickers returned null prices at 2026-04-25T15:32"`, abort the scan, and write a `circuit_breaker_tripped` row to `autotrade_log` for every opted-in user (so it shows up in their log, not just yours).
- Reset is manual — you read the log, eyeball Yahoo, then `UPDATE system_flags SET value = '{"active":false,"reason":null}' WHERE key = 'global_kill_switch'`. Belt-and-suspenders by design.

### Why these four
- **Null-price + stale-timestamp** = the real Yahoo failure modes I've seen in your logs.
- **25% gap** is loose enough to allow earnings-day moves but tight enough to catch obvious glitches (real single-day >25% on a non-earnings day is exceptionally rare on liquid names).
- **50% scan failure** is the "Yahoo just rate-limited us" canary.

**Files touched**:
- `supabase/functions/autotrader-scan/index.ts` — `scanHealth` tracker, evaluation block after batch fetch, trip logic.
- New helper `supabase/functions/_shared/circuit-breaker.ts` — pure functions for each check, easy to unit-test later.

---

## 📋 Migration summary

```sql
-- 1. Per-user kill switch
ALTER TABLE public.autotrade_settings
  ADD COLUMN kill_switch boolean NOT NULL DEFAULT false;

-- 2. Drop the now-unused sentiment toggle
ALTER TABLE public.autotrade_settings
  DROP COLUMN use_news_sentiment;

-- 3. Global system flags
CREATE TABLE public.system_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.system_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authed users can read flags"
  ON public.system_flags FOR SELECT TO authenticated USING (true);
-- No INSERT/UPDATE/DELETE policies → service role only (autotrader-scan + manual SQL)

INSERT INTO public.system_flags (key, value)
VALUES ('global_kill_switch', '{"active": false, "reason": null}'::jsonb);
```

---

## 📁 File-by-file change list

| File | Action | What |
|---|---|---|
| `supabase/functions/stock-predict/` | **Delete** | Orphaned, AI-heavy, not called anywhere |
| `supabase/functions/news-sentiment/index.ts` | **Rewrite** | Replace AI call with keyword scorer; preserve response shape |
| `supabase/functions/autotrader-scan/index.ts` | **Edit** | Strip sentiment; add global+per-user kill checks; add circuit breaker tracker |
| `supabase/functions/_shared/circuit-breaker.ts` | **New** | Pure functions for the 4 health checks |
| `src/pages/Settings.tsx` | **Edit** | Remove "Use news sentiment" toggle; add red "Emergency Stop" toggle |
| `src/pages/Dashboard.tsx` | **Edit** | Banner when global or per-user kill switch is on |
| `src/integrations/supabase/types.ts` | Auto-regen | Reflects schema changes |
| Migration | **New** | The SQL above |

---

## 🚦 Ship order

1. **Migration first** (kill switch column + system_flags table) — non-breaking, deploys instantly.
2. **`autotrader-scan` edits** in one shot (strip AI + add kill checks + circuit breaker) — biggest blast radius, want it atomic.
3. **`news-sentiment` rewrite** — keeps `NewsPanel` alive but pure-rule.
4. **Delete `stock-predict`** — last because it's the most "are you sure?" step.
5. **`Settings.tsx` + `Dashboard.tsx`** UI for the kill switch.

After this lands, you'll be able to honestly say: *"100% deterministic signals, user can panic-stop at any time, system panic-stops itself if Yahoo lies."* That's the trust posture you actually need.

---

## What this does NOT solve (explicit)
- **Forward-tested track record** — still your time, not code.
- **Broker integration** — separate sprint.
- **Intraday exits** — separate sprint, needs real-time feed first.

Good with this? Approve and I'll ship in the order above.