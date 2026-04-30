# US Stock AI

US Stock AI is a React + Supabase application for scanning U.S. equities, generating signals, running backtests, and managing portfolio/watchlist workflows.

## What this project does

- Scans market data and produces actionable trade signals.
- Runs strategy backtests with configurable risk and execution assumptions.
- Tracks portfolio constraints (sector concentration, beta, correlated exposure).
- Supports watchlists, alerts, sentiment, and dashboard analytics.

## Tech stack

### Frontend
- Vite
- React + TypeScript
- Tailwind CSS
- shadcn/ui
- React Query

### Backend
- Supabase (Postgres, Auth, Edge Functions)
- Supabase Edge Functions for scanning, backtesting, alerts, and calibration jobs

## Project structure

```text
src/                         # Frontend app (pages, components, hooks, libs)
supabase/functions/          # Edge Functions (scanner, backtest, alerts, etc.)
supabase/migrations/         # Database schema and migration history
```

## Prerequisites

- Node.js 18+
- npm 9+
- A Supabase project (URL + API keys)

## Environment variables

Create a `.env` file in the repository root:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_or_publishable_key
```

> Note: Some backend functions also require server-side Supabase secrets configured in Supabase (for example service role key) via function environment settings.

## Getting started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Build for production:
   ```bash
   npm run build
   ```
4. Preview production build locally:
   ```bash
   npm run preview
   ```

## Code quality

Run lint checks:

```bash
npm run lint
```

## Core workflows (high level)

- **Signal generation:** `supabase/functions/market-scanner`
- **Backtesting:** `supabase/functions/backtest`
- **Adaptive calibration:** `supabase/functions/calibrate-weights`
- **Portfolio risk gate:** `supabase/functions/portfolio-gate`

## Deployment notes

- Frontend can be deployed on any static host that supports Vite builds.
- Edge Functions and database schema are deployed through Supabase.
- Ensure production environment variables and Supabase function secrets are configured before enabling scheduled jobs.

## Security and operations

- Do not commit real API keys or service role secrets.
- Protect expensive endpoints with authentication and rate limits.
- Monitor scheduled jobs and function heartbeats.

## Contributing

1. Create a feature branch.
2. Make focused changes.
3. Run lint/tests.
4. Open a PR with a clear summary and validation steps.

---

If you want, I can also add:
- an architecture diagram section,
- local Supabase CLI setup instructions,
- and a troubleshooting section for common setup/runtime issues.
