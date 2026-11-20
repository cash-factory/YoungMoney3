"""Automatically backfill MT5 balance operations without importing trades.

Only DEAL_TYPE_BALANCE entries are queued; incoming funds can still represent
broker adjustments, so the server labels them unverified movements. The cursor
is local, monotonic and resumable. We never require a manual history scan to
discover cash movements predating the connection.
"""
from datetime import datetime, timezone

WINDOW_MS=90*86400000

def utc(value):
    return datetime.fromtimestamp(max(0,int(value))/1000,timezone.utc)

def backfill(db,link,linked_at,offset,mt5,enqueue,raw,*,windows=2):
    row=db.execute("SELECT cursor,complete FROM cash_history_scan WHERE link=?",(link,)).fetchone()
    if row is None:
        with db:
            db.execute("INSERT OR IGNORE INTO cash_history_scan(link,cursor,complete) VALUES(?,?,0)",
                       (link,int(linked_at)))
        row=(int(linked_at),0)
    cursor,complete=row
    if complete:
        return {"cursor":0,"complete":True}
    balance_type=int(getattr(mt5,"DEAL_TYPE_BALANCE",2))
    for _ in range(max(1,windows)):
        if cursor<=0:
            break
        earlier=max(0,cursor-WINDOW_MS)
        # The MT5 API sees broker-clock timestamps; preserve raw broker data.
        deals=mt5.history_deals_get(utc(earlier+offset),utc(cursor+offset))
        if deals is None:
            # Do not lose checkpoint or block the normal trade capture loop.
            raise RuntimeError("Broker did not return balance transaction history.")
        with db:
            for item in deals:
                data=raw(item)
                ticket=str(data.get("ticket",""))
                amount=float(data.get("profit") or 0)
                at=int(data.get("time_msc") or int(data.get("time") or 0)*1000)-offset
                if (int(data.get("type",-1))==balance_type and ticket.isdecimal()
                    and amount!=0 and earlier<=at<cursor):
                    enqueue(link,"raw","deal-"+ticket,data)
            db.execute("UPDATE cash_history_scan SET cursor=?,complete=? WHERE link=?",
                       (earlier,int(earlier==0),link))
        cursor=earlier
        if cursor==0:
            break
    return {"cursor":cursor,"complete":cursor==0}
