# Signal Desk · primary Windows connector

**Decision:** Signal Desk is the default Windows connector for all YM-FX traders. The classic Tk/PyInstaller connector is a legacy, owner-only recovery tool, not a member download.

## What members receive

The dashboard **MT5 Connections** section prominently links to `/connector-download.html`. This verifies published **Signal Desk NSIS preview** assets and their SHA-256 digests against the official GitHub release metadata. A pinned, previously published Signal Desk release remains when GitHub is unreachable. Legacy release tags and Python source archives are not discoverable or linked in the public UI.

Signal Desk includes the actual local MT5 bridge, dedicated account sessions, the same signed-in dashboard account discovery, a four-route interactive **Help & Guides** experience (16 task steps, safe real-screen navigation and searchable FAQs), unobtrusive update checks, a readable changelog, and reduced-motion-aware feedback. Guide actions cannot start monitoring, approve copying or send broker orders.

## Current public legacy exposure

The read-only GitHub release inventory on 27 November 2026 contained **21 public** `YoungMoney3.Connector.exe` assets. No assets have been deleted. Run `node scripts/audit-classic-public-releases.mjs` to check the current count; `--strict` fails while public binaries remain. Complete private owner recovery and obtain explicit approval before deleting any legacy assets. See [High-priority acceptance](HIGH_PRIORITY_CAPTURE_ACCEPTANCE.md).

## Owner-only classic distribution

A public repository cannot make an ordinary GitHub Releases EXE owner-only. Previously published classic releases are **still publicly addressable until removed or moved by the repository owner**. Removing links or disabling future publication does not revoke old downloads. Do not promise complete exclusivity before those assets have been removed.

The updated workspace exposes a private download only through `GET /api/owner/classic/download`. The Worker validates an **exact server-side owner user ID** plus active administrator status and then reads the fixed object `private/classic-connector/YoungMoney3.Connector.exe` from a separately bound, private R2 bucket. Nonowners get 404. No public GitHub link or redirect is returned. The owner-only Admin Operations card is displayed only if the same server-side identity check succeeds. If R2 or the exact owner ID is not configured, the owner archive fails closed and cannot be downloaded; no credentials or owner IDs are built into JavaScript.

**Owner setup required:**
1. Create and bind a private R2 bucket to the staging Worker as `CLASSIC_RELEASES` (not the trading-media bucket).
2. Set `CLASSIC_OWNER_USER_ID` to the real internal owner UUID as a deployment secret or secure environment variable; do not infer ownership merely from the administrator role.
3. Upload a retained, verified classic executable to the fixed R2 key above, without putting it in `public/` or a public GitHub release.
4. Remove or restrict the **previously published public classic release assets** from GitHub after retaining the owner's approved recovery copy. Repository visibility must remain appropriate for the project's code and dependencies.
5. Verify that nonowners and anonymous callers get 404, and the actual owner receives the binary with `Cache-Control: private, no-store`.
6. Remove legacy client compatibility only after active members have migrated and their broker capture/queued evidence has been reconciled.

The old workflow is prevented from automatically publishing any further classic executable. `npm run build` no longer packages `mt5-connector.zip` into the public site. The source ZIP generator remains available for controlled, private support/owner recovery.

## Signed Signal Desk auto-update

The native shell can **check for updates** at startup and periodically, show concise product-facing notes, and offer installation at a verified idle state. For automatic installation, the client must have a live verified local bridge, zero queued uploads, no monitoring session, no running capture, no copying permission, and no pending management action. The Python sidecar is closed and its exit confirmed before the Tauri installer is invoked.

The updater is **fail closed until configured with a trusted signing key**. Do not manufacture a private signing key in source, embed secrets in GitHub, or publish unsigned packages as eligible for unattended installation. `signaldesk-signed-update.yml` is an owner-approved signing workflow, requiring `TAURI_SIGNING_PRIVATE_KEY`, its password, and `YMFX_SIGNALDESK_UPDATE_PUBLIC_KEY`. The signing key must be kept in GitHub Secrets with appropriate access controls; the public key may be embedded in the build. This unsigned staging preview may be manually installed, but it cannot claim active seamless upgrades.

The private signed workflow must produce immutable updater artifacts plus a signed staging channel manifest. Actual Windows NSIS signature verification and owner-approved release publication remain mandatory acceptance steps. See [Tauri's official updater documentation](https://v2.tauri.app/plugin/updater/).

## Acceptance before telling members to migrate

- Test new user install, pairing, MT5 session discovery, broker login and account monitoring on **real Windows MT5**.
- Test repeated disconnect/reconnect, trade closure while offline, reconciliation, conflict preservation, original stop evidence and multiple sessions.
- Test both an existing classic installation and a clean Windows user without silently deleting stored broker credentials or session state.
- Test desktop responsive layouts and reduced-motion settings, keyboard access, guide search, progress and real-screen navigation.
- Test update manifest signature rejection, corrupt download refusal, idle-only install, startup failure/rollback and capture after restart.
- Confirm actual release URLs and SHA-256 against published assets before changing the dashboard's pinned fallback.
- Verify owner-only private R2 and deletion of **previously public** legacy artifacts before claiming private classic availability.

**No MT5 capture or signed auto-update reliability is established merely by a successful compilation or simulated bridge.**