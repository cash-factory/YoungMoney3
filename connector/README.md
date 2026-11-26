# Windows MT5 connector

## Windows app

Download the Windows x64 executable and its matching SHA-256 file from the dashboard’s **MT5 Connections** page or the [official connector releases](https://github.com/cash-factory/YoungMoney3/releases). The separate [Signal Desk preview](https://github.com/cash-factory/YoungMoney3/releases/tag/staging-signaldesk-v0.3.0-preview.1) uses MT5’s own login window.

Open an update under the same Windows user to reuse the pairing, terminal assignments and queued evidence. Keep `capture.db` and the existing Credential Manager entries during recovery. If an upload fails, record the HTTP status and category shown in the connector.

1. Download the Windows connector from **MT5 Connections**. Open it using the same Windows user as your previous version.
2. For a new PC, choose **Pair a PC** in the dashboard and paste its code into the connector. Existing pairings reconnect when you open the app.
3. Choose **Add account** on either screen. Enter the broker server, account number and MT5 password. The connector finds the installed MetaTrader program, prepares an isolated profile and verifies the broker login. If it finds no installation, it offers MetaTrader's Windows installer and checks again automatically.
4. Keep the connector open. **PC online** confirms the connection to the dashboard. **Broker verified** confirms the login. **Journal synced** follows an acknowledged account upload.
5. Use **Broker accounts** on the trading dashboard to see each login, check its last sync, or pause and resume monitoring. **Manage accounts** opens retries, timezones and historical imports.

## Identify a paired Windows PC

Each connector installation has one random, persistent installation identifier in
the current Windows user's LOCALAPPDATA/YMFX folder. It is not a hardware ID,
broker credential or authorization token. The original pairing secret stays in
Windows Credential Manager. Reopening or upgrading the connector uses that
existing pairing; it does not require a new code.

**Overview → Rename this PC** changes the display name on the dashboard.
The connector and **MT5 Connections → Paired PCs** show the same name,
the first eight characters of the server device ID, check-in status and
version. Linked broker accounts identify which PC monitors them.

A repeated pairing claim from this installation is rejected while an active
pairing exists. Never unpair the active PC to tidy up the list: doing so
revokes its broker links (although historical evidence is retained).
Use **Unpair PC** only for an obsolete entry after confirming that its
accounts are no longer monitored there. A lost or corrupted installation
identity is not silently replaced, because that would create more duplicates.

## Manual command-line setup

The optional command-line client uses 64-bit Python 3.13 and desktop MetaTrader 5. Create one separate, writable portable terminal installation per simultaneously monitored account. Open each dedicated terminal once and add the exact broker server there. Leave your normal trading terminal separate.

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
6. Leave the connector running. Restart it with the same command without `--pair`. An already-paired installation refuses another active pairing. If replacing an obsolete pairing, revoke the old PC explicitly in MT5 Connections first.

Credentials use the current Windows user's Credential Manager. The private key and device token never belong in source control or logs. The local SQLite journal under LOCALAPPDATA/YMFX contains private trade history and pending uploads. Protect this Windows user profile. Journal monitoring supports investor or standard MT5 credentials and uploads over outbound HTTPS. A standard password can still authorize trading inside the external MT5 terminal. Copy Studio has a separate execution path with account-specific local consent and fleet arming. A broker that requires an unsupported second authentication step must be verified in a demo environment before use.

Capture starts at linking. Positions already open and fills from that point forward appear in the journal. MT5 supplies broker history for fill reconciliation. Changes to SL/TP between samples or during an offline interval may be unavailable. Real-account capture depends on the workspace release configuration.

## Optional earlier trade history

After the connector reports **Connected**, select a lookback range under **MT5 Connections**, then **Find earlier trades**. Scanning occurs locally in resumable seven-day windows; long histories may take multiple sync cycles. Keep the connector running, and use **Cancel scan** to end an unwanted request. Review every page of fills before approving import. A broker deal ticket can only be imported once per linked account; review manual duplicates separately.

Broker balance and equity are snapshots from the last successful sync. If the terminal is offline, values become stale. The connector estimates a clock offset only from advancing quotes; confirm timestamps, fees, partial closes and currency conversions against your broker's demo statement before trusting imported historical figures. For a one-off reconciliation, use the same command with `--sync-once` (without `--pair`).


## Rich capture staging source (Windows x64)

The staging prerelease adds connector_gui.py and lifecycle.py alongside the existing CLI.
The **versioned, unsigned YoungMoney3.Connector.exe** is linked from the
staging dashboard and the official GitHub prerelease above. The
`/mt5-connector.zip` archive is the source fallback generated from current
checked-in connector code during each website build, **not the executable**.

For a Windows 64-bit Python 3.13 fallback:
- py -3.13 -m venv .venv
- .\.venv\Scripts\python.exe -m pip install -r requirements.txt
- .\.venv\Scripts\python.exe connector_gui.py

## How desktop account setup works

The connector checks Windows program locations, registered installations and MT5 installation markers. It creates a separate portable program for each broker login. If available, the source broker server directory is carried across. Account credentials, EAs, account databases and history are excluded from the copy. Existing linked terminal assignments and queued uploads keep their original identities. Advanced setup remains available for manually managed installations.

One PC check-in runs independently of terminal preparation and capture. Temporary network loss triggers automatic retries. A revoked PC must be paired again. Closing the connector or shutting down Windows pauses monitoring until the connector reopens.

Historical data defaults to 30 days (approximately one month). The available
preset and custom date ranges are described under **Detailed historical imports** below.
Timezone labels require the account owner to verify an IANA broker timezone
and separately attest the historical UTC conversion against broker evidence;
otherwise historical sessions remain unresolved.

The first standalone binary is unsigned: Windows may warn before opening it.
Always verify the release SHA256 and use only the staging website/release.
Staging is invite-only.


### CraftyLabs-inspired connector appearance

The Windows session manager uses the Obsidian Studio palette (red #ff365c, near-black #09090d) and native, text-free vector illustrations in its five page headers. All instructions remain real accessible Tk text. The standalone image source is stored in `connector/assets/connector-scene.svg`; the executable renders matching art using Tk Canvas without requiring SVG libraries or internet access. This is a presentation-only redesign: MT5 read-only capture, pairing, session isolation, broker credentials, local outbox, and reconciliation rules are unchanged.


## Studio interface v0.3.2-rc1

The capture controls now adapt to window width. Quick setup, terminal tools and
session actions wrap into complete readable rows, while Overview, Sessions, Pairing
and Help scroll when vertical space is limited. The session table has a horizontal
scrollbar for long terminal paths. Pairing keeps its code field on its own line.

Buttons have short color transitions and visible keyboard focus. Text-free native
illustrations share the page background and reveal their signal briefly when you
change pages. Turn **Motion** off in the footer to use immediate states and static
busy feedback; the initial preference follows the Windows client-area animation
setting. Pairing and capture still require the same explicit actions, and no
broker operation starts because of navigation, animation or resizing.

## Per-account capture status in v0.3.3-rc1

Each session shows its latest sync acknowledged by staging and the number of positions awaiting review. Select a session and choose Retry to wake that account. A retry requested on the dashboard is picked up by its paired PC when that session is running.

## Broker login and IPC recovery (staging)

The connector first attaches to the specific portable terminal **without**
passing credentials, validates its data folder, then explicitly calls
MetaTrader's login API with the exact assigned server. A new managed terminal
with no IPC listener is launched from its own folder and retried. Only if the
isolated first-run terminal still cannot provide IPC does the connector use
credential-bearing initialize() as a compatibility fallback.

A Windows PC being **paired / online** does not mean the broker has accepted an
account. **Broker verified** means MetaTrader returned the matching account and
live connection; **staging accepted** means the server acknowledged the login;
**journal synced** means an upload was received. A failed HTTPS acknowledgement
preserves the local encrypted-credential reference and broker verification
receipt for retry, without repeating the user's login entry.

Automatic detection of the installed MT5 program is not the same as discovering
every broker's proprietary server. Where a new terminal has no knowledge of a
requested server, the user may still need to use MT5's native **File → Open an
Account** broker search to obtain the assigned server. Account setup uses broker-supplied endpoints and keeps passwords out of the SQLite evidence database. Pending add-account requests expire after
10 minutes; claimed broker verification after 12 minutes. Failed requests can
be resubmitted from Add account.

## Detailed historical imports (staging)

On a connected broker account, use **Find earlier trades** and select a
7/14/30/60/90-day or longer custom duration, a specific UTC start date, all
available MT5 history, or trades entered after the first/latest recorded cash
deposit. The normal default remains 30 days. All-history scans begin from the
Unix/MT5 epoch and advance in bounded resumable windows. The broker may not
retain every early deal, so "all" means all records that its MT5 history API
actually exposes, **not a guarantee of complete life-to-date statements**.

Deposit-based searches inspect the broker's transaction ledger for a *positive
DEAL_TYPE_BALANCE* record (not a credit/bonus, withdrawal, or inferred jump
in equity). The last deposit is the latest such record before linking; the
first deposit is the earliest record discoverable from the MT5 API. A missing
deposit yields an explicit no-deposit state; it never chooses an approximate
start. Verify the suggested deposit ticket, time and amount with your broker
statement before importing. Trades entered before that deposit are excluded
even if their exits occurred afterwards.

Each scan stores raw immutable deals/orders (broker tickets, times, position
IDs, SL/TP when available, reason, commission/fees/swap) separately from
human-readable closed-fill previews. Opening-order SL/TP are never mislabeled
as final SL/TP; unknown values remain unknown. Historical adjustments of
protective orders that the broker does not expose cannot be reconstructed
from fills alone. Reviews and manual duplicate matching are still mandatory
before older closed fills become journal trades. Connected accounts and
live evidence are never deleted by the failed-login cleanup controls.

## Automatic historical balance movements (v0.5.7-rc1)

The connected demo/contest account is checked for past MT5 DEAL_TYPE_BALANCE transactions automatically, independently of the approved closed-trade history importer. Positive entries can be deposits **or** broker corrections; negative entries can be withdrawals **or** corrections. Raw broker deals are preserved, no claim of verified lifetime profit is made, and the staging account ledger labels credit/debit candidates as *unverified*. The connector scans older available records in bounded resumable windows without blocking normal trade capture. Broker retention remains a limitation; compare amounts with an original broker account statement before drawing lifetime P&L conclusions.
