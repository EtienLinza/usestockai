---
name: Earnings-Exit & MTM Drawdown Breaker
description: Sprint 1 follow-ups — close open positions before earnings, and feed the rolling drawdown breaker with mark-to-market equity (cumulative realized + unrealized) instead of just closed P&L
type: feature
---

Two more Sprint-1 audit gaps fixed in `autotrader-scan/index.ts`.

**G-3 — Earnings exit for OPEN positions**: Both `processUser` (active autotrader) and `runExitOnlyPass` (disabled autotrader, manual buys still tracked) now call `getEarningsBlackoutDays(ticker)` before running loss/win exits. If ≤2 trading days away, a `FULL_EXIT` is forced at the current price with reason `"Earnings blackout: report in ~N trading day(s) — closing to avoid gap risk"`. Priority order is now **earnings → loss → win**. Non-fatal on API hiccup. Previously only ENTRIES were blocked — held positions still ate the gap.

**G-2 — MTM-equity drawdown breaker**: `virtual_portfolio_log.total_value` is now written as `currentNav = max(starting_nav * 0.1, starting_nav + cumulativeRealizedPnl + unrealizedToday)` in both snapshot paths (disabled-autotrader and full pipeline). The rolling 30-day drawdown computation upstream reads these snapshots, so the circuit breaker now reacts to UNrealized losses too — not only realized. `cumulativeRealizedPnl` is computed once per user, before the disabled-path early-return, so even users without active autotrading get an honest equity curve. `navExposurePct` and `todayPnlPct` are also denominated in `currentNav` for consistency.
