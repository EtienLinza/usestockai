
- Aggressive-mode risk numbers come only from `supabase/functions/_shared/adaptive-risk.ts` (defaults, hard walls, nightly step) — never hardcode them in call sites, so live and tuner stay consistent.
- Every partial exit must claim a `position_rule_fires` row (campaign × rule × NY bar date) before selling, and every new position sets `campaign_id = id` — this keeps trims idempotent and win rates counted per whole trade.
- In-app notifications are written only by database triggers via `public.notify_user` — never insert into `notifications` from app code, so every event source stays in one place.
- Portfolio-level analytics (correlation, beta, effective bets, recommendations) are computed only in the `portfolio-analytics` edge function — the Portfolio page just renders them, so the math lives next to the engine's own data.
- The signal engine has four strategies (trend, mean_reversion, breakout, catalyst); scan pre-screen only drops extreme tape (>15% gap / >20% range) so earnings moves reach the catalyst strategy.
