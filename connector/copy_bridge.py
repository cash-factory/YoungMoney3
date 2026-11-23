"""Signed-device bridge for read-only source observation and explicitly consented DEMO followers.

This runs on each account's existing dedicated MT5 process after the capture
outbox has synced. MT5 is never accessed concurrently from a second thread.
"""
import json
import time
from datetime import datetime, timezone
from decimal import Decimal

from copy_execution import execute, prepare_database, consent

def _dict(row):
    return row._asdict() if hasattr(row,"_asdict") else dict(row)

def _now():
    return int(time.time()*1000)

def _position_item(p):
    row=_dict(p)
    ident=str(row.get("identifier") or row.get("ticket"))
    return {
      "key":"position:"+ident,"kind":"position","symbol":str(row["symbol"]),
      "type":int(row["type"]),"volume":float(row["volume"]),
      "price":float(row["price_open"]),"sl":float(row.get("sl") or 0),
      "tp":float(row.get("tp") or 0),"stoplimit":0.0,"expiration":0,
      "time_ms":int(row.get("time_msc") or int(row.get("time") or 0)*1000),
    }

def _pending_item(p):
    row=_dict(p)
    ticket=str(row["ticket"])
    return {
      "key":"pending:"+ticket,"kind":"pending","symbol":str(row["symbol"]),
      "type":int(row["type"]),"volume":float(row.get("volume_current") or row.get("volume_initial") or 0),
      "price":float(row["price_open"]),"sl":float(row.get("sl") or 0),
      "tp":float(row.get("tp") or 0),
      "stoplimit":float(row.get("price_stoplimit") or 0),
      "expiration":int(row.get("time_expiration") or 0)*1000,
      "time_ms":int(row.get("time_setup_msc") or int(row.get("time_setup") or 0)*1000),
    }

def _fresh_deal_proof(mt5,pid,now_ms):
    deals=mt5.history_deals_get(position=int(pid))
    if not deals:
        return None
    execution=[_dict(d) for d in deals if int(_dict(d).get("type",-1)) in (0,1)]
    execution.sort(key=lambda d:(int(d.get("time_msc") or 0),int(d.get("ticket") or 0)))
    if not execution:
        return None
    latest=execution[-1]
    at=int(latest.get("time_msc") or int(latest.get("time") or 0)*1000)
    if not (0<=now_ms-at<=12000) or int(latest.get("entry",-1)) not in (1,2,3):
        return None
    net=sum((Decimal(str(d["volume"]))*(1 if int(d["type"])==0 else -1) for d in execution),Decimal("0"))
    kind="closed" if net==0 else "reduced"
    return {"key":"position:"+str(pid),"kind":kind,"ticket":str(latest["ticket"]),"time_ms":at}

def _pending_cancel_proof(mt5,ticket,now_ms):
    rows=mt5.history_orders_get(ticket=int(ticket))
    if not rows or len(rows)!=1:
        return None
    row=_dict(rows[0])
    state=int(row.get("state",-1))
    if state not in (int(getattr(mt5,"ORDER_STATE_CANCELED",2)),
                     int(getattr(mt5,"ORDER_STATE_EXPIRED",6))):
        return None
    at=int(row.get("time_done_msc") or int(row.get("time_done") or 0)*1000)
    if not (0<=now_ms-at<=12000):
        return None
    return {"key":"pending:"+str(ticket),"kind":"cancelled","ticket":str(ticket),"time_ms":at}

def _source_frame(mt5,db,link,positions,orders,observed_at):
    items=[_position_item(p) for p in positions]+[_pending_item(o) for o in orders]
    items.sort(key=lambda x:x["key"])
    previous=db.execute("SELECT payload FROM copy_source_frames WHERE link=?",(link,)).fetchone()
    previous_items=json.loads(previous[0]) if previous else []
    known={item["key"]:item for item in previous_items}
    current={item["key"]:item for item in items}
    proofs=[]
    for key,item in known.items():
        if key in current:
            if key.startswith("position:") and current[key]["volume"]<item["volume"]:
                candidate=_fresh_deal_proof(mt5,key.split(":",1)[1],observed_at)
                if candidate and candidate["kind"]=="reduced":
                    proofs.append(candidate)
            continue
        if key.startswith("position:"):
            proof=_fresh_deal_proof(mt5,key.split(":",1)[1],observed_at)
            if proof and proof["kind"]=="closed":
                proofs.append(proof)
        else:
            proof=_pending_cancel_proof(mt5,key.split(":",1)[1],observed_at)
            if proof:
                proofs.append(proof)
    return items,proofs

def _pending_acks(db,link,post,token):
    # Broker action has already happened. Network failure must not trigger
    # another order_send. Resume only its idempotent server acknowledgement.
    rows=db.execute("SELECT task_id,result FROM copy_local_tasks WHERE link=? AND result IS NOT NULL AND status='ack_pending' LIMIT 5",(link,)).fetchall()
    for task_id,serialized in rows:
        result=json.loads(serialized)
        try:
            post("copy-ack",{"link":link,"task":task_id,**result},token)
        except Exception:
            break
        with db:
            db.execute("UPDATE copy_local_tasks SET status=? WHERE task_id=? AND link=?",
                       (result["status"],task_id,link))

def cycle(mt5,db,link,account,post,token,*,now_ms=None):
    now_ms=now_ms or _now()
    # The caller has already verified that this is this account's dedicated
    # terminal. No cross-account MT5 initialization or password reuse here.
    prepare_database(db)
    positions=mt5.positions_get()
    pending=mt5.orders_get()
    if positions is None or pending is None:
        raise RuntimeError("Copy Fleet account telemetry unavailable")
    current_consent=consent(db,link)
    post("copy-consent",{"link":link,"allowed":current_consent},token)
    response=post("copy-report",{
      "link":link,"balance":float(account.balance),"equity":float(account.equity),
      "freeMargin":float(account.margin_free),"currency":str(account.currency),
      "openPositions":len(positions),"pendingOrders":len(pending),
      "connected":bool(mt5.terminal_info().connected),
      "tradeAllowed":bool(getattr(account,"trade_allowed",False)),
    },token)
    with db:
        db.execute("""INSERT INTO copy_local_health(link,observed_at_ms,account_balance,account_equity,margin_free,
            open_positions,pending_orders,source_active,last_execution_result)
            VALUES(?,?,?,?,?,?,?,?,NULL) ON CONFLICT(link) DO UPDATE SET
            observed_at_ms=excluded.observed_at_ms,
            account_balance=excluded.account_balance,account_equity=excluded.account_equity,
            margin_free=excluded.margin_free,open_positions=excluded.open_positions,
            pending_orders=excluded.pending_orders,source_active=excluded.source_active""",
            (link,now_ms,float(account.balance),float(account.equity),float(account.margin_free),
             len(positions),len(pending),int(bool(response.get("sourceActive")))))
    _pending_acks(db,link,post,token)
    if response.get("sourceActive"):
        items,proofs=_source_frame(mt5,db,link,positions,pending,now_ms)
        post("copy-source",{"link":link,"observedAt":now_ms,
             "sourceEquity":float(account.equity),"sourceCurrency":str(account.currency),
             "items":items,"proofs":proofs},token)
        with db:
            db.execute("INSERT INTO copy_source_frames VALUES(?,?,?) ON CONFLICT(link) DO UPDATE SET payload=excluded.payload,observed_at_ms=excluded.observed_at_ms",
                       (link,json.dumps(items,sort_keys=True),now_ms))
    if not current_consent or not getattr(account,"trade_allowed",False):
        return {"executions":0,"local_consent":current_consent}
    work=post("copy-poll",{"link":link},token).get("task")
    if not work:
        return {"executions":0,"local_consent":current_consent}
    result=execute(mt5,db,link,work,account,now_ms=now_ms)
    with db:
        db.execute("UPDATE copy_local_health SET last_execution_result=? WHERE link=?",
                   (str(result["status"])+"/"+str(result["code"]),link))
    try:
        post("copy-ack",{"link":link,"task":work["id"],**result},token)
    except Exception:
        with db:
            db.execute("UPDATE copy_local_tasks SET status='ack_pending',result=? WHERE task_id=? AND link=?",
                       (json.dumps(result),work["id"],link))
    return {"executions":1,"local_consent":current_consent,
            "result":result["status"],"result_code":result["code"]}
