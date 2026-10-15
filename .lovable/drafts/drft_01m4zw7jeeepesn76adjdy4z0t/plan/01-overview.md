# Portfolio mode: run it like a fund, not a stock picker

Two parts, built together: a new **Portfolio** page that shows the whole book and tells you what to do next, and engine changes so the bot holds a wider, diversified set of smaller positions instead of a few big bets.

## 1. New "Portfolio" page

One screen, top to bottom:

- **Headline numbers** — account value, cash vs invested, return vs SPY, true win rate counted by whole trade, current drawdown from peak.
- **Risk at a glance** — total money at risk if every stop hits, expected bad-week loss, portfolio beta vs SPY, how many truly independent bets you hold (diversification score).
- **Sector balance** — bar chart of each sector's share of the account against the 30% limit.
- **Holdings table** — every position with weight, P&L, distance to stop, sector, and how much risk it adds to the book. Cards on phones.
- **Overlap map** — which holdings move together, so hidden doubling-up is visible.
- **Recommended actions** — a ranked list with a plain-language reason for each: trim an overweight stock, close one sitting near its stop, fill an empty sector, put idle cash to work, rotate a stale position. Recommendations only — the bot still does the trading.

Added to the top menu and the mobile bottom bar.

## 2. Engine: wider, safer net

- **More positions, smaller each** — target 20–25 holdings in Aggressive mode, each starting around 3–5% of the account instead of 8–12%. Still adaptive, still inside the hard walls.
- **Diversity bonus** — when choosing between buys, prefer ones in sectors you're light in and that don't move with what you already hold. Crowded picks get smaller, not blocked.
- **Sizing by risk, not by dollars** — jumpy stocks get smaller positions so each holding adds a similar amount of risk.
- **Cash put to work** — when the book is under-invested and good picks exist, fill toward the target count.

All hard safety walls stay: per-trade stop, kill switch, daily loss limit, 30% sector limit, 20% single-stock wall, no borrowing, drawdown brake.

## Honest expectation

This lowers risk per dollar and smooths results. It cannot promise beating Renaissance; it makes the edge you have count across many more bets.
