# What's left after WS1–WS3

WS1 (ensemble champion live), WS2 (adaptive thresholds) and WS3 (adaptive exit geometry) are done. The remaining item from the original roadmap is WS4, plus two small gaps worth closing in the same pass.

## WS4 — News sentiment into the entry gate

The `news-sentiment` function exists (keyword classifier over Finnhub/NewsAPI headlines, 30-min cache) but nothing in the trading path calls it — confirmed: no reference to it in `autotrader-scan` or `scan-worker`.

Wire it as a **supporting conviction delta only** — it never blocks a trade and never fires on missing data:

- Batch-fetch sentiment for candidate tickers before the entry loop (same pattern already used for Danelfin and EPS revisions), reusing the existing cache so cost stays flat.
- Apply `delta = sign(direction) * score/100 * confidence * K`, clamped to ±5 conviction points. Missing/low-confidence news → 0.
- Store `news_sentiment_score` and `news_confidence` in the entry feature snapshot so the nightly ensemble trainer can learn whether the factor actually pays — if it doesn't, the model naturally down-weights it.

## Gap 1 — Time stop for stale positions

Earlier the book was clogged by positions held for weeks with no thesis left, which starved new entries. Add an adaptive time stop: if a position has been open longer than the profile's expected hold horizon (scalping/day/swing/position scaled) **and** is not in profit beyond +0.5R, close it and log the exit reason as `time_stop`. Horizon becomes another parameter the nightly `tune-exit-params` job can learn, with the same clamp + holdout discipline as the other exit params.

## Gap 2 — Feedback-loop watchdog

The worst regression so far was silent: exits stopped writing to `signal_outcomes`, so the models trained on zero samples and quietly got dumber. Add a nightly assertion in the calibration job — if closed positions in the last 7 days exceed `signal_outcomes` rows written by more than a small tolerance, record a critical row in `drift_detections` and surface it on the System Health panel.

## Technical notes

- New code: sentiment batch fetch + conviction blend in `autotrader-scan/index.ts` and `scan-worker/index.ts`; time-stop branch in both exit passes; horizon field added to `adaptive_exit_params.params` and to the `tune-exit-params` grid; watchdog query in `calibrate-weights`.
- No new tables, no new cron jobs — everything rides existing nightly infrastructure.
- Backtest parity preserved: sentiment and time stop are read through the same shared resolvers the simulator already imports.

## Order

WS4 first (cheapest, uses a function already written), then the time stop, then the watchdog.
