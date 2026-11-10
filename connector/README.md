# YoungMoney3 Windows connector

The desktop app captures MT5 executions for the staging dashboard. Open **YoungMoney3 Connector.exe** when you want to sync. Python and command entry are included in the app's packaging.

## Start with the desktop app

1. Download the Windows x64 staging executable from **MT5 Connections** and save it in a folder you can keep.
2. Double-click **YoungMoney3 Connector.exe**. Its dashboard address defaults to `https://ym-fx-staging.ethical-hacker263.workers.dev`.
3. Choose **Add terminal**. The app finds installed copies of MT5, and **Browse** lets you select `terminal64.exe`. Choose **Create dedicated copy** for a new account slot, or select an existing dedicated portable copy.
4. Select the new slot and choose **Open selected MT5**. Complete MT5's startup and use **File → Open an Account** to find your broker and prepare its server directory. Use a separate dedicated terminal for every simultaneously monitored account.
5. Choose **Open dashboard** and sign into staging. Under **MT5 Connections**, choose **Pair a PC**, then paste its five-minute code into the app's **Pair this PC** dialog.
6. The app starts syncing. On the website choose **Connect MT5 account**, select the broker/server, and enter the account credentials. The app verifies the returned broker identity and syncs that account.
7. On later visits, open the app and choose **Start syncing**. Pairing and account connections are retained. **Pause** finishes the current operation and preserves pending uploads. Closing the app stops capture; a broker login operation can take up to a minute to finish.

The main window displays paired status, linked-account count, queued records, last MT5 read, and the last upload acknowledgment. A second launch brings the open app forward. There is no automatic Windows-startup registration.

Staging and other dashboard addresses have separate pairings and local databases. When upgrading an existing command-line installation for the same address, the app uses the same Windows Credential Manager entries and capture database. It adopts saved terminal paths when the desktop settings are empty. Stop the old command-line connector before starting the desktop app for that address.

Credentials remain in the current Windows user's Credential Manager. Desktop preferences, trade state, pending uploads, and brief diagnostics are stored under `%LOCALAPPDATA%/YMFX`. The app supports investor or standard broker credentials for capture. Broker order controls are outside the app. Broker history cannot reconstruct a stop change missed while the terminal was offline.

Earlier history remains optional. On the website choose a lookback range, **Find earlier trades**, and review the preview before importing. Keep the app open through the scan. Stop, cancel, and retry preserve the staged history state.

## Build the executable from source

The `connector/` directory contains the desktop interface, process controller, capture engine, calculations, tests, and packaging configuration. Build on Windows x64 using Python 3.13. Runtime dependencies and PyInstaller are pinned in `requirements-build.lock.txt`.

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r connector\requirements-build.txt
.\connector\build.ps1 -Python (Resolve-Path .\.venv\Scripts\python.exe).Path
```

The script produces `connector/dist/YoungMoney3 Connector.exe`, `SHA256SUMS.txt`, and a clean-profile GUI smoke-test report. The `.github/workflows/connector-desktop.yml` workflow runs the same build on Windows. Publish these versioned outputs as staging release assets. The executable is unsigned, so Windows can display a publisher prompt. Persistent data stays outside the one-file executable's temporary extraction directory.

The PyInstaller spec explicitly bundles project modules and installed package dependencies. It does not collect terminal installations, the developer's virtual environment, capture databases, or credential stores.

## Advanced command-line use

The source engine remains available for maintenance and automated reconciliation.

```powershell
.\.venv\Scripts\python.exe connector\connect.py "https://your-dashboard.example" "C:\Trading\Demo1\terminal64.exe" --pair
```

Enter the website pairing code when prompted. Restart without `--pair`, or add `--sync-once` for one reconciliation pass. A background supervisor can request a graceful stop with `--stop-file`, and the desktop app passes pairing codes through stdin using `--pair-code-stdin`; the code never appears in command arguments.
