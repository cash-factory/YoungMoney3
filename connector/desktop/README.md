# YoungMoney3 — Signal Desk native connector migration

**Connector-only development.** The non-connector journal, website, Worker and broker ledger have **not** been redesigned or altered here.

This implementation adapts the user-approved Signal Desk V4 interface into a Windows desktop shell using **Tauri 2 (Rust/WebView2)** with a bundled **Python MT5 bridge**. It preserves the trading engine in `connector/connect.py` and uses the real `SessionStore` instead of imaginary broker accounts when installed natively.

## Already implemented

- Custom desktop chrome/navigation, six page views, V4 spacious spacing and responsive breakpoints, exact YoungMoney3 brand SVG, original connection/copying/pairing vector art and state-dependent motion.
- Separately auditable external CSS and JavaScript under `desktop-ui/assets/`, using no runtime CDN or network dependencies.
- Native connection status based on actual saved PC pairing and confirmed connector events. **Never** marks copying ready simply because capture is running.
- Read-only local account/session inspector, terminal detection, explicit monitoring start/stop, per-session monitoring on/off, local pairing, session event history and links to established dashboard and Copy Studio.
- JSON-lines IPC over a private parent-owned process pipe (not a web server). Allowlisted requests and response sanitization. No password or pairing code saved to UI storage.
- Copy trading execution, fleet arming and account authorization are **not** callable through the new shell pending separate real Windows/broker acceptance. Existing connector remains available.
- Visual QA at 1600x940, 1366x768, 1024x768 and 900x700 for all six native screens; a standalone design-preview mode continues to show explicitly fictional data in an ordinary browser.

## Build and test on Windows

1. Use Windows 11 with Python 3.13, Rust, Node 22+, MSVC Build Tools and WebView2. Tauri documentation: https://v2.tauri.app/start/prerequisites/
2. From the **YoungMoney3 repository root**, install existing connector requirements: `python -m pip install -r connector/requirements.txt pyinstaller`.
3. Run bridge tests: `python -m unittest discover -s connector/desktop/tests -p 'test_desktop_bridge.py' -v`.
4. Freeze the Python sidecar (`--console` is required to preserve IPC):
   `python -m PyInstaller --onefile --console --name ymfx-bridge --paths connector --collect-all MetaTrader5 --collect-all keyring --collect-all numpy --collect-all tzdata connector/desktop/bridge/desktop_bridge.py`
5. Copy the executable to `connector/desktop/src-tauri/binaries/ymfx-bridge-x86_64-pc-windows-msvc.exe`.
6. `cd connector/desktop`, then run `npm install --no-audit` and `npm run build:windows`.
7. Install the unsigned NSIS staging package under `src-tauri/target/release/bundle/nsis/` on a disposable Windows machine. **Do not** replace the current connector as a production update before actual broker tests and signed packaging.

## Workflow intent

`connector-signaldesk-native.yml` builds an isolated preview installer only. It does **not** deploy the main website, publish a production release, or authorize live trades.

## Critical acceptance still outstanding

- Verify that PyInstaller and Tauri sidecar spawn cooperate in a real Windows user session, including window shutdown, process cleanup, WebView2 availability, OS permissions and an unsigned installer warning.
- Test a real MT5 Windows broker connection, multiple simultaneous terminals, disconnect/reconnect history reconciliation, duplicate prevention and no loss of original-risk data.
- Integrate copier **read-only telemetry** and a separately reviewed local authorization mechanism before offering any Arm/Authorize action in the new UI.
- Verify GUI keyboard/assistive-technology accessibility, all modal paths, touch/scale factors and reduced-motion OS settings on physical Windows systems.

**No test reported here establishes that the native installer or broker capture works on a real Windows PC.** The existing `0.6.3-rc1` legacy release had a startup contract mismatch in Windows CI; this migration does not silently bypass that gate.