"""Resumable, evidence-first reconciliation of MT5 positions after offline gaps.

Being absent from positions_get() does NOT prove closure. Only the full deal
lifecycle for the previously observed position can establish a final exit.
The caller commits generated outbox events and local checkpoint together;
remote receipts clear the outbox only after successful server confirmation.
"""
WINDOW_MS=86400000
RETRY_MS=60000

def history_window(linked_at,cursor,end):
    """Bounded broker-history catch-up, with one-day overlap for late fills."""
    next_until=min(int(end),int(cursor)+WINDOW_MS)
    previous_since=max(int(linked_at),int(cursor)-WINDOW_MS)
    return previous_since,next_until,next_until<int(end)-60000

def due_positions(db,link,currently_open,now,limit=16):
    """Prioritize disappeared positions; also recovers records old clients retired."""
    open_ids={str(value) for value in currently_open}
    rows=db.execute("""
      SELECT o.position_id,MAX(o.at_ms),r.status,r.checked_ms
      FROM position_observations o
      LEFT JOIN position_recovery r ON r.link=o.link AND r.position_id=o.position_id
      WHERE o.link=?
      GROUP BY o.position_id
      ORDER BY MAX(o.at_ms) DESC
    """,(link,)).fetchall()
    due=[]
    unresolved=0
    for position_id,_,status,checked in rows:
        if position_id in open_ids:
            continue
        if status=="broker_closure_verified":
            continue
        unresolved+=1
        if len(due)<limit and (checked is None or now-int(checked)>=RETRY_MS):
            due.append(str(position_id))
    return due,unresolved

def mark_checked(db,link,pid,when,closed):
    db.execute("""INSERT INTO position_recovery(link,position_id,status,checked_ms)
       VALUES(?,?,?,?) ON CONFLICT(link,position_id)
       DO UPDATE SET status=excluded.status,checked_ms=excluded.checked_ms""",
       (link,str(pid),"broker_closure_verified" if closed else "awaiting_broker_closure",int(when)))
