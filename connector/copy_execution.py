"""YoungMoney3 DEMO-only MT5 copy execution adapter.

The normal connector remains read-only unless a specific follower was locally
authorized AND the dashboard fleet is armed AND a short-lived signed-device
task was issued for that follower. Trade execution occurs only in that
follower's isolated /portable MT5 process. No website order_send or credentials.

A dispatched task is reserved in durable SQLite BEFORE broker submission.
Ambiguous outcomes are never automatically submitted twice.
"""
import hashlib
import json
import time
from datetime import datetime, timezone
from decimal import Decimal

from copy_risk import calculate, CopyRiskError, D, floor_volume

MAX_TASK_AGE_MS=15000
SUCCESS_RET_CODES=(10008,10009,10010)  # PLACED, DONE, DONE_PARTIAL
COPY_MARKER="YMC"

class CopyExecutionError(Exception):
    def __init__(self,code):
        super().__init__(code)
        self.code=code

def prepare_database(db):
    db.executescript("""
      CREATE TABLE IF NOT EXISTS copy_local_permissions (
        link TEXT PRIMARY KEY, approved INTEGER NOT NULL DEFAULT 0 CHECK(approved IN (0,1)),
        changed_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS copy_local_tasks (
        task_id TEXT PRIMARY KEY, link TEXT NOT NULL, status TEXT NOT NULL,
        result TEXT, started_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS copy_local_mappings (
        link TEXT NOT NULL,source_key TEXT NOT NULL,
        ticket TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('position','pending')),
        source_volume REAL NOT NULL, follower_volume REAL NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY(link,source_key)
      );
      CREATE TABLE IF NOT EXISTS copy_source_frames (
        link TEXT PRIMARY KEY, payload TEXT NOT NULL, observed_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS copy_local_health (
        link TEXT PRIMARY KEY, observed_at_ms INTEGER NOT NULL,
        account_balance REAL NOT NULL, account_equity REAL NOT NULL,
        margin_free REAL NOT NULL, open_positions INTEGER NOT NULL,
        pending_orders INTEGER NOT NULL, source_active INTEGER NOT NULL,
        last_execution_result TEXT
      );
    """)

def consent(db,link):
    row=db.execute("SELECT approved FROM copy_local_permissions WHERE link=?",(link,)).fetchone()
    return bool(row and row[0]==1)

def set_consent(db,link,approved):
    # Caller MUST be the local Windows GUI after an explicit confirmation.
    # This function never follows a remote device command.
    with db:
        db.execute("""INSERT INTO copy_local_permissions VALUES(?,?,?)
          ON CONFLICT(link) DO UPDATE SET approved=excluded.approved,
          changed_at_ms=excluded.changed_at_ms""",
          (link,int(bool(approved)),int(time.time()*1000)))

def receipt(status,code,*,ticket=None,retcode=None,details=None):
    return {"status":status,"code":code,"brokerTicket":str(ticket) if ticket is not None else None,
            "retcode":int(retcode) if retcode is not None else None,"details":details or {}}

def _identity(task):
    return task.get("id") and len(str(task.get("id")))==36 and task.get("action") in (
        "open_market","place_pending","modify_sl_tp","modify_pending",
        "cancel_pending","reduce_position","close_position")

def _resolve_symbol(mt5,source,risk):
    name=source.get("symbol")
    if not isinstance(name,str) or len(name)>48:
        raise CopyExecutionError("invalid_source_symbol")
    mapping=risk.get("symbolMap") or {}
    if not isinstance(mapping,dict):
        raise CopyExecutionError("invalid_symbol_mapping")
    destination=mapping.get(name,name)
    if not isinstance(destination,str) or not destination or len(destination)>48:
        raise CopyExecutionError("invalid_symbol_mapping")
    details=mt5.symbol_info(destination)
    if details is None or not mt5.symbol_select(destination,True):
        raise CopyExecutionError("instrument_not_available_on_follower")
    return destination,details

def _direction(order_type):
    return "buy" if int(order_type) in (0,2,4,6) else "sell"

def _broker_check(mt5,request):
    check=mt5.order_check(request)
    # MetaQuotes order_check retcode 0 signals a passed preflight, not a deal.
    if check is None or int(getattr(check,"retcode",-1))!=0:
        raise CopyExecutionError("broker_order_precheck_rejected")
    return check

def _fill_candidates(mt5,info,pending):
    if pending:
        return [mt5.ORDER_FILLING_RETURN]
    policy=int(getattr(info,"filling_mode",0))
    choices=[]
    # MetaQuotes SYMBOL_FILLING_FOK=1, IOC=2. RETURN is excluded for
    # Market Execution symbols; broker precheck is the final arbiter.
    if policy&1: choices.append(mt5.ORDER_FILLING_FOK)
    if policy&2: choices.append(mt5.ORDER_FILLING_IOC)
    if int(getattr(info,"trade_exemode",2))!=getattr(mt5,"SYMBOL_TRADE_EXECUTION_MARKET",2):
        choices.append(mt5.ORDER_FILLING_RETURN)
    return list(dict.fromkeys(choices))

def _daily_net_pnl(mt5,account):
    day=datetime.now(timezone.utc).replace(hour=0,minute=0,second=0,microsecond=0)
    observed=mt5.history_deals_get(day,datetime.now(timezone.utc))
    if observed is None:
        raise CopyExecutionError("daily_broker_history_unavailable")
    net=Decimal("0")
    for item in observed:
        if getattr(item,"type",-1) in (0,1):
            net+=sum((D(getattr(item,key,0)) for key in ("profit","commission","fee","swap")),Decimal("0"))
    positions=mt5.positions_get()
    if positions is None:
        raise CopyExecutionError("open_position_pnl_unavailable")
    for item in positions:
        net+=D(getattr(item,"profit",0))
    return net

def _validate_demo(mt5,account,terminal):
    if int(getattr(account,"trade_mode",-1))!=0:
        raise CopyExecutionError("real_or_contest_account_execution_blocked")
    if not getattr(account,"trade_allowed",False):
        raise CopyExecutionError("investor_or_restricted_broker_access")
    if terminal is None or not getattr(terminal,"connected",False):
        raise CopyExecutionError("mt5_terminal_offline")
    if not getattr(terminal,"trade_allowed",True):
        raise CopyExecutionError("mt5_autotrading_disabled")

def _mapping(db,link,key,kind):
    row=db.execute("SELECT ticket,kind,source_volume,follower_volume FROM copy_local_mappings WHERE link=? AND source_key=?",(link,key)).fetchone()
    if not row or row[1]!=kind:
        raise CopyExecutionError("verified_follower_ticket_mapping_missing")
    return {"ticket":str(row[0]),"sourceVolume":D(row[2]),"followerVolume":D(row[3])}

def _position_by_ticket(mt5,ticket):
    # Hedging accounts have distinct position tickets. Never close by symbol.
    positions=mt5.positions_get(ticket=int(ticket))
    if positions is None:
        raise CopyExecutionError("follower_position_query_failed")
    if len(positions)!=1:
        raise CopyExecutionError("mapped_follower_position_not_unique")
    return positions[0]

def _source_proof(action,body):
    if action in ("close_position","reduce_position","cancel_pending"):
        if not isinstance(body.get("confirmedBy"),str) or not body["confirmedBy"].isdigit():
            raise CopyExecutionError("source_broker_execution_proof_missing")

def _market_mapping_ticket(mt5,result,marker,symbol):
    # Market execution order IDs are NOT universally position tickets, notably
    # netting versus hedging. Prefer broker-deal POSITION_ID and verify live.
    deal=str(getattr(result,"deal",0) or "")
    if not deal.isdigit() or deal=="0":
        return None
    matches=mt5.history_deals_get(ticket=int(deal))
    if not matches or len(matches)!=1:
        return None
    pid=str(getattr(matches[0],"position_id",0))
    if not pid.isdigit() or pid=="0":
        return None
    active=mt5.positions_get()
    if active is None:
        return None
    candidates=[p for p in active if str(getattr(p,"identifier",0))==pid and
                str(getattr(p,"symbol",""))==symbol]
    return str(getattr(candidates[0],"ticket")) if len(candidates)==1 else None

def _request(mt5,db,link,task,account,now_ms):
    action=task["action"]
    body=task["payload"]
    if not isinstance(body,dict) or not isinstance(body.get("source"),dict) or not isinstance(body.get("risk"),dict):
        raise CopyExecutionError("invalid_copy_instruction")
    source=body["source"];risk=body["risk"]
    if source.get("key")!=task.get("sourceKey"):
        raise CopyExecutionError("mismatched_source_ticket")
    if not isinstance(risk.get("mode"),str):
        raise CopyExecutionError("missing_follower_policy")
    _source_proof(action,body)
    symbol,info=_resolve_symbol(mt5,source,risk)
    quote=mt5.symbol_info_tick(symbol)
    if quote is None or int(getattr(quote,"time_msc",0))<=0 or now_ms-int(quote.time_msc)>10000:
        raise CopyExecutionError("follower_quote_stale_or_unavailable")
    direction=_direction(source["type"])
    magic= int.from_bytes(hashlib.sha256((link+"/"+str(task["sourceKey"])).encode()).digest()[:4],"big")&0x7fffffff
    marker=COPY_MARKER+hashlib.sha256((str(task["sourceKey"])+"/"+link).encode()).hexdigest()[:9]
    common={"symbol":symbol,"magic":magic,"comment":marker}
    if action in ("open_market","place_pending"):
        if float(source.get("sl") or 0)<=0:
            raise CopyExecutionError("missing_protective_stop")
        pending=action=="place_pending"
        entry=float(source["price"]) if pending else float(quote.ask if direction=="buy" else quote.bid)
        if entry<=0:
            raise CopyExecutionError("invalid_follower_quote")
        size=calculate(mt5,account,symbol,direction=direction,entry=entry,stop=source["sl"],
            source_lots=body.get("sourceVolume"),source_equity=body.get("sourceEquity"),
            source_currency=body.get("sourceCurrency"),
            sizing_mode=risk["mode"],sizing_value=risk.get("value"),
            max_lots=risk.get("maxLots"))
        if _daily_net_pnl(mt5,account)<= -(D(account.equity)*D(risk["maxDailyLossPct"])/100):
            raise CopyExecutionError("daily_loss_limit_reached")
        if not pending and int(getattr(info,"trade_exemode",2))==getattr(mt5,"SYMBOL_TRADE_EXECUTION_MARKET",2):
            price_field={}
        else:
            price_field={"price":entry}
        order_type=int(source["type"]) if pending else (mt5.ORDER_TYPE_BUY if direction=="buy" else mt5.ORDER_TYPE_SELL)
        if pending and (order_type<2 or order_type>7):
            raise CopyExecutionError("unsupported_pending_order_type")
        request={**common,"action":mt5.TRADE_ACTION_PENDING if pending else mt5.TRADE_ACTION_DEAL,
          "volume":size["lots"],"type":order_type,"sl":float(source["sl"]),"tp":float(source.get("tp") or 0),
          **price_field}
        if pending:
            request.update({"stoplimit":float(source.get("stoplimit") or 0),
                "type_time":int(getattr(mt5,"ORDER_TIME_GTC",0))})
            if int(source.get("expiration",0))>0:
                expiration=int(source["expiration"])//1000
                if expiration<=int(now_ms//1000):
                    raise CopyExecutionError("source_pending_expired")
                request.update({"type_time":int(getattr(mt5,"ORDER_TIME_SPECIFIED",2)),"expiration":expiration})
        else:
            request["deviation"]=20
        return request,size,marker,info,pending
    kind="pending" if action in ("modify_pending","cancel_pending") else "position"
    mapping=_mapping(db,link,str(task["sourceKey"]),kind)
    ticket=mapping["ticket"]
    if action in ("modify_pending","cancel_pending"):
        matching=mt5.orders_get(ticket=int(ticket))
        if matching is None:
            raise CopyExecutionError("follower_pending_order_query_failed")
        if len(matching)!=1:
            raise CopyExecutionError("mapped_follower_pending_order_missing")
        current=matching[0]
        if str(current.symbol)!=symbol:
            raise CopyExecutionError("mapped_follower_symbol_mismatch")
        if action=="cancel_pending":
            return {"action":mt5.TRADE_ACTION_REMOVE,"order":int(ticket)},None,marker,info,True
        request={"action":mt5.TRADE_ACTION_MODIFY,"order":int(ticket),
                 "price":float(source["price"]),"sl":float(source["sl"]),
                 "tp":float(source.get("tp") or 0),"stoplimit":float(source.get("stoplimit") or 0),
                 "type_time":int(getattr(mt5,"ORDER_TIME_GTC",0))}
        if int(source.get("expiration",0))>0:
            request.update({"type_time":int(getattr(mt5,"ORDER_TIME_SPECIFIED",2)),
                            "expiration":int(source["expiration"])//1000})
        return request,None,marker,info,True
    position=_position_by_ticket(mt5,ticket)
    if str(position.symbol)!=symbol:
        raise CopyExecutionError("mapped_follower_symbol_mismatch")
    if action=="modify_sl_tp":
        return {"action":mt5.TRADE_ACTION_SLTP,"symbol":symbol,"position":int(ticket),
                "sl":float(source.get("sl") or 0),"tp":float(source.get("tp") or 0)},None,marker,info,False
    if action not in ("reduce_position","close_position"):
        raise CopyExecutionError("unsupported_copy_action")
    if action=="close_position":
        volume=D(position.volume)
    else:
        fraction=D(body["sourceVolume"])/mapping["sourceVolume"]
        volume=D(position.volume)*fraction
        volume=floor_volume(volume,info.volume_min,info.volume_max,info.volume_step,position.volume)
    if volume<=0 or volume>D(position.volume):
        raise CopyExecutionError("invalid_mapped_close_volume")
    closing_type=mt5.ORDER_TYPE_SELL if int(position.type)==0 else mt5.ORDER_TYPE_BUY
    bidask=float(quote.bid if closing_type==mt5.ORDER_TYPE_SELL else quote.ask)
    request={**common,"action":mt5.TRADE_ACTION_DEAL,"position":int(ticket),
             "volume":float(volume),"type":closing_type,
             "price":bidask,"deviation":20}
    return request,None,marker,info,False

def execute(mt5,db,link,task,account,*,now_ms=None):
    now_ms=now_ms or int(time.time()*1000)
    if not _identity(task):
        return receipt("rejected","invalid_task_identity")
    if not consent(db,link):
        return receipt("rejected","local_demo_execution_not_consented")
    existing=db.execute("SELECT status,result FROM copy_local_tasks WHERE task_id=? AND link=?",
                        (task["id"],link)).fetchone()
    if existing:
        # Broker orders are never replayed because a server reply was lost.
        return json.loads(existing[1]) if existing[1] else receipt("unknown","previous_broker_attempt_requires_reconciliation")
    if now_ms>int(task.get("expiresAt") or 0) or int(task["expiresAt"])-now_ms>MAX_TASK_AGE_MS:
        return receipt("rejected","expired_or_future_copy_instruction")
    try:
        _validate_demo(mt5,account,mt5.terminal_info())
        request,size,marker,info,pending=_request(mt5,db,link,task,account,now_ms)
        if request["action"] in (mt5.TRADE_ACTION_DEAL,mt5.TRADE_ACTION_PENDING):
            candidates=_fill_candidates(mt5,info,pending)
            if not candidates:
                raise CopyExecutionError("broker_filling_policy_unsupported")
            checked=None
            for filling in candidates:
                request["type_filling"]=filling
                probe=mt5.order_check(request)
                if probe is not None and int(getattr(probe,"retcode",-1))==0:
                    checked=probe
                    break
            if checked is None:
                raise CopyExecutionError("broker_order_precheck_rejected")
            margin=float(getattr(checked,"margin",0) or 0)
            if margin>float(account.margin_free):
                raise CopyExecutionError("insufficient_follower_free_margin")
        else:
            _broker_check(mt5,request)
        # Commit the task identity BEFORE any broker side effect.
        with db:
            db.execute("INSERT INTO copy_local_tasks(task_id,link,status,started_at_ms) VALUES(?,?,'reserved',?)",
                (task["id"],link,now_ms))
        broker=mt5.order_send(request)
        if broker is None:
            result=receipt("unknown","broker_response_missing")
        else:
            retcode=int(getattr(broker,"retcode",-1))
            ticket=str(getattr(broker,"order",0) or 0)
            if retcode not in SUCCESS_RET_CODES:
                result=receipt("rejected","broker_retcode_rejected",retcode=retcode,
                               details={"volume":request.get("volume"),"symbol":request.get("symbol")})
            else:
                if task["action"]=="open_market":
                    ticket=_market_mapping_ticket(mt5,broker,marker,request["symbol"])
                    if ticket is None:
                        result=receipt("unknown","broker_order_accepted_position_mapping_unverified",retcode=retcode)
                    else:
                        result=receipt("applied","broker_confirmed_position",ticket=ticket,retcode=retcode)
                elif task["action"]=="place_pending":
                    orders=mt5.orders_get(ticket=int(ticket)) if ticket and ticket!="0" else None
                    if orders is None or len(orders)!=1:
                        result=receipt("unknown","broker_pending_order_confirmation_unverified",retcode=retcode)
                    else:
                        result=receipt("applied","broker_confirmed_pending",ticket=ticket,retcode=retcode)
                else:
                    result=receipt("applied","broker_order_response_accepted",ticket=ticket if ticket!="0" else None,retcode=retcode)
                if size is not None:
                    result["details"].update(size)
        with db:
            db.execute("UPDATE copy_local_tasks SET status=?,result=? WHERE task_id=? AND link=?",
                (result["status"],json.dumps(result,sort_keys=True),task["id"],link))
            if result["status"]=="applied" and task["action"] in ("open_market","place_pending"):
                payload=task["payload"]
                db.execute("""INSERT INTO copy_local_mappings(link,source_key,ticket,kind,source_volume,follower_volume,updated_at_ms)
                    VALUES(?,?,?,?,?,?,?) ON CONFLICT(link,source_key) DO UPDATE SET
                    ticket=excluded.ticket,kind=excluded.kind,source_volume=excluded.source_volume,
                    follower_volume=excluded.follower_volume,updated_at_ms=excluded.updated_at_ms""",
                    (link,task["sourceKey"],result["brokerTicket"],
                     "position" if task["action"]=="open_market" else "pending",
                     float(payload["sourceVolume"]),float(request["volume"]),now_ms))
        return result
    except (CopyExecutionError,CopyRiskError,ValueError,TypeError,KeyError,OverflowError) as error:
        # Do not send passwords, broker comments, paths or raw exception detail.
        code=error.code if hasattr(error,"code") else "execution_preflight_rejected"
        result=receipt("rejected",code)
        with db:
            db.execute("""INSERT OR IGNORE INTO copy_local_tasks(task_id,link,status,result,started_at_ms)
                VALUES(?,?,'rejected',?,?)""",(task["id"],link,json.dumps(result),now_ms))
        return result
    except Exception:
        # If an unexpected exception occurs AFTER broker submission, status
        # 'reserved' persists so no subsequent retry can duplicate an order.
        return receipt("unknown","broker_outcome_ambiguous_manual_review")
