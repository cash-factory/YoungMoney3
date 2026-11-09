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

Credentials use the current Windows user's Credential Manager. The private key and device token never belong in source control or logs. The local SQLite journal under LOCALAPPDATA/YMFX contains private trade history and pending uploads. Protect this Windows user profile. The connector requires investor access, performs read operations, and uses outbound HTTPS. A broker that requires an unsupported second authentication step must be verified in a demo environment before use.

Capture starts at linking. Positions already open and fills from that point forward appear in the journal. MT5 supplies broker history for fill reconciliation. Changes to SL/TP between samples or during an offline interval may be unavailable. Live imports are disabled by default. The installation owner should enable MT5_ALLOW_LIVE=true only after demo reconciliation, including reconnection and two-account isolation checks.
