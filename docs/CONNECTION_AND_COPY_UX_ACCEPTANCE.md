# YoungMoney3 — Connection, Copy Studio and guidance acceptance

> **Scope:** Medium-priority UX and documentation work. This is an acceptance protocol, not a statement that real Windows, MT5 or user testing has passed. No live orders or deployment are authorized by this document.

## System boundary: where each action belongs

| Goal | YoungMoney3 Dashboard | Signal Desk on Windows | Proof of success |
| --- | --- | --- | --- |
| Pair a computer | Generate code, view paired PC, rename or unpair | Enter short-lived code | Paired device appears; pairing alone proves nothing about MT5 |
| Add a broker login | Scan PC and select an authenticated account | Create isolated terminal, open MT5 and log in | Broker server and login verified; account then linked |
| Monitor an account | Choose per-account monitoring policy and inspect sync | Run capture, pause/resume local session, view last scan | New account-level completed capture, not merely button acknowledgement |
| Recover missing history | Inspect recovery progress, integrity conflicts and unresolved positions | Keep MT5 logged in; request supported recheck | Reconciled broker fills, position lifecycles and preserved risk evidence |
| Configure trade copying | Choose source, followers, allocation, risk and non-executing preview | Read-only copying information and link to Copy Studio | Saved paused fleet; no orders yet |
| Authorize a copier follower | View requirements and server-side readiness | **Not available in Signal Desk 0.4.0**; established connector has separate permissions | Verified account-bound local consent; never infer consent from pairing |
| Arm a fleet | Explicit confirmation; server-side checks; emergency pause | No Arm control in new shell | Active server state, authorized follower and real broker-side execution checks remain distinct |

## Automated checks to run

From the root on Node 22+ with dependencies installed:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

From `connector/desktop`:

```sh
npm ci
npm run test:static
```

The Dashboard unit test `src/lib/mt5Monitor.test.ts` covers active capture, missing PC, paused capture, evidence conflicts, recovery and failed login. The native test `connector/desktop/scripts/test-native-status.mjs` checks status counts and recommended actions. These tests **do not** demonstrate a real broker connection, Tauri interoperability, screen-reader compatibility, or copy execution.

## Product acceptance matrix

| Scenario | Expected trader-facing result | Verification mode |
| --- | --- | --- |
| Paired PC, zero verified accounts | PC paired, no confirmed capture; Scan/Add actions remain distinct | Browser mock then Windows |
| Two terminals, only one captured | Exactly **1 of 2 accounts monitoring**; inactive account not green | Native state test then Windows |
| PC offline but link remains | Waiting for PC plus reopen instruction; saved account preserved | Dashboard scenario |
| Broker login pending, failed, or expired | Explanatory status and next step; no implicit success | Dashboard scenario |
| Monitoring deliberately paused | Explicit Paused state and Resume instruction | Both apps |
| First sync not yet observed | Waiting for first sync, not Monitoring | Dashboard scenario |
| Capture stale, broker-history recheck requested | Stale/recovery status remains until independent completed capture | Dashboard and Windows |
| Conflict evidence pending | Visible integrity warning; immutable records not rewritten | Dashboard and API |
| Fleet with missing local consent | Arm disabled with number of affected followers and remedial action | Copy Studio |
| Fleet with stale source/follower | Arm disabled; real-time server remains authoritative | Copy Studio |
| Fleet otherwise ready | Explicit LIVE/DEMO confirmation; no claim that broker execution is guaranteed | Demo-only functional test |
| New Signal Desk copy screen | Does not arm, approve, or submit orders | Native IPC allowlist test |
| Preview allocation | Reads planning estimate only; no order transmitted | API/GUI request inspection |
| Guide reopened at a specific topic | Real destination and relevant explanation; no accidental pairing/capture | Browser + native guide tests |
| Keyboard and reduced motion | Visible focus, logical traversal, no trapped focus or unwanted animation | Physical Windows / browser manual |
| Mobile 390px and laptop 1366px | No horizontal overflow, legible statuses and buttons | Visual/manual |
| All themes | Contrast and states visible on light and dark palettes | Visual/manual |

### Browser-assisted usability session (not yet completed)

Use at least three participants familiar with trading but unfamiliar with YoungMoney3. Give each the same tasks **without coaching**: (1) identify which of two MT5 accounts is actually monitored, (2) recover from a simulated disconnected session, (3) identify where to rename the Windows PC versus a local MT5 session, (4) explain what Arm does and why it may be disabled, (5) reopen the Field Guide at a chosen destination.

Record completion, wrong clicks, time to accurate state interpretation, confusion about trading authority, keyboard accessibility issues and participant quotes. Capture anonymized results only with consent. **Do not invent pass rates or testimonials.**

### Physical Windows and MT5 tests (not yet completed)

Use isolated demo accounts and clean disposable Windows profiles. Validate terminal discovery, dedicated terminal account identity, disconnect/reconnect, dual-session isolation, 90-second PC freshness, broker capture completion, status updates, pending upload reconciliation and absence of duplicate original fills. Verify Signal Desk's native Help and updater UI at 100% and 150% scaling, small windows and Windows Reduce Motion. Use a screen reader and keyboard to inspect all primary controls.

Live copier tests require separate owner approval, local authorization, broker-specific risk checks and a documented safe test protocol. **Do not send real-money orders as part of this UI acceptance.**

## Release gate

- [ ] TypeScript, lint, unit and static tests pass on the exact commit
- [ ] Dashboard scenario tests and native Guide tests pass
- [ ] Physical Windows/Tauri and actual MT5 capture acceptance is recorded
- [ ] Relevant accessibility, keyboard, reduced-motion and responsive issues are resolved
- [ ] Copying safeguards and failed-consent states are tested independently
- [ ] Repository owner approves merge and deployment separately

A branch or pull request containing these changes is **not** a deployed release.
