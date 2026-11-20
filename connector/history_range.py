"""Resumable historical MT5 deposit-boundary discovery.

Deposit candidates are positive DEAL_TYPE_BALANCE cash adjustments in the
broker's own deal ledger. Broker credits/bonuses (DEAL_TYPE_CREDIT) are not
assumed to be deposits. Records absent from MT5 remain unavailable.
"""
from __future__ import annotations

from datetime import datetime, timezone

DAY_MS = 86_400_000
DISCOVERY_WINDOW = 180 * DAY_MS
DISCOVERY_WINDOWS_PER_CYCLE = 4


def utc(ms):
    return datetime.fromtimestamp(max(0, int(ms)) / 1000, timezone.utc)


def deposit_candidates(deals, since, until, balance_type=2):
    """Return positive balance movements with exact broker ticket/time/amount."""
    found = []
    for deal in deals:
        if int(deal.get("type", -1)) != balance_type:
            continue
        amount = float(deal.get("profit") or 0)
        if not (amount > 0):
            continue
        at = int(deal.get("time_msc") or int(deal.get("time") or 0) * 1000)
        ticket = str(deal.get("ticket", ""))
        if since <= at < until and ticket.isdecimal():
            found.append({"time_msc": at, "ticket": ticket, "amount": amount, "raw": deal})
    return found


def discover_deposit(db, link, request, linked_at, offset, mode, mt5, report=None):
    """Read at most four historical windows; checkpoint before next capture cycle.

    Returns (complete, candidate). Incomplete discovery continues next time.
    The caller performs server acknowledgement; this function changes only
    local checkpoint state and never touches network credentials.
    """
    if mode not in ("since_last_deposit", "since_first_deposit"):
        raise ValueError("Not a deposit-anchored request")
    db.execute("""CREATE TABLE IF NOT EXISTS history_anchor_scan(
        link TEXT PRIMARY KEY, request TEXT NOT NULL, cursor INTEGER NOT NULL,
        candidate_at INTEGER, candidate_ticket TEXT, candidate_amount REAL
    )""")
    row = db.execute(
        "SELECT request,cursor,candidate_at,candidate_ticket,candidate_amount FROM history_anchor_scan WHERE link=?",
        (link,)).fetchone()
    if not row or row[0] != request:
        row = (request, int(linked_at), None, None, None)
        with db:
            db.execute("INSERT OR REPLACE INTO history_anchor_scan VALUES(?,?,?,?,?,?)",
                       (link, *row))
    cursor, best_at, best_ticket, best_amount = row[1:]
    for _ in range(DISCOVERY_WINDOWS_PER_CYCLE):
        if cursor <= 0:
            break
        earlier = max(0, cursor - DISCOVERY_WINDOW)
        # MT5's request window uses the broker raw timestamp domain;
        # the selected deposit is normalized against the measured offset.
        source = mt5.history_deals_get(utc(earlier + offset), utc(cursor + offset))
        if source is None:
            raise RuntimeError("MT5 deposit history unavailable: broker rejected the history request")
        deals = [deal._asdict() if hasattr(deal, "_asdict") else deal for deal in source]
        rows = deposit_candidates(deals, earlier + offset, cursor + offset,
                                  getattr(mt5, "DEAL_TYPE_BALANCE", 2))
        for deal in rows:
            at = deal["time_msc"]
            if best_at is None or (mode == "since_first_deposit" and at < best_at) or (
                    mode == "since_last_deposit" and at > best_at):
                best_at, best_ticket, best_amount = at, deal["ticket"], deal["amount"]
        cursor = earlier
        with db:
            db.execute("UPDATE history_anchor_scan SET cursor=?,candidate_at=?,candidate_ticket=?,candidate_amount=? WHERE link=?",
                       (cursor, best_at, best_ticket, best_amount, link))
        if report:
            report({"state": "history-discovery", "message":
                    "Searching broker balance transactions for the selected deposit boundary."})
        if mode == "since_last_deposit" and best_at is not None:
            break
    done = cursor == 0 or (mode == "since_last_deposit" and best_at is not None)
    if not done:
        return False, None
    if best_at is None:
        return True, None
    return True, {"since": max(0, best_at - offset),
                  "ticket": best_ticket, "amount": best_amount}


def clear_discovery(db, link, request):
    with db:
        db.execute("DELETE FROM history_anchor_scan WHERE link=? AND request=?", (link, request))
