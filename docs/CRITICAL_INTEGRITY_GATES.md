# Critical integrity gate — YoungMoney3

**Status:** code and synthetic tests are proposed in PR #49; broker-side acceptance, complete provider backup and production readiness are **not yet proven**. Do not promote by counting unit tests as operational verification.

## Critical findings from the current-state audit

| Priority | Evidence | Code-side treatment | Remaining acceptance |
| --- | --- | --- | --- |
| P0: broker reconciliation unverified | Concurrent MT5 capture uses independent processes, but no reconciled multi-broker statement run proves every fill, partial, fee, swap and stop transition | Existing immutable evidence, bounded cursor catch-up, recovery tests and high-priority account/position stress fixtures | Real Windows capture vs two independent demo brokers, at least 20+ positions, during interruption and across repeated restarts |
| P0: archive does not restore immutable MT5 evidence | Workspace JSON contains ordinary records/media but **not** the complete D1 broker evidence, lifecycle versions or integrity/audit chain | Workspace archives now identify their scope; restore preflights all MT5-derived records **before writes**; server-owned MT5 projections are never replaced from JSON. New offline D1 fingerprint/comparison tool | Provider-level encrypted D1 plus media snapshot, isolated restore, row-count/content-hash equality and end-to-end journal access |
| P0: multi-account fault recovery not physically proven | Simulated Windows process tests do not establish behavior across live broker IPC failures, account changes or long outages | Multiple capture workers, bounded discovery/recovery batches, no three-account or seven-position maximum, distinct stale states | Interleaved outages across two brokers and 4/8/16+ simultaneously connected accounts on a capable Windows host, measured reconciliation and queue drain |
| Critical: risk falsely labeled safe | Recorded 3% risk can be displayed as “Within Limits” against 1% configured maximum | Per-trade risk breaches now produce **danger**; missing initial-risk or realized-P&L data produces **unknown**, not zero; risk warnings appear in both Risk Guardian and Risk Management | Verify actual account settings, MT5 provenance, manual-trade calculations and presentation in a real browser with mixed evidence and timezone boundaries |

## Non-negotiable evidence rules

- Preserve opening-order protective stop where documented; otherwise preserve the **first observed** stop, and keep all later observed modifications separate. Never pretend an unobserved offline SL edit is known.
- Each broker position is a distinct lifecycle. Preserve immutable ticket, deal, order, fill, fee, swap, time, broker/account identity and initial-risk provenance.
- **Unknown is not zero:** missing stop, tick size/value, currency conversion, initial capital, or broker record must not produce a zero-risk claim or a clean compliance badge.
- Every recovered fill is reconciled to a broker record with explicit identity, not inferred from a missing open position.
- Conflicts remain quarantined with original and candidate evidence. Classifying old connector-generated specification aliases is not permission to rewrite authentic broker history.
- Classic Connector **source and support tooling stay in the repository**. Its public downloadable binaries and owner distribution are separate policy matters.

## Code and local-only tests

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:worker
python -m unittest discover -s connector -p 'test_*.py' -v
python -m unittest discover -s scripts -p 'test_verify_mt5_evidence_snapshot.py' -v
```

These tests do not require personal broker login credentials. Record each exact commit and CI outcome. Browser QA should also check that a 3% observed trade against a 1% limit is visible as a rule breach, and that absent MT5 risk provenance displays an uncertainty warning.

## Verified D1 disaster-recovery procedure (operator-led)

1. Use an authorized Cloudflare operator to produce a **separate, encrypted** D1 snapshot and all linked private media with a timestamp and migration ledger. Protect secrets and access keys; do not publish database files or broker identities.
2. Restore to an **isolated, access-controlled test environment**, never over the production D1. Do not write to existing source evidence.
3. Obtain trusted source and restored SQLite snapshots representing the **same logical data checkpoint**. The snapshot verifier reads SQLite offline; it cannot directly execute a Wrangler SQL export or perform the restore.
4. Generate a baseline fingerprint from the isolated source snapshot, then compare the restored snapshot:

```sh
python scripts/verify-mt5-evidence-snapshot.py path/to/trusted-source.sqlite --manifest private-evidence-manifest.json
python scripts/verify-mt5-evidence-snapshot.py path/to/restored.sqlite --compare private-evidence-manifest.json
```

The verifier requires the presence of the actual MT5 event, position-version, conflict, recovery, cash, user and audit tables; checks SQLite integrity and foreign keys; and compares deterministic per-table counts and SHA-256 fingerprints. Fingerprints contain no row payloads or account IDs but can still reveal table sizes and should be protected. A matching checksum **does not** prove that attachments, browser logins, Windows keyring or upstream broker history were restored.
5. Confirm all restored media objects by count and content hash; open a representative restored user account in a browser and inspect trade lifecycles, raw event evidence, risk provenance, conflict classifications and attachments.
6. Deliberately damage a disposable copy and verify that the fingerprint detects altered evidence. Run a failed-restore scenario and check rollback and operator notification.
7. Only after an exact source-vs-restore match, independent account isolation, and two-broker history reconciliation may this P0 finding be considered resolved.

**Personal JSON workspace archives cannot substitute for this procedure.** They may contain representations of MT5-derived trades, but the restore preflight requires those server-owned broker projections to already exist; it leaves them untouched. If any are absent, no media or workspace writes should occur.

## Real broker acceptance — reconciliation and resilience

Perform this on **demo accounts only** unless real-money execution is separately approved. Use at least two different broker servers and isolated MT5 terminals; test progressively with **2, 4, 8 and more** accounts as hardware permits. For recovery, exercise **7, 20, 40 and 100+ positions**, not a fixed upper bound.

- Capture pre-disconnection ticket/deal/order counts, frozen initial SL/risk, current position volumes, fees, swaps and open/closed states.
- Unplug the network or stop one terminal for a known interval. Change and close some positions at the broker while capture is offline. Keep other accounts live.
- Recover with the same Windows identity and independently verify each position lifecycle, pending order, partial close, risk basis and copied-state provenance against the broker statement.
- Simulate MT5 IPC attach `-10005`, account server changes, a locked terminal, supervisor crash, simultaneous account retries, repeated sync receipts and stale heartbeats.
- After reboot/restart, re-run broker statement reconciliation. Require no cross-account attribution, no duplicate immutable events, no invented close, and no silently skipped outbox rows. Unknown offline stop changes remain explicitly unknown.
- Preserve offline/terminal failure logs with private information redacted; report exact latency, success rates and machine resource use.

**Release gate:** block unsupervised live copying and any claim of fully recovered broker evidence until the two-broker statement comparison and operator-validated D1 disaster-recovery drill pass. Simulation, a green build or a visually polished dashboard is not equivalent to that evidence.

## Pending acceptance

- [ ] All CI jobs green on the exact branch SHA, including browser and Windows packaging checks.
- [ ] Real Windows MT5 broker reconciliation for 20+ positions across multiple accounts.
- [ ] Disconnection, process crash, IPC timeout and retry reliability measured.
- [ ] Trusted encrypted provider-level D1 backup captured, restored and fingerprint-compared.
- [ ] Private media, MT5 trade provenance and lifecycle audit round-trip verified.
- [ ] Risk-limit and unknown-evidence states observed in a real browser with fixture and broker data.
- [ ] Owner authorizes merge, deployment and any sensitive changes separately.

No provider backup, real broker tests, release deletion, live trading, merge or deployment is performed by this PR.
