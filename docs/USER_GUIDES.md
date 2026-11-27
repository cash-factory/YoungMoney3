# YoungMoney3 | User guides and interactive manuals

**Primary Windows connector:** Signal Desk. The older classic connector is now an owner-restricted recovery tool and is not part of regular member onboarding. The redesigned interface includes the sixteen-step guide described below. See [Signal Desk primary release](SIGNAL_DESK_PRIMARY.md) for rollout and signed update gates.

This reference explains the **in-product guides** for the trading dashboard and the Windows MT5 connector. It describes the available controls; it does not grant account permissions or simulate broker results.

## Dashboard: Field Guide

From the signed-in dashboard choose **Explore platform features**. The Field Guide can also be opened again from the workspace navigation. Existing users are not forced into a new tour; new users may dismiss the invitation.

The guide includes **22 real feature destinations**, searchable by feature name and grouped by area. Select an individual destination, take the **9-stop grand tour**, or choose one of these shorter routes:

| Learning path | What it visits |
| --- | --- |
| Connect MetaTrader | MT5 Connections → Broker Accounts → account filters |
| Review a trade | Quick capture → Trading Journal → Trade Calendar → Weekly Reviews |
| Build your playbook | Trading Plan → Strategies → Risk Control → Testing Lab |
| Read your results | Focus modes → Analytics → AI Insights |

The tour highlights **actual visible controls**, not fictional app screenshots. Next/Previous moves through the chosen route; **Skip to…** opens the directory again. **Explore this page myself** ends the tour while leaving you on the current workspace page. The guide never submits a trade, modifies an account or starts the copier.

The important workflows include numbered explanations inside their steps. Visited destinations are retained locally for the signed-in user where browser storage is available. **Escape** closes the guide and the tour can be reopened later. Animations are decorative; the operating system's reduced-motion preference disables them.

### What to verify after completing the MT5 path

1. The Windows connector is paired with your signed-in YoungMoney3 dashboard.
2. The correct MT5 broker **server and login** have been identified; a saved label alone is not sufficient.
3. You explicitly selected monitoring for the desired account in the dashboard.
4. The connector recorded **confirmed broker capture**; a connected PC alone does not prove it.

## Windows connector: Help & Guides

Open the Windows connector's **Help** page. The current native app contains four interactive topics:

| Topic | What you learn | Actual screens it opens |
| --- | --- | --- |
| Get connected | Pair PC, create a dedicated MT5 login, select monitoring, verify capture | Connect this PC, My Accounts, Dashboard |
| Monitor accounts | Inspect account identity, request capture, check confirmation | My Accounts, Home, Recent Activity |
| Fix a disconnection | Differentiate pairing failures from session problems and request a broker-history recheck | Connect this PC, My Accounts, Recent Activity |
| Understand copying | Distinguish read-only capture from separately authorized live copying | Trade Copying, Copy Studio entry |

Each topic contains four steps. Use the numbered step selector or **Previous / Next step**; the action inside each step navigates to the corresponding **real connector screen**. It does **not** execute that screen's action. The help page also provides a searchable FAQ and a small exploration progress bar. Progress stores only guide step IDs in this Windows user's local webview storage; it contains no broker credentials, pairing codes or trades.

### Critical operational distinctions

- **PC paired** means the Windows connector has a saved connection; it is not proof of a successful broker login.
- **Broker verified** identifies the account; **Monitoring** requires independently confirmed capture.
- A history **recheck request** is not proof that every missing execution has been recovered. Review the broker fills, position lifecycle and any integrity conflicts in the journal.
- **Read-only monitoring** does not authorize copying. The new native shell cannot arm a fleet or place copied orders. Copying involves a separate authorization and acceptance process.
- **First observed stop and original risk evidence** must remain auditable after reconnection. Missing intervening changes cannot be reconstructed as if observed.

### On-screen guidance versus trading actions

Guide controls only switch documentation topics, reveal answers or open named screens. Starting or stopping monitoring, creating a terminal login, requesting reconciliation, and any copying-related authorization remain separate explicit user actions.

## Classic Windows connector: Help & Guides

The currently released Tk desktop connector also has a refreshed **Help & Guides** screen. It offers the same four trader-first topics and 16 steps. Choose a topic, jump to a numbered step, use **Previous / Next**, read a practical caution, and choose an action that opens a real connector screen or the authenticated web dashboard. Search or expand the eight common questions. A subtle change of heading colour gives step-change feedback when the app's **Motion** option is on; motion can be switched off.

Exploration progress stores only known topic/step identifiers in `guide-progress.json` in the Windows connector's existing preferences directory. The file contains no account IDs, broker passwords, pairing secrets or journal records.

**Important difference:** the classic connector has separately confirmed, account-bound **DEMO and LIVE copier authorization** controls. The *guide* never presses these controls. The newer Tauri preview has no live-copy execution authority in its shell. See the app's version and consent screen before assessing copying capability.

## Quality and release acceptance

The connector includes `npm run test:static` under `connector/desktop`, which checks guide assets and a JavaScript interaction smoke test. The dashboard has `scripts/test-guide-browser.mjs` for Playwright coverage (desktop and mobile, reduced motion, spotlight navigation, persistence and the task routes).

Before releasing an installer or promoting the website:

1. Run `npm run typecheck`, `npm run lint`, `npm run build` and the dashboard guide Playwright test against a local preview.
2. In `connector/desktop`, run `npm run test:static`; build the installer and verify the native guide at common window sizes.
3. Use a keyboard and screen reader to check topic buttons, step selection, FAQ expansion and focus visibility; repeat with **Reduce motion** enabled.
4. Verify guide links route to real controls without accidentally pairing, enabling capture, authorizing copying or sending broker orders.
5. Test disconnected, partially paired, verified-but-not-monitoring and actively monitoring states using genuine connector events.
6. Confirm broker capture/recovery and copier behavior separately against appropriate MT5 demo or supervised test accounts. UI tests never prove broker-level correctness.

See [Windows connector](../connector/README.md), [Native desktop setup](../connector/desktop/README.md) and [UI acceptance](UI_ACCEPTANCE.md) for technical test and release context.
