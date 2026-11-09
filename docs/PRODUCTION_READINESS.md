# YoungMoney3 — Production Readiness and Controlled Release

Updated: 2026-11-09. **Status: release gates not yet satisfied.** A passing repository CI job proves code checks on fixtures; it does not prove safe operation with real users or an actual broker.

## Scope of stabilization branch

The stabilization pull request corrects manual trade lifecycle validation, financial recalculation on edits, optimistic deletes, linked-record ownership checks, per-account risk policy consistency, daily Insights windows and currency summaries, and sign-out/profile races. It also splits the previously monolithic data hook library into domain modules without replacing page imports or the visual identity.

## Required checks before merge

- [ ] Full pull request CI green: lint, TypeScript, unit suite, Worker integration suite, Python ledger suite, Windows mocked MT5 terminal suite, production bundle.
- [ ] Review all changed code, including financial calculations and migration impact; no unreviewed direct production deploy.
- [ ] Run `npm run cf:migrate:local` and all checks on synthetic test data. Verify migrations in a **separate staging D1 database** before updating production.
- [ ] In staging, register at least two invited users and verify account isolation (reads, writes, changes to linked IDs, media and deletion).
- [ ] Complete browser smoke tests: landing, authentication, optional onboarding, page navigation, trade create/edit/delete, account filters, risk and Insights, backup/restore, admin console, error recovery, all palettes in light and dark modes.
- [ ] Verify trade finances using broker-specific FX/metal/index/crypto/futures fixtures, fees, currency conversion, long/short, break-even, partial closes and account cash adjustments.
- [ ] Reconcile two separate **demo** MT5 terminals with broker statements: new position, SL/TP changes, partial close, full close, restart, offline gap, replay, revoke and reconnect. Confirm replay is idempotent and totals match to the cent.
- [ ] Run a full private media and journal backup **and restore drill** into an isolated environment. The user-facing JSON export is plaintext, not a managed disaster recovery system.
- [ ] Confirm monitoring, escalation contact, budget/quotas, D1/storage health, restore procedures and rollback steps.
- [ ] Obtain approval from the repository owner before merging/deploying and expanding access.

## External and configuration work still required

- **Recovery:** the current pilot does not implement verified email ownership or password-reset email delivery. Choose and configure a trusted email provider, recovery flow, email verification and abuse protections before general public account creation.
- **Backups:** configure automatic D1 backups or provider-level recovery, off-site retention, encryption, restoration tests and clear recovery objectives. Downloadable client-side backup alone is insufficient.
- **Observability:** configure alerts on Worker 5xx, authentication failures, D1 quota/errors, object-storage errors, MT5 connector heartbeat/gap and reconciliation differences. `GET /api/health` is only a basic database check.
- **Security:** review secrets in deployment settings (never Git history), set least-privilege credentials, enforce change review and ensure private Supabase media bucket configuration and deletion policies.
- **Capacity:** current invite-only signup has a 10-account limit. Confirm operational costs, quotas and multi-user capacity before scaling; removing the limit alone is not a release plan.
- **MT5:** keep `MT5_ALLOW_LIVE` disabled until signed-off demo reconciliation. The connector reads broker history; it does not place orders and cannot reconstruct every intraperiod stop/target modification.
- **Compliance:** any public financial product should receive applicable data-protection, risk-disclosure, terms and provider-availability review for the launch jurisdictions.

## Local verification commands

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:worker
npm run build
python -m unittest discover -s connector -p 'test_ledger.py'
```

Run `python -m unittest discover -s connector -p 'test_terminal.py'` on a **Windows** environment with `connector/requirements.txt` installed. Cloudflare tests use synthetic D1 data; the real broker lifecycle requires Windows MT5 and dedicated demo terminals.

## Pilot acceptance record

Before release, record who performed each test, the date, exact git commit, staging URL, affected account currencies, failed cases, issue links, evidence of backup restoration and MT5 broker reconciliation. Treat unknown or untested items as blockers, not as passed.

## Rollback policy

1. Stop new onboarding and live imports before an unsafe rollout.
2. Roll back the Worker/assets to the last known-good commit **only after** checking whether newer migrations/data shapes remain compatible.
3. Restore data from a verified provider-level backup only after confirming the scope and recovery point; do not blindly overwrite users' recent records.
4. Re-run isolation and financial smoke tests before reopening access.
