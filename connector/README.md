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

## Broker name search and exact server

The website's MT5 connection dialog supports case-insensitive broker search with spaces, punctuation and common aliases (for example, `Just Markets` matches `JustMarkets`). This is **not** MetaTrader's live broker discovery service; suggestions are conveniences, not a guarantee that a trading server exists or matches the account. Select the exact **MT5** server assigned in the broker's account portal or open **File → Open an Account** in your dedicated MT5 terminal and search for the company. For brokers without preset suggestions, enter the exact server manually. Don't enter a broker brand name in the server field.

The website cannot discover every broker automatically or bypass a broker-side authorization error. Each simultaneously captured account still requires its own dedicated portable MT5 installation. A broker alias does not resolve local Python/MT5 IPC timeouts such as `-10005`.
