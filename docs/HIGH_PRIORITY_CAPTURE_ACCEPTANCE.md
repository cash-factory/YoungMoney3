# YoungMoney3 — High-priority capture, environment and release acceptance

> Workstream opened on 27 November 2026. This is a **verification protocol**, not evidence of completed physical MT5 tests, active signed updates, private Classic distribution, or production readiness. No live broker order or destructive release change is authorized.

## 1. Technical controls proposed in this branch

| Area | Mechanism | What it cannot prove |
| --- | --- | --- |
| Signal Desk copying boundary | Native bridge passes `copy_execution_enabled=False` into `connect.main` → concurrent supervisor → per-account workers → `connect.scan`. Only Classic's explicitly authorized path retains the default copier cycle. | Real MT5 interoperability or absence of unrelated installed software |
| Capture freshness | A successful scan is green only within 120 seconds using a monotonic clock, in the current capture-worker lifetime, with a verified link and active terminal. Stale accounts receive a distinct status. | That all broker deals, SL changes or positions were captured |
| Reconnect/closure proof | Confirmed broker closures are monotonic in the local recovery checkpoint; a later failed history query cannot revert them to unresolved. | Broker availability or full recovery of actions absent from broker history |
| Durable update preflight | Signed-update UI requires a fresh bridge snapshot; the bridge reads local SQLite outbox and copier permissions/tasks *read only*. Unreadable stores and older approved copier sessions fail closed. | Valid code signing or successful Windows installer rollback |
| Environment isolation | The staging Tauri build uses a single pinned origin in capture, discovery and pairing, with a staging-specific local profile. A runtime request for production or an unknown host fails closed. | A separately built, signed and validated production connector |
| Dashboard reporting | Invalid/future account and PC timestamps cannot be interpreted as fresh monitoring. | Correctness of all business and historical risk analytics |
| Classic visibility | Read-only GitHub Release audit identifies public old `YoungMoney3.Connector.exe` files. | Private R2 provisioning, owner access or revocation of already downloaded copies |

## 2. Automated checks (not a substitute for real broker acceptance)

On Node 22 and a supported Windows Python 3.13 build:

```sh
npm ci
npm run typecheck
npm run lint
npm test
node --test scripts/audit-classic-public-releases.test.mjs
npm run build
python -m unittest discover -s connector -p 'test_*.py' -v

cd connector/desktop
npm install --no-audit
npm run test:static
python -m unittest discover -s tests -p 'test_desktop_bridge.py' -v
python -m unittest discover -s tests -p 'test_service_channel.py' -v
python -m unittest discover -s tests -p 'test_update_safety.py' -v
```

Python imports and broker fixtures may need running from the repository root with `connector` on the module search path, as configured in the repository workflows. Tests created in this branch must be verified through CI; **creating a test does not mean it passed**.

## 3. Actual Windows MT5 acceptance matrix

Use *disposable demo accounts*, signed-in isolated MT5 terminals, and a recorded broker history export. Record results for the exact commit SHA and Windows user/profile.

### A. Seven positions disconnected before closure

1. With read-only monitoring active, open seven independent positions, including at least two on the same symbol. Record broker deal/order tickets, position IDs, entry time, initial order SL and first observed protective SL where applicable.
2. Confirm the connector stored seven distinct first-observed specification evidence keys and frozen initial-risk provenance, with no redundant symbol-specification conflicts.
3. Disconnect the connector **without stopping the brokers**. Close/partially close a known subset of positions while disconnected. Make a stop modification on another position if permitted.
4. Reconnect with the same Windows user and authenticated account. Verify resumed broker history scans, durable outbox and accurate dashboard recovery checkpoints.
5. Compare each open/closed position lifecycle, original risk, entry/exit fills, order identity, fee/swap/profit and session attribution with the broker statement. A position absent from `positions_get` must **never** be treated as closed without broker exit deals.
6. Restart the connector a second time. Confirm no duplicate original evidence, no reversed broker-proven closure, no change to frozen initial-risk values. Mark entirely offline/unobservable stop modifications as **unknown**.
7. Document any genuine immutable conflict separately from pre-existing classified `connector_spec_position_alias_v1` artifacts.

**Pass condition:** All available broker executions reconcile by ticket and volume, original risk is not rewritten, genuine gaps remain marked as unknown, no false closure or duplicate event appears, and the UI never reports verified capture before a new successful scan.

### B. Two independent brokers/accounts

- Install two *different* dedicated MT5 portable terminal profiles and verify two worker process IDs.
- Confirm a separate server/login identity and database link for each. A failure or broker timeout in one must not change the other account's verified identity or capture state.
- Pause one account independently and ensure the other continues. After retry, verify distinct capture timestamps and no cross-account copies or evidence.
- Simulate a still-running supervisor with an account whose last capture is more than 120 seconds old; that account must show **Waiting for fresh scan**, not Monitoring.

### C. Signal Desk is capture-only

- Provision a disposable local database with prior Classic copier approval and a queued/dispatchable synthetic copy task.
- Launch **Signal Desk** and run the read-only capture path. Assert no MT5 `order_send`, no `copy-claim`, and no new `copy-local` execution evidence is produced by Signal Desk.
- Validate the established Classic copier's *separately authorized* demo path still behaves as before, without involving Signal Desk. Do **not** use a real-money test account without separate explicit approval.

### D. Signed update and rollback

- Confirm current staging preview is **unsigned** and does not offer unattended installation until proper Tauri signing material is configured.
- Reject installs when capture is active; any local SQLite journal has queued broker evidence; copied orders are unresolved; any Classic copier approval remains; or the audit returns unknown.
- Verify the final pre-install snapshot directly before shutting down the bridge. If the state changes between checks, no installer must start.
- On a clean Windows profile test signed upgrade, signature mismatch rejection, bad/unavailable channel, interrupted download, incorrect version, app startup failure, locked files and rollback/data preservation. Inspect actual sidecar restart and same-user MT5 capture after updating.

### E. Staging and production isolation

- Verify `service_channel.PACKAGED_CHANNEL='staging'`, Tauri identifier `za.youngmoney3.signaldesk.staging`, staging updater channel, staging GUI directory, and the exact staging worker origin.
- Set `YMFX_CONNECTOR_CHANNEL=production` when launching the staging artifact. It must refuse to start rather than silently pair or sync against production.
- A future production artifact requires a separately reviewed channel constant, *distinct Tauri app identifier and updater*, independent profiles/tokens, isolated D1 and explicit release permission. This branch intentionally does **not** enable production activation.

## 4. Classic Connector release exposure

The GitHub public release inventory on 27 November 2026 contains **21 public** `YoungMoney3.Connector.exe` files. These are still accessible through GitHub releases, regardless of their absence from dashboard menus.

Read-only check:

```sh
node scripts/audit-classic-public-releases.mjs
# Use --strict after authorized remediation; it exits nonzero if public EXEs remain.
node scripts/audit-classic-public-releases.mjs --strict
```

**Approval-required process:** verify one owner recovery copy and checksum; provision the private `CLASSIC_RELEASES` R2 binding and exact `CLASSIC_OWNER_USER_ID`; test owner access and anonymous/nonowner 404; record affected release tags, preserve audit trail; then, *only after explicit owner approval*, delete or restrict public Classic binary assets. Check that no active user needs an old release for capture recovery and that the new Signal Desk package has passed acceptance. Public files already downloaded by third parties cannot be revoked retroactively.

The audit command **never changes releases or Cloudflare resources**.

## 5. Broker conflict classification and evidence uncertainty

Do not erase `mt5_raw_events` or `mt5_evidence_conflicts`. Confirm that:
- New position-scoped specification keys remain unique even when several positions share a symbol.
- Historical `connector_spec_position_alias_v1` classifications are separated from genuine unresolved broker-event conflicts.
- Genuine conflicts remain quarantined for owner review, with both original and candidate SHA/changed-field metadata retained.
- Unknown initial SL/TP, an unobservable offline stop edit, unknown risk basis, unresolved broker closure, stale capture and no recent sync must **not** become zero-risk or verified outcomes.
- Trade summaries and analytics explain what evidence exists versus what was not observed.

## Release gate and decision ownership

- [ ] CI passes on the exact high-priority branch head.
- [ ] Native Windows installer launches and paired MT5 sessions work in practice.
- [ ] Seven-position outage acceptance is reconciled against broker history.
- [ ] Two-account isolation is physically verified.
- [ ] Copier boundary and signed update idle/rollback checks pass on Windows.
- [ ] Historical conflict classifications reviewed and genuine cases triaged.
- [ ] Old Classic assets privately archived and publicly revoked, **after explicit approval**.
- [ ] Production channel separately configured, signed, tested and approved, if requested.
- [ ] Owner approves any merge, staging release or production deployment.

No action in this branch merges, deploys, authorizes live trading or removes GitHub assets.
