# Security hardening pass

Close the three real gaps (2FA, in-app audit log, vulnerability disclosure) and flip on one free Supabase Auth toggle (HIBP leaked-password check) that costs nothing to enable.

## 1. 2FA (TOTP) enrollment in Settings

Supabase Auth already supports TOTP MFA server-side — just need the UI.

- New component `src/components/security/TwoFactorSection.tsx` mounted inside `src/pages/Settings.tsx` under a new "Security" card (above Account).
- States it handles:
  - **Not enrolled** → "Enable two-factor authentication" button → calls `supabase.auth.mfa.enroll({ factorType: 'totp' })` → renders the returned QR code (SVG from `totp.qr_code`) + manual secret string → user scans with Authenticator/1Password/Authy → enters 6-digit code → `supabase.auth.mfa.challenge` + `verify` → success toast.
  - **Enrolled** → shows "2FA active" + factor created date + "Disable" button (re-prompts for a fresh TOTP code, then `supabase.auth.mfa.unenroll`).
- Sign-in flow: extend `src/pages/Auth.tsx` to check `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` after password login. If `nextLevel === 'aal2'` and `currentLevel === 'aal1'`, show an inline 6-digit code input that calls `challenge` + `verify` before routing to `/dashboard`.
- Add a one-step tour entry to `SettingsTour.tsx` pointing at the new card.

## 2. In-app audit log

A first-party trail of sensitive user actions, visible to the user (and useful for support).

- New table `public.audit_log` via migration:
  - columns: `user_id uuid` (FK auth.users), `action text` (enum-like: `login`, `password_change`, `mfa_enabled`, `mfa_disabled`, `position_opened`, `position_closed_manual`, `autotrader_toggled`, `settings_changed`, `alert_created`, `alert_deleted`, `api_key_rotated`), `target_type text`, `target_id text`, `metadata jsonb`, `ip_address text`, `user_agent text`, `created_at timestamptz`
  - GRANT `SELECT` to authenticated (own rows only), `INSERT/ALL` to service_role. No UPDATE/DELETE policy (immutable).
  - RLS: users read their own; only service_role writes.
- Write path: small helper `src/lib/audit.ts` → `logAudit(action, target?, metadata?)` that inserts via supabase client; also called from edge functions (`autotrader-scan`, `create-checkout` kill-switch, `delete-account`) using service-role.
- Wire emit points: register-buy dialog, close-position action, autotrader settings save, price-alert create/delete, MFA enroll/unenroll, password change.
- New page `src/pages/SecurityActivity.tsx` (linked from the Settings → Security card): paginated table of the last 100 events with action badge, timestamp, IP, and metadata expander. Mobile = stacked cards per the project's card-vs-table pattern.

## 3. Vulnerability disclosure

Lightweight but real — what every responsible-disclosure scanner looks for.

- `public/.well-known/security.txt` (RFC 9116) with contact, expiration, preferred language, and policy URL. Also a flat `public/security.txt` redirect for legacy crawlers.
- New page `src/pages/Security.tsx` at `/security` with:
  - Scope (in-scope: `*.lovable.app` + custom domain; out-of-scope: third-party APIs)
  - Reporting channel (email — needs your address; I'll stub `security@usestockai.lovable.app` and you swap it)
  - Safe-harbor language (no legal action for good-faith testing)
  - Response SLA (acknowledge ≤ 5 days, triage ≤ 14)
  - "Hall of fame" placeholder section
- Footer link added in `src/components/Footer.tsx` → "Security".
- `public/robots.txt` allow + sitemap entry in `public/sitemap.xml`.

## 4. HIBP leaked-password check (free win)

Call `supabase--configure_auth` with `password_hibp_enabled: true` so signups/password changes are checked against Have I Been Pwned. Zero code, zero UX change unless the password is in a breach list.

## Out of scope (explicitly)

- **Penetration test** — requires an external firm; I can't perform one. I'll add a TODO note in the Security page so you remember to commission one before any real launch.
- **Custom WAF rules** — Cloudflare baseline stays; custom rules would need workspace-level access we don't have from in-app.
- **Rotating CRON_SECRET / Stripe keys on a schedule** — manual ops task, not code.

## Technical details

- MFA: uses Supabase JS `auth.mfa.*`. AAL2 enforcement is per-session, not global — users without 2FA keep working normally.
- Audit insert failures are fire-and-forget (try/catch + console.warn) so they never block the user action they describe.
- `security.txt` `Expires` field set to 1 year out; add a calendar reminder to refresh.
- No new dependencies. QR rendering uses the SVG string Supabase returns directly — no `qrcode` package needed.

## Files touched

**New**
- `src/components/security/TwoFactorSection.tsx`
- `src/pages/SecurityActivity.tsx`
- `src/pages/Security.tsx`
- `src/lib/audit.ts`
- `public/.well-known/security.txt`
- `public/security.txt`

**Edited**
- `src/pages/Settings.tsx` (mount Security card)
- `src/pages/Auth.tsx` (AAL2 challenge step)
- `src/App.tsx` (routes for `/security`, `/settings/activity`)
- `src/components/Footer.tsx` (Security link)
- `src/components/SettingsTour.tsx` (one extra step)
- `src/components/dashboard/RegisterBuyDialog.tsx` + close-position handler + autotrade settings save + price-alert mutations (audit emits)
- `supabase/functions/delete-account/index.ts`, `autotrader-scan/index.ts` (service-role audit emits)
- `public/sitemap.xml`, `public/robots.txt`

**Migration**
- Create `audit_log` table + GRANTs + RLS.

**Auth config**
- `password_hibp_enabled: true`.
