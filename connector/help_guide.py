"""Trader-facing help text for the classic Windows connector.

Only describes or navigates to UI screens. It never requests broker or copy actions.
Keep the copy distinct from the Tauri preview: this Tk connector supports explicit
account-bound copier consent, whereas the new Tauri shell does not arm orders.
"""

GUIDE_TOPICS = (
    {
        "id": "connect", "title": "Get connected",
        "subtitle": "Pair your PC and verify the right MT5 account.",
        "steps": (
            ("Pair this Windows PC",
             "In your signed-in YoungMoney3 dashboard, open MT5 Connections and generate a short-lived pairing code. Paste it under Connect this PC. Pairing identifies this computer; it does not authorize copying.",
             "Do not share pairing codes. Reuse a valid saved pairing instead of creating duplicate PCs.",
             "pair", "Open pairing"),
            ("Add an MT5 account",
             "Choose Add account. This version opens the account setup on your authenticated dashboard and prepares the local MT5 session. Follow the broker login prompts there.",
             "Use the exact broker server and login; a friendly account name is not identity proof.",
             "sessions", "Open My Accounts"),
            ("Choose your monitoring accounts",
             "Review account links and monitoring choices on the dashboard. You can manage local sessions here and check the account each session belongs to.",
             "Read-only monitoring and trade-copying permission are different decisions.",
             "sessions", "Review accounts"),
            ("Verify that trade capture is working",
             "Look for a confirmed broker login, recent synchronization evidence and the appropriate account status. A PC being online is not enough.",
             "An accepted request is not proof that a broker fill reached your journal.",
             "activity", "Review recent activity"),
        ),
    },
    {
        "id": "monitor", "title": "Monitor accounts",
        "subtitle": "Follow each account from login to verified evidence.",
        "steps": (
            ("Inspect the right broker login",
             "Open My Accounts and select the MT5 session. Match the broker server and login to the account you intend to monitor.",
             "Avoid relying on a manually assigned session label alone.",
             "sessions", "Inspect sessions"),
            ("Manage monitoring deliberately",
             "Use the account controls to resume or pause monitoring only after you know which account is selected. Check the dashboard for any remote monitoring restrictions.",
             "A monitoring change does not enable trade copying.",
             "sessions", "Review monitoring controls"),
            ("Confirm the latest broker capture",
             "Check account status and last synchronized information. Review Recent Activity if the service reports a retry, a pause or a rejected upload.",
             "Do not treat an online PC indicator as proof of account capture.",
             "activity", "Review capture events"),
            ("Review your journal records",
             "Open the authenticated dashboard to review broker fills, recorded trade lifecycles and journal notes in the correct account context.",
             "Broker evidence and first observed risk must remain auditable.",
             "dashboard", "Open the dashboard"),
        ),
    },
    {
        "id": "recover", "title": "Fix a disconnection",
        "subtitle": "Recheck missing time without hiding conflicting evidence.",
        "steps": (
            ("Separate PC and MT5 failures",
             "Check whether the PC is still paired, then inspect the affected broker session. A connection problem on one account does not necessarily mean the whole PC is unpaired.",
             "Do not create a second pairing merely to clear a session warning.",
             "pair", "Check PC pairing"),
            ("Check the account and terminal",
             "Open My Accounts. Confirm the correct broker login and that its MT5 terminal is available before changing the capture state.",
             "Do not remove a saved session simply to tidy up a capture warning.",
             "sessions", "Inspect the affected account"),
            ("Retry the selected account",
             "If the broker session is properly linked, use Retry this account to request another capture cycle. Recovery reconciles available broker history after an offline interval.",
             "A retry request is not evidence that every missing execution has arrived.",
             "sessions", "Find the retry control"),
            ("Review the evidence after recovery",
             "Check Recent Activity and compare the resulting broker fills and positions in your dashboard. Conflicting records remain visible for review, not silently overwritten.",
             "Interim stop changes that were never observed cannot be invented.",
             "activity", "Review recovery events"),
        ),
    },
    {
        "id": "copy", "title": "Understand trade copying",
        "subtitle": "Know the extra steps before authorizing real orders.",
        "steps": (
            ("Keep monitoring and copying separate",
             "Monitoring captures broker information. Trade copying can place orders and requires a separate, account-specific authorization.",
             "The guide never enables, arms, or places an order.",
             "sessions", "Inspect account permissions"),
            ("Choose and verify each follower",
             "On My Accounts, select the intended broker login before viewing Authorize DEMO copier or Authorize LIVE copier. The application requires explicit confirmation for these actions.",
             "Real-money copying can incur loss, slippage and broker rejection. Do not authorize an unfamiliar account.",
             "sessions", "Review follower controls"),
            ("Set the fleet and risk in Copy Studio",
             "Open Copy Studio on your authenticated dashboard to review master/follower roles, order handling, stop distances and sizing rules.",
             "Fixed-cash and percentage risk require verified instrument specifications and stop distances.",
             "copy-studio", "Open Copy Studio"),
            ("Arm only after all checks pass",
             "Separate fleet arming requires eligible online followers, valid risk settings, correct account mode and local consent. A missing permission must block execution.",
             "Pausing does not recall orders already sent to a broker.",
             "copy-studio", "Review fleet safety"),
        ),
    },
)

FAQ = (
    ("Why is my PC connected but no trades appear?",
     "PC pairing is not broker capture. Check the exact login/server, account monitoring choice, confirmed sync and any recent upload errors."),
    ("Will trades taken during a disconnection return?",
     "The connector can reconcile available broker history after reconnection. Verify recovered fills and positions before treating the journal as complete."),
    ("Can I change original risk after a trade?",
     "You can add review notes, but immutable broker records and the first observed protective stop must remain preserved."),
    ("Does Pair this PC authorize copying?",
     "No. Trade copying needs separate, account-specific local approval and fleet arming."),
    ("Can this classic connector authorize LIVE copying?",
     "It exposes an explicitly confirmed, broker-account-bound LIVE copier permission. Never grant it without checking the login, risk and consequences. The newer Tauri preview has no execution authority."),
    ("How do I get a second MT5 account?",
     "Add another account through the dashboard setup. Keep the broker login/server and dedicated terminal session distinct."),
    ("Where do I find my PC name and linked accounts?",
     "Use MT5 Connections on your signed-in dashboard. My Accounts in the connector shows local sessions."),
    ("Is a successful retry proof of recovered fills?",
     "No. Confirm the broker evidence in the dashboard and review integrity discrepancies before relying on analytics."),
)


def topic_for(identifier):
    """Resolve a stable topic ID; default safely to first-time setup."""
    return next((topic for topic in GUIDE_TOPICS if topic["id"] == identifier), GUIDE_TOPICS[0])


def available_step_ids():
    return {
        f'{topic["id"]}:{index}'
        for topic in GUIDE_TOPICS for index in range(len(topic["steps"]))
    }


def search_faq(query):
    phrase = str(query or "").strip().casefold()
    return [(index, title, answer) for index, (title, answer) in enumerate(FAQ)
            if not phrase or phrase in (title + " " + answer).casefold()]
