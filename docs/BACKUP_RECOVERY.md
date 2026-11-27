# Encrypted personal backups and provider recovery

## Critical scope distinction (27 November 2026)

The Download action is now explicitly a **workspace-only** archive. It does **not** include the server's immutable MT5 raw evidence, broker-order/deal chain, position revisions, conflict classifications, recovery checkpoints or owner/PC links. Even when its ordinary workspace trade rows contain MT5-derived projections, it is not a complete broker-evidence backup and must never be described as one.

Before restoring any workspace rows or media, the UI now reads the authenticated database to confirm that **every MT5-derived trade projection already exists as an MT5 record**. Missing, duplicated or mismatched records stop the restore *before writing*. Already-present broker-derived projections are left untouched; only non-MT5 workspace records are eligible for the normal idempotent insert. A complete restore requires independent provider-level D1 and media snapshots, and a verified broker record reconciliation.

An offline, read-only D1 evidence verification script is available at `scripts/verify-mt5-evidence-snapshot.py`. See [Critical Integrity Gates](CRITICAL_INTEGRITY_GATES.md) for the baseline/restore fingerprint procedure. This script **does not create backups**, convert Wrangler SQL exports to SQLite, restore Cloudflare data or prove that broker history was captured correctly. Real provider recovery remains an operator-owned release blocker.

**Personal export**: The Backup & Restore modal defaults to passphrase-protected AES-256-GCM JSON archives, using PBKDF2-SHA256 with 310,000 iterations and fresh salt/IV for each file. Only the local browser derives the key; the passphrase is not sent to the Worker, stored in D1, or included in the archive. Losing the passphrase means losing access to that copy. Legacy plaintext exports can still be restored; exporting plaintext is an explicit insecure option.

**Managed recovery**: Personal archives do not replace automatic provider-level database and media backups, off-site encrypted retention, tested point-in-time recovery, and designated on-call alerts. The existing user archive intentionally limits restore to the same account and deployment hostname to prevent accidental cross-environment import. An isolated D1 recovery drill must therefore use a provider-level copy or a controlled staging-specific dataset.

Acceptance checklist:
1. Export an encrypted disposable account with trades and private attachments. Inspect the JSON and confirm no readable data.
2. Enter a wrong passphrase and verify no backup records appear. Enter the correct passphrase and verify the restored preview, counts and ownership.
3. Restore to an isolated test workspace with matching owner/host or use a D1 snapshot for a separate environment; compare trade, cash adjustment and media object counts.
4. Configure separate Cloudflare D1 and private media recovery jobs. Record the recovery point, restoration elapsed time, accountable person, encrypted off-site retention and failure alerts.
5. Broker passwords, connector pairing keys and Windows keyring records must never appear in personal or provider-level D1 backups.

No automated off-site backup or provider restoration has been executed by the source-control changes alone.
