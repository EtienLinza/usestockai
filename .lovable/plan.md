# StockAI Payment Tiers — Brainstorm

A freemium ladder designed to serve **all three audiences in one funnel**: hobby traders try it for free → active traders convert to Pro → power users / semi-pros pay for Elite. No separate "Institutional" SKU at launch — keep it simple, add an Enterprise upsell later.

## The Ladder

```text
  FREE              PRO               ELITE
  $0                $19 / mo          $49 / mo
  Acquisition       Core conversion   Power users / autotrader
  ──────────        ───────────       ───────────
  Discover the      Track + act on    Automate + scale
  signals           signals           the workflow
```

Suggested annual discount: **−20%** (Pro $15/mo billed yearly, Elite $39/mo billed yearly).

---

## Tier 1 — Free (Acquisition)

The "see the value" tier. Enough to prove the AI works; not enough to run a real workflow on.

- Browse the **live signal feed** (read-only, all 6,000+ tickers scanned)
- View signal reasoning, confidence, regime, strategy
- **Watchlist**: up to **5 tickers**
- **Backtest**: up to **3 runs / month**, single ticker, max 1-year window, no Monte Carlo, no walk-forward
- **Portfolio tracking**: up to **3 open virtual positions**, no equity curve / analytics
- **No alerts**, no email digests, no autotrader
- Branded "Powered by StockAI" on shared reports

## Tier 2 — Pro — $29/mo (Core conversion)

The "I trade on this" tier. Where ~80% of paying users should land.

Everything in Free, plus:

- **Unlimited watchlist** + AI watchlist suggestions
- **Portfolio & P&L tracking**: unlimited positions, equity curve, win rate, profit factor, drawdown, trade journal
- **Alerts**: price alerts, sell alerts, real-time notification center, **email alerts**
- **Weekly digest email**
- **Backtest**: 20 runs / month, multi-ticker (up to 3), Monte Carlo, walk-forward, full institutional metrics (Sharpe / Sortino / Calmar)
- Custom exit targets per position
- Trading-style filters (scalping / day / swing / position)
- Remove branding on shared reports

## Tier 3 — Elite — $59/mo (Power users)

The "automate my edge" tier.

Everything in Pro, plus:

- **AutoTrader**: paper-mode automated execution against live signals
- **Portfolio risk caps**: sector limits, beta caps, correlation gating, kill-switch
- **Unlimited backtests**, longer history windows, robustness/stress testing, parameter sensitivity
- **Adaptive weighting visibility**: see calibration curves, regime tilts, strategy weights
- Priority scan queue (their manual rescans run first)
- Early access to new indicators / models
- Email + in-app **support priority**

## Future — Institutional (waitlist)

Don't build at launch. Capture interest with a "Contact Sales" CTA. Likely needs:

- API access to signals
- Team seats / SSO
- White-label reports
- Custom universe + custom indicators

---

## Gating Map (technical view)


| Capability                       | Free   | Pro | Elite |
| -------------------------------- | ------ | --- | ----- |
| Signal feed read                 | ✅      | ✅   | ✅     |
| Watchlist size                   | 5      | ∞   | ∞     |
| Virtual positions                | 3 open | ∞   | ∞     |
| Portfolio analytics page         | ❌      | ✅   | ✅     |
| Price alerts                     | ❌      | ✅   | ✅     |
| Sell alerts + email              | ❌      | ✅   | ✅     |
| Weekly digest                    | ❌      | ✅   | ✅     |
| Backtests / mo                   | 3      | 20  | ∞     |
| Backtest tickers per run         | 1      | 3   | 10    |
| Monte Carlo / walk-forward       | ❌      | ✅   | ✅     |
| Robustness / stress tests        | ❌      | ❌   | ✅     |
| AutoTrader (paper)               | ❌      | ❌   | ✅     |
| Portfolio risk caps              | ❌      | ❌   | ✅     |
| Calibration / weights visibility | ❌      | ❌   | ✅     |


## Why this shape

- **Signal feed stays free** → strongest acquisition hook + SEO ("live AI signals"). The scan engine is already running regardless of who's logged in, so marginal cost is ~zero.
- **Portfolio tracking on Pro** → it's the daily habit-forming surface. Once a user logs 5+ trades, churn drops sharply.
- **Backtester split across tiers** → the meter (runs/month) does most of the upsell work without removing the feature outright. Heavy users self-select into Elite.
- **AutoTrader exclusive to Elite** → highest perceived value, lowest support volume (advanced users only), and gives a clear reason to pay 2.5× Pro.
- **$29 / $59** lands in the sweet spot vs comps (TrendSpider $48+, Trade Ideas $84+, Finviz Elite $39, TradingView Pro $15). Pro looks like a bargain; Elite looks like a deal vs Trade Ideas.

## Open questions for you

1. **Real-money autotrader (broker integration) later?** That would justify a 4th "Elite+" tier at $99+, or a usage fee.
2. **Free trial on Pro?** 7-day no-card trial would lift conversion but adds support load.
3. **Student / annual discount aggressiveness** — 20% standard, or push 30%+ to anchor on annual?

## Technical implementation (when you're ready to build)

- Add `subscription_tier` enum (`free | pro | elite`) on `profiles`, plus `current_period_end` for grace handling.
- Use Lovable's built-in payments (Paddle recommended for digital-only SaaS, handles tax + MOR globally).
- Gate server-side in edge functions (backtest, autotrader-scan, send-alert-email) and client-side for UI affordances.
- Add a `usage_counters` table for monthly meters (backtests run, etc.) with month-bucket key.

No code changes yet — just align on tiers + prices first.