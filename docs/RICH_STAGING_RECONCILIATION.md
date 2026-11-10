# YoungMoney3 rich-capture — staging reconciliation and acceptance report

**Prepared:** 2026-11-10  
**Environment:** staging only  
**Worker:** https://ym-fx-staging.ethical-hacker263.workers.dev  
**Staging deployment run:** https://github.com/cash-factory/YoungMoney3/actions/runs/42792360501  
**Deployment source commit:** `dc335e58951acf9a88442390aa4819b7e32a44fa`  
**Staging migration:** `0009_mt5_rich_capture.sql`, applied and schema-verified by workflow  
**Windows prerelease:** [v0.2.0-rc1](https://github.com/cash-factory/YoungMoney3/releases/tag/staging-connector-v0.2.0-rc1), unsigned Windows x64  
**Release source commit:** `dc335e58951acf9a88442390aa4819b7e32a44fa`  
**GitHub-published executable asset:** `YoungMoney3.Connector.exe`, SHA-256 `f8e9a3b18fae113b280e0241284b14bb67d69d57bb8c79a8af51b0020e665efd` (from GitHub release asset digest)  
**Production:** no migration or deployment performed

## 1. Automated evidence — passed

The following statements describe synthetic-fixture or CI results, **not** reconciliation with an actual MT5 statement.

| Area | Automated evidence | Outcome |
| --- | --- | --- |
| D1 schema | Remote staging migration list, 0009 apply and independent schema verification | Passed in staging run |
| Cloudflare Worker + SPA | Staging /api health and browser-navigation HTTP probes | Passed in staging run |
| TypeScript, lint, frontend bundle | Validation workflow | Passed |
| API auth, account isolation, owner-bound MT5 queries | Local Worker/D1 regression suite | Passed against synthetic data |
| Connector packaging | GitHub Windows x64 PyInstaller build and SHA-256 publication | Passed in Windows build workflow |
| MT5 Python mocks | Windows CI test harness, including connector tests | Passed, **mocked terminal** |
| Lifecycle fixture | Decimal risk and cost allocation, multiple entries, partial closes, reversal boundaries | Passed |
| Initial stop | Executed opening order SL preferred; first-observed stop frozen; beyond break-even risk unavailable | Passed |
| Movements | Forex pip conventions and non-FX tick unit fixtures | Passed |
| Session provenance | IANA zones, DST-aware session clocks, unresolved historical conversion without confirmation | Passed synthetic tests |
| Staging account access | Read-only capture endpoints are owner-scoped, and live mode is flagged off | Passed code/tests; **member-browser QA pending** |

CI jobs: [source validation](https://github.com/cash-factory/YoungMoney3/actions/runs/42791958872), [Windows prerelease](https://github.com/cash-factory/YoungMoney3/actions/runs/42792354580), [staging deployment](https://github.com/cash-factory/YoungMoney3/actions/runs/42792360501). Subsequent source commits for Journal/Calendar/Weekly Reviews/download fixes have their own CI; any staging update requires a separate branch deployment and recorded SHA.

## 2. External broker reconciliation — **not yet verified**

**Accounts available but not accessed:** Two demo accounts, to be chosen from Exness, Deriv, FundedNext and Weltrade. No broker login numbers, credentials, pairing codes, or statements have been supplied to this report.

| Test | Required verification | Status |
| --- | --- | --- |
| Actual Windows MetaTrader Python connection | Isolated portable terminal handshake; prior `-10005` timeout resolved | **Blocked / not retested** |
| Multiple accounts | Two independent demo terminals with isolated pairings and server identities | **Not verified** |
| Entry/fill history | Trade ticket, order, position ID, prices, timestamps, volumes and reasons vs statements | **Not verified** |
| Costs | Commission, fee, swap and net realized P&L reconciled to account currency | **Not verified** |
| Original SL/TP | Executed opening order vs first-observed fallback, moved stop and offline gap provenance | **Not verified** |
| Partial closes and scale-ins | Broker statement deal counts, one lifecycle per position, allocated risk, weighted holding time | **Not verified** |
| Reversals | Split reused MT5 position ID into independent lifecycles | **Not verified** |
| Movement | EURUSD, JPY pairs, metals or indices use correct per-symbol units and tick values | **Not verified** |
| Sessions | Confirmed broker timezone and historical UTC conversion across real DST boundary | **Not verified** |
| Replay and restart | Offline recovery, duplicate upload protection, overlapping import and resume | **Not verified** |
| Windows standalone GUI | Launch without Python installed, pairing upgrade from CLI, Start/Pause/Stop, close/reopen preserves queue | **Not verified** |
| New staging member/admin | Real browser signup/login, owner isolation, full theme navigation, trade expansion and deletion protections | **Not verified** |
| Encrypted backup and restore | Raw evidence, append-only projections, source links and private media recovered and audited | **Incomplete implementation / unverified** |

## 3. Known release limitations

- **Historical imports:** 30 days (approximately one month) is the default, with selectable 7/14/30/60/90-day lookbacks and a server-enforced 90-day maximum. Older scans requested before this restriction may already have retained evidence, but preview/import of over-90-day requests is blocked (HTTP 409); the owner must cancel an active scan and create an approved new one. No automatic deletion or migration is performed. The legacy fill preview/approval boundary remains; it does not yet prove consolidated historical lifecycle reconciliation.
- **Legacy imports:** Existing fill rows remain intact. No destructive consolidation or approximate automatic match occurs. An explicit audited exact-identity reconciliation path still requires completion.
- **Financial definitions:** Connector lifecycle projections use Python `Decimal`. The complete shared decimal calculation contract across manual trades, exports and server summaries is **not yet universal**; the existing manual-trade calculation path remains distinct.
- **Backup coverage:** Existing encrypted workspace backups do not include the new immutable MT5 evidence/version tables in a verified restore process; do not treat those backups as a complete broker-evidence disaster-recovery solution.
- **Calendar/weekly display:** New broker lifecycle counts are presented separately with UTC close/week labels, not silently merged into older local-time journal totals. Broker-local historical conversion requires explicit verification.
- **Browser/GUI testing:** Build and HTTP smoke checks do not equal an actual screen-size/theme walkthrough or a clean-profile Windows GUI test.
- **Live accounts:** Disabled on staging; do not enable until separately authorized and reconciled.
- **Connector `-10005`:** Local terminal IPC issue remains an external blocker for broker acceptance.

## 4. Next acceptance protocol

1. Use only the **staging** Worker, staging invite-only accounts and two **demo** broker terminals. Confirm the current staging source commit, and never share credentials in tickets.
2. On the Windows PC, reproduce or clear the `-10005` IPC timeout with terminal/data-folder/build evidence. Run the unsigned connector on a clean Windows x64 profile and verify its published SHA-256 before launch.
3. Export broker trade statements for both selected demo accounts. Perform opening order, stop edit after entry, partial close, scale-in, reversal, offline gap and full close; compare deal IDs, costs, risk, R, pips/ticks and UTC timestamps.
4. Record account currency, broker timezone and DST evidence. Correct or flag any discrepancies without silently rewriting original evidence.
5. Complete multi-user browser acceptance and encrypted evidence/archive recovery drill.
6. Re-run staged branch migration smoke and compare with production resources. **Do not merge or deploy to production without explicit approval and reconciliation sign-off.**

The report intentionally has **no claimed broker-specific passes** because no real statements or clean Windows test have been examined.
