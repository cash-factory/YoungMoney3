"""Isolated, explicitly authorized DEMO order execution.

Not imported from capture, not exposed to the website and not auto-started.
The first production milestone is to verify MT5 exact order semantics in demo.
Never retry an ambiguous order_send result without reconciling broker history.
"""
from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from copy_engine import CopyRejected, DIRECTIONS, PENDING_TYPES, plan_follower

@dataclass(frozen=True)
class ExecutionGrant:
    owner_id:str
    source_link:str
    follower_link:str
    follower_login:int
    follower_server:str
    event_id:str
    demo_only:bool
    locally_armed:bool

def validate_grant(mt5, account, terminal, grant, *, expected_slot, actual_slot):
    if not grant.locally_armed or not grant.demo_only:
        raise CopyRejected("Copy engine is locally disabled; a separate explicit grant is required.")
    if grant.source_link==grant.follower_link or not grant.event_id:
        raise CopyRejected("Self-copying and missing idempotency identifiers are forbidden.")
    if actual_slot!=expected_slot or not getattr(terminal,"connected",False):
        raise CopyRejected("Target terminal or broker network is not verified.")
    if account.login!=grant.follower_login or account.server.casefold()!=grant.follower_server.casefold():
        raise CopyRejected("Follower account switched after authorization.")
    if account.trade_mode!=mt5.ACCOUNT_TRADE_MODE_DEMO:
        raise CopyRejected("Live account execution is not permitted.")
    if not getattr(account,"trade_allowed",False) or not getattr(account,"trade_expert",False):
        raise CopyRejected("MT5 account does not authorize external algorithmic orders.")
    return True

def create_request(mt5,plan,*,expiration=None,deviation=15,magic=740051):
    """Build an explicit broker order request after a successful risk preview."""
    kind=plan["kind"]
    if kind not in DIRECTIONS and kind not in PENDING_TYPES:
        raise CopyRejected("Unsupported order type.")
    if not isinstance(deviation,int) or not 0<=deviation<=50:
        raise CopyRejected("Invalid deviation tolerance.")
    if not isinstance(magic,int) or not 1<=magic<=2147483647:
        raise CopyRejected("Invalid copy strategy identifier.")
    pending=kind in PENDING_TYPES
    type_name=(PENDING_TYPES if pending else DIRECTIONS)[kind]
    request={
        "action":mt5.TRADE_ACTION_PENDING if pending else mt5.TRADE_ACTION_DEAL,
        "symbol":plan["symbol"],
        "volume":float(plan["lots"]),
        "type":getattr(mt5,type_name),
        "price":float(plan["entry"]),
        "sl":float(plan["sl"]),
        "tp":float(plan["tp"]) if plan["tp"] is not None else 0.0,
        "deviation":deviation,
        "magic":magic,
        "comment":"YM3C approved demo",
    }
    if pending:
        request["type_time"]=mt5.ORDER_TIME_GTC if expiration is None else mt5.ORDER_TIME_SPECIFIED
        if expiration is not None:
            request["expiration"]=int(expiration)
        if plan["stoplimit"] is not None:
            request["stoplimit"]=float(plan["stoplimit"])
    else:
        # Broker-specific filling mode is determined by an execution adapter
        # in a subsequent broker-aware order_check preflight.
        request["type_time"]=mt5.ORDER_TIME_GTC
    return request

def guard_broker_preflight(mt5,request, account, *, now_ms, event_created_ms, max_age_ms=3000):
    if now_ms-event_created_ms>max_age_ms or event_created_ms>now_ms+500:
        raise CopyRejected("This copy instruction is stale, do not chase execution.")
    check=mt5.order_check(request)
    if check is None:
        raise CopyRejected("Broker preflight returned no response.")
    # MT5 OrderCheck uses 0 for success; some brokers return explanatory
    # check warnings. Require the precise zero-success indicator.
    if getattr(check,"retcode",None)!=0:
        raise CopyRejected("Broker rejected demo order preflight.")
    return check

def execute_demo_once(mt5,*,grant,expected_slot,actual_slot,account,terminal,
                      planned,now_ms,event_created_ms,ledger):
    """Only an explicit, locally armed execution worker may call this function.

    Ledger interface: claim(event_id)->bool, finalize(event_id,status,receipt).
    claim() must durably acquire a unique local event key *before* transmission.
    If the connection breaks after transmission, status stays UNKNOWN and
    reconciliation must inspect account orders/deals, never resubmit blindly.
    """
    validate_grant(mt5,account,terminal,grant,
                   expected_slot=expected_slot,actual_slot=actual_slot)
    request=create_request(mt5,planned)
    guard_broker_preflight(mt5,request,account,
                           now_ms=now_ms,event_created_ms=event_created_ms)
    if not ledger.claim(grant.event_id):
        raise CopyRejected("Duplicate or ambiguous event; broker reconciliation required.")
    try:
        receipt=mt5.order_send(request)
    except Exception:
        ledger.finalize(grant.event_id,"unknown",None)
        raise CopyRejected("Broker send outcome unknown; do not retry until reconciliation.")
    if receipt is None:
        ledger.finalize(grant.event_id,"unknown",None)
        raise CopyRejected("Broker send outcome unknown; do not retry until reconciliation.")
    retcode=getattr(receipt,"retcode",None)
    if retcode in (mt5.TRADE_RETCODE_DONE,getattr(mt5,"TRADE_RETCODE_PLACED",-1)):
        ledger.finalize(grant.event_id,"acknowledged",{"retcode":int(retcode),
            "order":str(getattr(receipt,"order",0)),
            "deal":str(getattr(receipt,"deal",0))})
        return {"accepted":True,"retcode":int(retcode),"order":str(getattr(receipt,"order",0)),
                "deal":str(getattr(receipt,"deal",0))}
    # A reject response may still race a broker fill. Reconciliation is safer.
    ledger.finalize(grant.event_id,"broker_response",{"retcode":str(retcode)})
    return {"accepted":False,"retcode":retcode}

def _bound_ticket(value):
    if isinstance(value,bool) or not str(value).isdecimal() or not (0<int(value)<2**64):
        raise CopyRejected("Invalid broker ticket.")
    return int(value)

def build_lifecycle_request(mt5,kind,*,symbol,ticket,sl=None,tp=None,
                             price=None,stoplimit=None,expiration=None):
    """Explicit pending and protective-order state transitions.
    Every returned command requires owner mapping + broker presence checks
    and cannot be sent from read-only capture.
    """
    broker_ticket=_bound_ticket(ticket)
    if kind=="cancel_pending":
        return {"action":mt5.TRADE_ACTION_REMOVE,"order":broker_ticket}
    if kind=="adjust_protection":
        if sl is None or tp is None:
            raise CopyRejected("Both resulting SL and TP must be supplied; omitting one could silently remove the existing level.")
        return {"action":mt5.TRADE_ACTION_SLTP,"symbol":symbol,"position":broker_ticket,
                "sl":float(sl) if sl is not None else 0.0,
                "tp":float(tp) if tp is not None else 0.0}
    if kind=="modify_pending":
        if price is None or Decimal(str(price))<=0:
            raise CopyRejected("Pending modification needs a positive trigger price.")
        request={"action":mt5.TRADE_ACTION_MODIFY,"order":broker_ticket,
                 "price":float(price)}
        if sl is not None:request["sl"]=float(sl)
        if tp is not None:request["tp"]=float(tp)
        if stoplimit is not None:request["stoplimit"]=float(stoplimit)
        if expiration is not None:request["expiration"]=int(expiration)
        return request
    raise CopyRejected("Unsupported pending-order transition.")
