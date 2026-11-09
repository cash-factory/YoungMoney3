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


## Manual GitHub Actions staging release (prepared, not yet executed)

The repository includes [`Deploy staging (manual only)`](../.github/workflows/staging-release.yml), a workflow that **cannot run on push**, requires an exact confirmation input and runs only when manually selected on `main`. It uses the GitHub **staging** environment; configure that environment's required reviewers so deployments require explicit owner approval.

1. In Cloudflare, create a **new D1 database** (recommended name `youngmoney3-staging`) and obtain its UUID. Use a scoped API token permitted to deploy the intended staging Worker and migrate only the intended D1 database, never a broad account API key.
2. In GitHub repository **Settings → Environments**, create `staging`, add a required reviewer, and add environment variables `YM3_STAGING_D1_ID`, `YM3_STAGING_D1_NAME` and optionally `YM3_STAGING_WORKER_NAME`. Add staging environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Do not paste the API token into chat or Git.
3. Before staging deployment, configure the staging Worker secret `PILOT_INVITE_CODE` (distinct from production) through Wrangler or Cloudflare Dashboard. For private media QA, use **a different private Supabase project/bucket** and associated Worker secrets, never production media credentials.
4. In **Actions → Deploy staging (manual only) → Run workflow**, select **main**, enter `DEPLOY-STAGING-ONLY`, and approve the staging environment gate. The job installs dependencies, runs application/Worker regression checks, creates and re-verifies the staging config, applies migrations to **staging D1 only**, verifies migration `0006`–`0008` tables/columns, and deploys **staging only**.
5. Record the staging URL from deployment output. Test `/api/health`, two disposable users, account isolation, optional onboarding, admin recovery (including invalidation), encrypted backup round-trip, theme/browser behavior and two demo MT5 connections. Do not use a full-access live trading account for first-time acceptance.
6. Capture evidence before production promotion: URLs and SHA, versioned migration ledger, financial reconciliation, recovery drill and explicit owner approval.

**No connected Cloudflare account was accessible from this coding session.** This workflow is a deploy path, not evidence of an actual staging rollout. Do not claim staging or production validation until the workflow has run with independently configured provider credentials and acceptance checks.

## API routing and staging administrator bootstrap

Cloudflare static-asset SPA navigation may serve `index.html` to a browser opening `/api/health`, even when application `fetch()` requests use the backend. The Worker and staging generator now explicitly select `assets.run_worker_first: ["/api/*"]`. The staging release job checks the deployed `/api/health` with both JSON and browser-like navigation headers; expected JSON: `{"status":"ok","database":"connected"}`. A `?utm_source=...` parameter does not affect the API path.

**Fresh staging D1 does not contain production users.** Registering in staging with the same email creates a distinct identity. All new signups are `member` by default. Neither the first signup nor matching a production owner's email automatically grants admin access.

To bootstrap the **first staging administrator only**, an authorized Cloudflare D1 operator should:

1. Open Cloudflare → D1 → `young-money-staging` (verify the staging database's UUID independently, and ensure this is **not** `trade-journal-pro`) → Console. This is a manual, privileged database operation, not an endpoint exposed to normal users.
2. Confirm exactly one intended registered user and zero existing administrators with:
   ```sql
   SELECT email, role, account_status FROM users;
   SELECT COUNT(*) AS existing_admins FROM users WHERE role = 'admin';
   ```
3. If and **only if** no admin exists, replace the example email below with the precise email of the intended staging owner, then run:
   ```sql
   UPDATE users
   SET role = 'admin', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE email = 'owner@example.com'
     AND role = 'member'
     AND account_status = 'active'
     AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
   ```
4. Re-run `SELECT email, role FROM users;` and verify the intended staging identity is the **only** admin. Record the approval and operator/date. To record an auditable bootstrap, run this **only after verifying the role changed on the correct user**:
   ```sql
   INSERT INTO admin_audit_log
      (id, actor_user_id, target_user_id, action, outcome, metadata, created_at)
   SELECT lower(hex(randomblob(16))), NULL, id,
      'staging-first-admin-bootstrap', 'success', '{}',
      strftime('%Y-%m-%dT%H:%M:%fZ','now')
   FROM users
   WHERE email = 'owner@example.com' AND role = 'admin'
     AND NOT EXISTS (
       SELECT 1 FROM admin_audit_log
       WHERE action = 'staging-first-admin-bootstrap'
         AND target_user_id = users.id
     );
   ```
5. Sign out of the staging website and sign in again. **Admin Operations** should appear in the sidebar. If the staging user already has an admin, do not bypass it; use an authorized existing-admin recovery workflow.

Do not place passwords, Cloudflare API tokens or broker credentials in D1 Console SQL, logs, screenshots or chat. These instructions **do not** promote any production user and **are not** an automatic privilege escalation feature.
