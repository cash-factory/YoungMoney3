# Windows MT5 connector

Use a Windows PC with 64-bit Python 3.13 and desktop MetaTrader 5. Create one separate, writable portable terminal installation per simultaneously monitored account. Open each dedicated terminal once and add the exact broker server there. Leave your normal trading terminal separate.

1. Extract this ZIP into a folder and open PowerShell there.
2. Run each PowerShell command on its own line.

   ```powershell
   py -3.13 -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

3. Sign into the journal, open **MT5 Connections → Pair a PC**, and copy the five-minute code.
4. Run this command with your dashboard origin and your dedicated terminal path. Supply additional quoted paths for additional accounts.

   ```powershell
   .\.venv\Scripts\python.exe connect.py "https://your-dashboard.example" "C:\Trading\Demo1\terminal64.exe" --pair
   ```

5. Enter the code at the prompt. From your phone or PC choose **Connect MT5 account** on the website and enter the exact server, account number, and investor password.
6. Leave the connector running. Restart it with the same command without `--pair`. Re-pairing creates a new device identity. Revoke the old device in MT5 Connections if you retire it.

Credentials use the current Windows user's Credential Manager. The private key and device token never belong in source control or logs. The local SQLite journal under LOCALAPPDATA/YMFX contains private trade history and pending uploads. Protect this Windows user profile. The connector supports investor or standard MT5 credentials, performs read operations only, and uses outbound HTTPS. A standard password can still authorize trading inside the external MT5 terminal. YoungMoney3 itself has no order controls. A broker that requires an unsupported second authentication step must be verified in a demo environment before use.

Capture starts at linking. Positions already open and fills from that point forward appear in the journal. MT5 supplies broker history for fill reconciliation. Changes to SL/TP between samples or during an offline interval may be unavailable. Live imports are disabled by default. The installation owner should enable MT5_ALLOW_LIVE=true only after demo reconciliation, including reconnection and two-account isolation checks.

## Optional earlier trade history

After the connector reports **Connected**, select a lookback range under **MT5 Connections**, then **Find earlier trades**. Scanning occurs locally in resumable seven-day windows; long histories may take multiple sync cycles. Keep the connector running, and use **Cancel scan** to end an unwanted request. Review every page of fills before approving import. A broker deal ticket can only be imported once per linked account; review manual duplicates separately.

Broker balance and equity are snapshots from the last successful sync. If the terminal is offline, values become stale. The connector estimates a clock offset only from advancing quotes; confirm timestamps, fees, partial closes and currency conversions against your broker's demo statement before trusting imported historical figures. For a one-off reconciliation, use the same command with `--sync-once` (without `--pair`).


## Rich capture staging source (Windows x64)

The staging prerelease adds connector_gui.py and lifecycle.py alongside the existing CLI.
The **versioned, unsigned YoungMoney3 Connector.exe** will be linked from the
staging dashboard after the manual Windows prerelease workflow succeeds; this
ZIP is the Python source fallback, **not the executable**.

For a Windows 64-bit Python 3.13 fallback:
- py -3.13 -m venv .venv
- .\.venv\Scripts\python.exe -m pip install -r requirements.txt
- .\.venv\Scripts\python.exe connector_gui.py

## Session manager v0.3.0-rc1 (staging)

One desktop app manages multiple broker account sessions. A MetaTrader terminal
can have one logged-in account at a time, so create a **separate writable
/portable terminal64.exe directory for each concurrently observed account**.
Two accounts using the same MT5 broker/server still need two terminal folders.
The connector uses ONE coordinated Python/SQLite worker to avoid competing MT5
initializations; enabled account slots are polled sequentially.

1. Open **Pair this PC**. Generate a five-minute code on your staging dashboard.
   Paste with the Paste button, right-click context menu or Ctrl+V, then click
   Pair this PC. Follow the visible progress and wait for **PC paired successfully**.
2. Open **Sessions → Add session**. Choose the first terminal64.exe and give it a
   nickname. Use a separate terminal directory for every additional account.
3. Select a session and choose **Arm for account**. In the browser open
   **MT5 Connections → Connect MT5 account** and enter the exact broker server,
   login and investor/standard password. Only the explicitly armed free session
   can claim that account; otherwise pending verification is not consumed.
4. Add another terminal session and repeat. Rename, pause and resume sessions
   individually without affecting the other linked accounts. **Start all** and
   **Pause all** manage the whole local app. Remove only unlinked GUI profiles;
   broker links, local SQLite evidence and Windows credentials are not deleted.
5. Open **Activity** for timestamped progress and safe-to-share diagnostic
   summaries. The UI does not print or store pairing codes, device tokens or
   broker passwords. Settings migrate automatically from the older
   `terminals` preference list.

The native GUI and CLI still share the same staging origin, Credential Manager
pairing, and per-device SQLite outbox. Closing the app stops capture safely and
retains queued records. No trading commands are issued.

Broker server discovery remains in MetaTrader 5 → File → Open an Account.
If MT5 IPC -10005 occurs, launch the exact dedicated terminal with /portable,
log in to the correct broker server, then retry. Verify full operation using
actual Windows demo terminals before trusting financial reconciliation.

Historical data defaults to 30 days (approximately one month). The available
7/14/30/60/90-day choices require explicit preview approval; the staging server
rejects requests beyond 90 days.
Timezone labels require the account owner to verify an IANA broker timezone
and separately attest the historical UTC conversion against broker evidence;
otherwise historical sessions remain unresolved.

The first standalone binary is unsigned: Windows may warn before opening it.
Always verify the release SHA256 and use only the staging website/release.
Staging is invite-only and real-account capture is disabled.
