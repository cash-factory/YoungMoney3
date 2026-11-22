# YoungMoney3 Connector — Session Manager v1 implementation specification

**Scope:** Windows x64 staging connector, capture-only; no production merge or live-account enablement.  
**Existing foundation:** connector/connect.py handles device claims, Windows Credential Manager secrets, immutable MT5 evidence, lifecycle projection, local SQLite outbox, broker verification and HTTPS replay. The new UI must **reuse**, not replace, that foundation.

## Product decisions

- **One desktop application, many account sessions.** An MT5 terminal instance has one logged-in account at a time. Do not claim concurrent multi-account capture from a single terminal instance. One configured **portable terminal64.exe directory per concurrently monitored account**, including two accounts on the same broker/server, is supported.
- **Concurrent MT5 capture:** one native MT5 IPC connection in each **separate Windows process**, assigned to one broker link and portable directory. A lightweight coordinator handles website verification and starts/stops workers as local sessions are enabled. Existing immutable link-scoped SQLite records share a WAL-backed database, with per-link transactions and idempotent broker event replay. The legacy CLI single-worker mode remains available.
- **Explicit account assignment.** A user selects and arms a free session before completing **Connect MT5 account** on the staging website. A pending website verification can use only that armed, unassigned terminal. Never silently attach an account to another session.
- **No trading commands.** Reading broker balances, orders, fills, stops, positions, specs and timezones is allowed. Do not add MT5 order placement or remote trade control. Real-account capture remains disabled.
- **Persistent local profiles, no secrets in settings.** Save session ID, nickname, terminal path and enabled choice atomically to the current user's LOCALAPPDATA/YMFX/staging-gui/preferences.json. Device token and account passwords stay in Windows Credential Manager; trade evidence/outbox remains in existing per-device SQLite. Migrate the legacy terminals array without losing accounts.
- **Terminal creation and duplication.** Users can create or duplicate a named /portable terminal from existing MT5 installation **program files**, without copying account databases, credentials, EAs, scripts, charts or history; never delete the source folder. Copy asynchronously to a managed directory, use a temporary folder and atomic final move. New account association is explicit and cannot inherit the source login.
- **Staging-only distribution.** Publish a distinct 0.3.0-rc2 tag and checksum, with clean Windows GUI and two-process startup smoke. Do not overwrite earlier prereleases.

## Screens and states

1. **Overview** — navigation sidebar, staging badge, device pairing state, active/paused session counters, last verified cycle and queue size. Primary actions Pair this PC, Add session, Start all and Pause all.
2. **Sessions** — list of named sessions with selected-terminal path, linked broker/login/server (only after broker verification), status (Not configured / Waiting for account / Ready / Syncing / Paused / Connection issue), last capture cycle and pending uploads. Create a new isolated terminal, duplicate an existing terminal's program files, add via file picker, rename, remove unlinked profile, arm for account, start, pause, start all, pause all, launch in /portable and open terminal folder. No duplicate terminal path; removing a profile must not delete broker evidence, local outbox, device keys or linked accounts.
3. **Pairing** — step-by-step instructions, code field, Paste from clipboard, right-click Cut/Copy/Paste/Select all, clear/show controls, validation of a 32-character hex code, explicit busy/success/error results and accessible keyboard navigation. Code should never appear in logs or diagnostics. Pairing must work before any terminal is selected.
4. **Activity** — timestamped, bounded, redactable event feed with pairing claim, service connectivity, account assignment, per-session capture, queue sync, retries and actionable errors. Copy diagnostics excluding tokens, passwords and pairing codes.
5. **Help** — quick checklist for isolated /portable terminal setup, exact broker server search in MT5, Windows IPC -10005 troubleshooting, dashboard and prerelease links.

## Backend behavior

- `connect.main(argv, ..., active_slots=..., armed_slot=...)` supports optional **thread-safe callbacks** from the GUI; CLI behavior without callbacks stays unchanged.
- Poll for new website account verification **only while an unassigned session is armed**. Never consume a queued job without an eligible configured slot; confirm session from returned broker metadata before marking linked.
- Each linked and enabled account receives an independent spawned Windows worker process. Pausing a session signals only that worker to stop after its current MT5 call; other accounts continue recording in parallel. Existing local linked accounts remain stored. Resume replays queued broker observations idempotently. An unresponsive process may be terminated after a bounded grace period; SQLite replays from durable cursors.
- Send typed events to the Tk UI via queue. Tk widgets are owned only by the Tk main thread; no blocking MT5/HTTP calls in Tk callbacks.
- Pairing is separate from capture, reports accepted/rejected, and final success remains visible instead of being overwritten with “Stopped.”
- Never fake progress percentages for operations with unknown duration. Use indeterminate progress animation plus explicit current stage and time elapsed. Report network timeouts/errors.
- When connector exits, preserve outbox, keys and session profiles. Do not drop queued history on stop, crash or restart.
- Staging server remains invite-only, timezone confirmation per broker account, 30-day default and maximum 90-day approved historical imports, equity-first risk calculations and exact identity only for automatic legacy merge.

## Acceptance matrix

| Test | Requirement |
| --- | --- |
| Pairing | Invalid/pastable code, context menu, success, failed/expired code and no secret logging |
| Migration | Old `terminals` array becomes named profiles; path uniqueness and stable identifiers; no deletion of existing SQLite or keys |
| Multi-session | Two distinct portable directories, different brokers or same broker/server; one GUI; capture overlaps in two separate worker PIDs; stop one while other syncs |
| Assignment | No pending website job accepted without explicitly armed free session; account linked to intended slot |
| Recovery | Restart after graceful/forced exit keeps names, pause choices, broker link IDs, credential store and outbox |
| Safety | No trading API, real-account release gate intact; owner isolation enforced by Worker; only staging origin |
| UI | All screens usable at min window size; keyboard-only pairing; high-contrast focus and error messages; logs bounded |
| Windows binary | PyInstaller Tcl/Tk/NumPy bundled; frozen GUI terminal creation smoke and two-process spawn smoke on separate clean Windows VM; checksum and manifest match source |
| End-to-end | Two actual demo terminals and broker statements tested on user's PC; external acceptance, **not** implied by CI |

## Shipping gates

1. Python session-registry, clean terminal factory, isolated process coordinator and existing connector tests green.
2. Build/CI, archive integrity, and frozen startup test green.
3. Publish distinct unsigned Windows staging prerelease and SHA-256.
4. Owner manually tests two demo accounts on Windows (including previously observed IPC -10005), statement reconciliation and reconnect behavior.
5. **Do not merge to main, deploy to production, or enable live accounts without explicit approval and broker reconciliation sign-off.**
