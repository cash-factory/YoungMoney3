# Connector automatic updates — deployment and safety contract

YoungMoney3 currently distributes **two different Windows applications**. Their update paths intentionally remain separate:

| Application | Current packaging | Update strategy |
| --- | --- | --- |
| Classic MT5 Connector (Tk / PyInstaller one-file EXE) | Immutable staging GitHub release asset `YoungMoney3.Connector.exe` | Periodic GitHub release checks, mandatory asset SHA-256 verification, download in the background, replace only after a safe shutdown, keep a previous executable for rollback |
| Signal Desk (Tauri v2 / NSIS installer preview) | Separately published staging preview installer | Tauri **signed updater** with an embedded public verification key, pinned update endpoint and signed Windows installer; disabled until signing and update publication are explicitly configured |

**First-install limitation:** Existing installations do not have the updater code. Users must install an approved, updater-enabled connector build **once**. Subsequent compatible builds can then be downloaded and installed from within that application. A website-only change does not require a Windows connector update; publish one only when its executable/MT5 integration actually changes.

## User experience

The classic connector's Home screen has a **Software updates** panel with current status, **Check for updates**, a short public changelog, **Install & restart**, and an **automatic background download** preference (enabled by default). It checks after startup and roughly every four hours while running. Failed checks never stop trade capture. An available verified file is downloaded without asking the user to visit GitHub.

An automatic install is **deferred until the connector closes safely**. It does not close the user's open MT5 terminal or interrupt an active local copying thread. If copying permission is still enabled for a follower, installation is blocked until it is disabled. The app finishes its normal capture-worker shutdown before invoking the update helper. Users can also explicitly choose **Install & restart** when ready.

Signal Desk offers **Check updates** in its top bar and an update panel on Home. Its background check also runs periodically. Automatic installation is eligible only when its broker snapshot establishes all of the following: no active capture, no monitoring sessions, no pending uploads, copying disarmed, no local copying permission, and no active management action. Missing or uncertain status is treated as **not safe**. It waits for the bundled Python bridge to stop before asking Tauri to install. A signed-update key and release channel must be configured before a real update is offered.

Neither interface displays internal commits, account credentials, terminal paths, conflict payloads, trading strategies, implementation details, unpublished releases, or raw diagnostic logs as release notes. Release notes consist of a short headline and at most four user-facing improvements.

## Classic release contract

Source: `connector/update_service.py`, `connector/update_ui.py`, `connector/update_apply.ps1`.

1. Only the project's published `staging-connector-v<version>` prereleases are considered. A newer valid version must be strictly greater than `connector/version.py`; a file from Signal Desk or another channel is never accepted.
2. The downloaded `YoungMoney3.Connector.exe` must match the GitHub API asset's own SHA-256 **digest** and exact expected file size. HTTPS redirects are limited to GitHub's release asset hosts. A checksum file hosted alongside the executable alone is **not sufficient** as an independent trust anchor.
3. The verified EXE is stored in a dedicated update cache under `%LOCALAPPDATA%\YMFX\staging-gui\updates`. It never overwrites `capture.db`, saved terminals, Windows Credential Manager, or broker account settings.
4. The bundled fixed PowerShell helper is extracted from the installed application. After the application and workers exit, it rechecks the digest, moves the original executable to `.previous`, replaces it with the verified candidate and attempts a relaunch. An early startup failure attempts to restore the previous executable and reports a short status on next opening.
5. The current classic connector is **not Authenticode-signed**; SHA-256 digest verification establishes integrity relative to the project's GitHub release metadata, not independent publisher authentication. For broader production distribution, add a trusted code-signing process before enabling unattended installation for all users.
6. Installs may need additional Windows permissions if the current EXE is stored in a protected directory. The updater must fail safely and preserve the previous executable rather than bypass OS permissions. Never run the connector as administrator merely to enable updates.

Each new release must bump `connector/version.py`, the prerelease workflow's `VERSION`, and `connector/update-notes.json` **together**. Every published release must pass code/unit tests, frozen Windows startup smoke and staging validation, and must include `update-notes.json` as a release asset. The workflow does not publish from a PR. Staging publication is distinct from production promotion.

## Signal Desk idle evidence gate

The staging native updater additionally needs `update_safe=true` from the local bridge. When monitoring is stopped, the bridge independently opens every saved connector `capture.db` **read-only** and audits queued journal outbox items, unfinished copier tasks and previously approved Classic copier permissions. An unreadable store, unknown state, active copier consent or pending broker upload must block installation; an old in-memory counter is not sufficient. The interface requests a **fresh** bridge snapshot immediately before stopping the bundled sidecar. This does not replace signed installer validation, real Windows upgrade testing, or local copier supervision.

See [High-priority capture/release acceptance](HIGH_PRIORITY_CAPTURE_ACCEPTANCE.md).

## Signal Desk signing and channel activation

The new preview's signed updater is **intentionally inactive** until an owner configures signing. This protects users against silent installation of unsigned preview builds. Per the [official Tauri v2 updater guide](https://v2.tauri.app/plugin/updater/), create a private/public signing key pair using the Tauri CLI. Protect the private key and its passphrase in GitHub Actions secrets or a suitably restricted signing service. **Never commit or display the private key**.

The signed updater reads a versioned JSON endpoint:

`https://github.com/cash-factory/YoungMoney3/releases/download/staging-signaldesk-channel/latest.json`

This stable *channel pointer* is updated only after a signed immutable per-version installer has passed Windows startup and capture-integrity acceptance. Its JSON must follow the Tauri Windows `windows-x86_64` schema, with `version`, brief `notes`, and `platforms` containing the pinned release asset HTTPS URL and its detached signature. The updater's embedded public key validates the signed artifact, not just the channel JSON or a published hash. Set `YMFX_SIGNALDESK_UPDATE_PUBLIC_KEY` during the build that first enables update checks and sign that and future update installers using the matching private key. Enable `bundle.createUpdaterArtifacts` for those signed release builds.

Do not enable live update publication until the entire build, signing, updater-replacement, Windows NSIS installation, rollback/migration and multiple-MT5-session reconciliation flow has been acceptance-tested. The native preview's existing no-copy-execution boundaries stay in place.

## Acceptance checklist

- [ ] All updater unit tests and Windows PowerShell integration tests pass, including a deliberately wrong digest that must fail **without replacing the original EXE**.
- [ ] The classic one-file executable launches in a clean Windows profile with the bundled helper; update from a real older version, using a different executable SHA, succeeds without admin rights when installed in a user-owned directory.
- [ ] Capture of multiple real demo MT5 sessions recovers after a simulated update; broker fills, first observed stop/risk evidence, queued uploads and immutable conflicts are unchanged.
- [ ] Installer cannot start while live copying or account-bound copier permission is active; safe stop and no duplicate orders are verified.
- [ ] Failed download, interrupted copy, locked executable, missing privilege and bad new-version startup preserve the previous connector and user data.
- [ ] Updates do not appear for equal/older releases or the wrong product/channel.
- [ ] New Tauri build is signed, public-key verification is active, signed test release channel exists, and clean Windows upgrade works with the Python sidecar properly stopped.
- [ ] All manuals and UI labels accurately distinguish **check**, **downloaded**, **verified**, **installing**, **restarted**, and **broker reconnected**; a successful installer does not falsely claim trade capture succeeded.
- [ ] Update-notes text contains only concise public changes. No confidential development details, raw logs, broker data or account names are exposed.
- [ ] Owner authorizes any production release separately from merging the implementation.

Automated CI tests can verify checksums, safety gating and offline replacement simulations. They cannot alone establish successful upgrades of real installed Windows applications with MetaTrader open. Record those outcomes before enabling unattended updates at scale.
