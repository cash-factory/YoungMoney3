# Staging rollout and multi-account acceptance

**Source-control automation does not deploy the Worker or alter D1 records.** The production Worker is `ym-fx` with database `trade-journal-pro`. Create a distinct Cloudflare D1 named `youngmoney3-staging` and a separate staging Worker; never reuse the production database UUID or Worker name.

## 1. Prepare a separate staging environment

1. In the intended Cloudflare account, create the `youngmoney3-staging` D1 database and record its UUID. Do not paste API tokens, investor/master passwords, or D1 backups into GitHub issues or chat.
2. In your operator shell, set `YM3_STAGING_D1_ID` and `YM3_STAGING_D1_NAME=youngmoney3-staging`; optionally set `YM3_STAGING_WORKER_NAME=ym-fx-staging`. Run `npm run cf:staging:prepare`. The generated `wrangler.staging.jsonc` is ignored by Git.
3. Confirm the generated config references **only** staging resources. Configure an independent `PILOT_INVITE_CODE` with `npx wrangler secret put PILOT_INVITE_CODE --config wrangler.staging.jsonc`. Configure staging-only media storage if media testing is required. Verify its bucket/project is private and cannot touch production files.
4. Apply migrations in staging: `npm run cf:staging:migrate`. Confirm `0006_mt5_history.sql`, `0007_mt5_access_level.sql` and `0008_admin_operations.sql` are all applied before deploying this Worker. Run `npm run cf:staging:deploy`.
5. Open the staging Worker URL, check `GET /api/health`, sign in with disposable staging users, and confirm the dashboard's account data is isolated from production.

Staging is guarded against accidentally selecting the production D1 ID or database name. The MT5 live-account feature flag is **off** in staging by default. Run a database backup and review rollback compatibility before any future production migration/deploy. Cloudflare D1 migrations are recorded in `d1_migrations`; use Wrangler's migration list to verify exact state. No production migration is run by these scripts.

## 2. Exit criteria

- Two staging users: try cross-user trade/plan/account identifiers, media paths and MT5 link IDs; each must be rejected.
- Login/sign-up, sign-out and admin-managed recovery work; consumed codes cannot be reused. Check the new admin-only dashboard and registration pause/resume. Profile updates and account cancellation cannot affect another user.
- Landing → login → optional setup → dashboard → journal/trades → settings → MT5 pages work on desktop and mobile with every curated theme.
- Trade create/edit/delete, account-specific risk, mixed currencies, dashboard totals and backup/restore work with synthetic entries.
- Two different demo MT5 accounts on separately isolated portable Windows terminals: compare individual fills and P&L/fees against broker statements, including restart, partial close, historical scan/cancel/retry, duplicate replay and access revocation.
- Capture-only behavior with an investor credential and a standard broker credential is independently verified. The standard credential may authorize trades in **the external MT5 terminal**; YoungMoney3 must not expose or call trading endpoints.
- Record staging URL, commit SHA, tester, date, broker/server, account types/currencies and reconciled ticket counts. No secrets in the acceptance record.

## 3. Production release gate

Production remains untouched until staging and broker reconciliation pass, browser E2E tests pass, automatic off-site encrypted backups have been restored successfully, and an operator explicitly approves a production rollout. Apply the D1 migration before deploying Worker/assets. Live-account capture is a separate explicit opt-in; do **not** enable `MT5_ALLOW_LIVE` globally as a shortcut without passing the real/demo broker test matrix.
