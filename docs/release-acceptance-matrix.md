# YoungMoney3 — Staging Acceptance & Release Gates

**Status:** acceptance protocol, not a certification or a completed field-test report.
**Scope:** Adaptive Desk, Personal Patterns, Decision Replay 2.0, Improvement Laboratory, read-only Windows MT5 connector, security, privacy, accessibility, and operational recovery.

## Definition of done

A successful GitHub Actions run proves that the **code and fixtures** pass the automated checks. It does *not* prove that live Windows broker accounts, genuine MT5 IPC, unsupported broker variants, or actual user outcomes work.

A production decision is **blocked** until all critical manual items below have an evidence link, named tester, date, exact connector version, environment and reproducible result. Obtain owner approval separately before any production deploy or user-account migration.

## Gate 1 — Automated (CI; required for staging)

- TypeScript, lint, application unit tests, D1 worker integration and account-boundary checks pass.
- Browser workflows pass for Quick Find, Decision Replay, Improvement Laboratory, Adaptive Desk, Personal Patterns and shared dialogs.
- All 12 palettes in light/dark at mobile and desktop sizes pass the layout matrix.
- Keyboard focus stays within dialogs; Escape restores the invoking control; reduced-motion preferences disable decorative entrance motion.
- Windows CI executes the connector unit suites including concurrent capture, terminal installation, pairing, device presence, offline retry, revocation and identity conflict.
- Staging Worker targets only the staging D1 database and hostname; migrations and API/navigation health checks pass.
- Evidence: GitHub Validate and Deploy staging from validated main workflow job URLs and artifacts.

## Gate 2 — Real Windows MT5 acceptance (NOT verified by CI)

Use **two consented demo accounts only** first, on a Windows 11 installation; include the same broker server when supported. Never share credentials, passwords, tokens, investor access keys, or decrypted logs in tickets. Do not run or place trades through the connector: **MT5 executes trades outside YoungMoney3; the connector only observes**.

| Case | Procedure | Required observable result |
| --- | --- | --- |
| Discovery | Launch connector after normal MT5 installation | Installed MetaTrader terminal is detected without manual Program Files browsing |
| Initial pairing | Link demo account 1 and confirm device | User-visible success, stable device ID, correct broker/login, heartbeat continues |
| Second account | Add demo account 2 on same PC (ideally same broker server) | Distinct portable instance/process, independent monitoring and position IDs |
| Session ownership | Pause account 1, leave account 2 active | Only account 1 stops capture; no cross-account event association |
| Offline recovery | Disable internet for 2 minutes and restore | Queued evidence survives; UI shows reconnection; original pairing is retained |
| Worker restart | Restart connector during historical import | Durable checkpoint and deduplication prevent missed/duplicated broker events |
| Login failure | Enter incorrect demo password and retry | Actionable error, no credential leakage, other linked accounts unaffected |
| Device revocation | Revoke pairing in staging administration | Device stops authorized synchronization and requires explicit reauthorization |
| History selection | Import default 30 days, then extend to 90 | Exact account-specific range, broker totals reconcile, no repeated positions |
| Partial closes | Execute controlled demo partial closure(s) | One position lifecycle with immutable fills and accurate realized amounts |
| Original SL | Record SL at opening, adjust it later | Original risk remains frozen with observation provenance; changes stay separately traceable |
| Timezone and DST | Confirm account timezone and check session stamps | User-selected zone persists; event times and session labels are appropriately converted |
| Windows reboot | Reboot and resume connector after login | Original named sessions, account identity, durable outbox and monitoring state recover |

Record for every case: tested date/time with timezone, Windows build, connector version/build hash, broker/server (no login number), steps, actual result, expected result, pass/fail, redacted screenshot/log and issue link.

**Release-blocking failures:** any order placement or trading-control capability on the site; credentials in logs/process arguments; wrong-account trades; duplicate or lost immutable broker fills; misattributed financial results; irreversible cursor corruption; inability to revoke a device; or unexplained silent disconnection without recovery guidance.

## Gate 3 — Authenticated, privacy and performance acceptance

- Use two separate test users and prove there is no cross-user access to trade evidence, study hypotheses, original verdicts, attachments, account settings or backups.
- Verify permissions, session expiry, account recovery, password changes, data export, deletion workflow and redaction of private content in errors.
- Verify invalid study references are rejected; activated studies cannot be backdated or modified; server activation timestamps cannot be forged; original replay verdicts are immutable.
- Verify stale/replayed connector sync requests cannot change the wrong account; broker-only evidence fields stay immutable.
- Exercise 100, 1,000 and 10,000-record histories on staging using synthetic fixtures; record p50/p95 interactive page-load and calculation duration, errors, memory and API costs. Establish thresholds from real users and hardware rather than fabricating them.
- Inspect dashboard keyboard paths with screen reader and 200% zoom. Check all themes for text contrast, high-contrast focus, responsive overflow, empty/error/loading feedback and reduced-motion behavior.
- Check backup restoration and rollback in disposable staging accounts. Do not modify production data.

## Gate 4 — User value & behavior validation

With consent, observe a varied sample of new and experienced traders performing the core journey without coaching:

1. Connect one demo account.
2. Record a decision and its original plan.
3. Use blind Replay to make a judgement before revealing the outcome.
4. Create and activate an improvement hypothesis.
5. Return after additional actual decisions and interpret the evidence/limitations.

Measure task completion, assistance required, time-to-first-verified-sync, review completion, data confidence, explanation comprehension, serious UX errors, consent to return, and follow-up voluntary use. Do **not** use trade frequency, profit or increased risk-taking as a success metric. Retention and outcome changes must be observed, not asserted.

## Evidence labels

- **Automated verified:** passed CI/Playwright/SQLite/Windows test doubles.
- **Field verified:** witnessed on a real Windows MT5 setup with redacted logs.
- **User validated:** observed user tests with informed consent and documented measures.
- **Not verified:** missing proof, whether or not the feature exists.

All current real Windows and user-outcome gates remain **Not verified** unless subsequent evidence is attached.

## Release decision

Production requires: zero release-blocking failures, completed field acceptance, passed privacy/account-boundary audit, documented performance results, rollback runbook, current backup/recovery test, and explicit owner authorization. A green staging deployment by itself is **not** production approval.
