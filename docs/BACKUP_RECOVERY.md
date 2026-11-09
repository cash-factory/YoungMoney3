# Encrypted personal backups and provider recovery

**Personal export**: The Backup & Restore modal defaults to passphrase-protected AES-256-GCM JSON archives, using PBKDF2-SHA256 with 310,000 iterations and fresh salt/IV for each file. Only the local browser derives the key; the passphrase is not sent to the Worker, stored in D1, or included in the archive. Losing the passphrase means losing access to that copy. Legacy plaintext exports can still be restored; exporting plaintext is an explicit insecure option.

**Managed recovery**: Personal archives do not replace automatic provider-level database and media backups, off-site encrypted retention, tested point-in-time recovery, and designated on-call alerts. The existing user archive intentionally limits restore to the same account and deployment hostname to prevent accidental cross-environment import. An isolated D1 recovery drill must therefore use a provider-level copy or a controlled staging-specific dataset.

Acceptance checklist:
1. Export an encrypted disposable account with trades and private attachments. Inspect the JSON and confirm no readable data.
2. Enter a wrong passphrase and verify no backup records appear. Enter the correct passphrase and verify the restored preview, counts and ownership.
3. Restore to an isolated test workspace with matching owner/host or use a D1 snapshot for a separate environment; compare trade, cash adjustment and media object counts.
4. Configure separate Cloudflare D1 and private media recovery jobs. Record the recovery point, restoration elapsed time, accountable person, encrypted off-site retention and failure alerts.
5. Broker passwords, connector pairing keys and Windows keyring records must never appear in personal or provider-level D1 backups.

No automated off-site backup or provider restoration has been executed by the source-control changes alone.
