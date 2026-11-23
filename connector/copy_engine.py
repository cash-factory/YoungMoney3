"""YoungMoney3 opt-in MT5 COPY EXECUTION KERNEL.

This module is deliberately NOT imported or invoked by the read-only capture
process. It can only run within a separately approved execution service.
The account, demo mode, destination symbol, lot step, stop risk and margin are
validated immediately before placing an order. No invisible fallback sizing.

No guarantee is implied about cross-broker quotes, timing, execution or P/L.
A network timeout AFTER order_send is an unknown outcome: never blind-retry.
"""
from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_FLOOR
from typing import Any

PENDING_TYPES = {
    "buy_limit": "ORDER_TYPE_BUY_LIMIT",
    "sell_limit": "ORDER_TYPE_SELL_LIMIT",
    "buy_stop": "ORDER_TYPE_BUY_STOP",
    "sell_stop": "ORDER_TYPE_SELL_STOP",
    "buy_stop_limit": "ORDER_TYPE_BUY_STOP_LIMIT",
    "sell_stop_limit": "ORDER_TYPE_SELL_STOP_LIMIT",
}
DIRECTIONS = {"buy": "ORDER_TYPE_BUY", "sell": "ORDER_TYPE_SELL"}
VALID_KINDS = set(PENDING_TYPES) | set(DIRECTIONS)
RISK_MODES = {"equity_percentage", "balance_percentage", "fixed_amount", "balance_ratio", "lot_multiplier"}
MAX_FOLLOWERS = 20

class CopyRejected(ValueError):
    """Invalid or unproved execution condition; never send broker orders."""

def dec(v: Any) -> Decimal:
    if isinstance(v, bool):
        raise CopyRejected("Boolean amounts cannot be interpreted as trading values.")
    try:
        d=Decimal(str(v))
        if not d.is_finite():
            raise CopyRejected("Amounts must be finite.")
        return d
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise CopyRejected("Invalid decimal amount.") from exc

def positive(value: Any, label: str) -> Decimal:
    d=dec(value)
    if d <= 0:
        raise CopyRejected(label+" must be positive.")
    return d

@dataclass(frozen=True)
class RiskPolicy:
    mode: str
    value: Decimal
    max_lots: Decimal
    max_risk_pct: Decimal
    max_margin_pct: Decimal = Decimal("35")

    @classmethod
    def from_json(cls, payload: dict):
        mode=payload.get("mode")
        if mode not in RISK_MODES:
            raise CopyRejected("Unsupported follower sizing mode.")
        value=positive(payload.get("value"),"Risk setting")
        if mode in ("equity_percentage","balance_percentage") and value>10:
            raise CopyRejected("Per-order risk percentage must be at most 10%.")
        if mode=="lot_multiplier" and value>5:
            raise CopyRejected("Copy multiplier exceeds the limit.")
        if mode=="balance_ratio" and value>5:
            raise CopyRejected("Balance ratio scaling exceeds the limit.")
        max_lots=positive(payload.get("max_lots"),"Maximum lots")
        if max_lots>50:
            raise CopyRejected("Maximum follower size exceeds 50 lots.")
        max_risk_pct=positive(payload.get("max_risk_pct",5),"Maximum order risk percent")
        max_margin_pct=positive(payload.get("max_margin_pct",35),"Maximum margin percent")
        if max_risk_pct>10 or max_margin_pct>50:
            raise CopyRejected("Risk or margin policy is outside the allowed range.")
        return cls(mode,value,max_lots,max_risk_pct,max_margin_pct)

def _order_side(mt5, kind):
    if kind.startswith("buy"):
        return mt5.ORDER_TYPE_BUY
    return mt5.ORDER_TYPE_SELL

def _broker_round_down(volume,step,minimum,maximum,cap):
    if any(x<=0 for x in (step,minimum,maximum,cap)):
        raise CopyRejected("Broker volume restrictions are missing or invalid.")
    capped=min(volume,maximum,cap)
    normalized=(capped/step).to_integral_value(rounding=ROUND_FLOOR)*step
    if normalized<minimum:
        raise CopyRejected("Risk setting is smaller than broker minimum trade size; do not round up.")
    # Preserve the broker volume-step precision in API and UI output.
    return normalized.quantize(step)

def _symbol_constraints(mt5, symbol, info, account):
    if not isinstance(symbol,str) or len(symbol)>64 or not symbol or any(x in symbol for x in "\r\n\0"):
        raise CopyRejected("Invalid destination symbol.")
    if info is None:
        raise CopyRejected("Destination symbol not available on this broker.")
    if not getattr(account,"trade_allowed",False) or not getattr(account,"trade_expert",False):
        raise CopyRejected("Broker account or external trading permission is disabled.")
    if getattr(account,"trade_mode",None)!=mt5.ACCOUNT_TRADE_MODE_DEMO:
        raise CopyRejected("Only verified demo accounts are permitted in this release.")
    for name in ("volume_min","volume_max","volume_step"):
        positive(getattr(info,name,None),name)
    if getattr(info,"trade_mode",None)==getattr(mt5,"SYMBOL_TRADE_MODE_DISABLED",-1):
        raise CopyRejected("Destination symbol is not tradable.")
    return True

def plan_follower(mt5, *, account, symbol, kind, entry, sl, tp, policy,
                  source_lots=None, source_equity=None, source_balance=None,
                  stoplimit=None):
    """Calculate a provably valid broker-specific copy lot size.

    Uses the follower's order_calc_profit (account currency) rather than pip
    heuristics. The per-lot loss at the stop must be negative. Cross-currency
    accounts are supported by local broker conversion in order_calc_profit.
    """
    if kind not in VALID_KINDS:
        raise CopyRejected("Unsupported market or pending order type.")
    info=mt5.symbol_info(symbol)
    _symbol_constraints(mt5,symbol,info,account)
    entry=positive(entry,"Execution or trigger price")
    sl=positive(sl,"Protective stop price")
    if tp is not None:
        tp=positive(tp,"Take-profit price")
    if kind in ("buy","buy_limit","buy_stop","buy_stop_limit") and sl>=entry:
        raise CopyRejected("Long stop must be below the order entry.")
    if kind.startswith("sell") and sl<=entry:
        raise CopyRejected("Short stop must be above the order entry.")
    if kind in ("buy_stop_limit","sell_stop_limit") and stoplimit is None:
        raise CopyRejected("Stop-limit trigger and limit prices are both required.")
    if kind not in ("buy_stop_limit","sell_stop_limit") and stoplimit is not None:
        raise CopyRejected("Stop-limit prices are only valid for stop-limit orders.")
    side=_order_side(mt5,kind)
    calculated=mt5.order_calc_profit(side,symbol,1.0,float(entry),float(sl))
    if calculated is None or not isinstance(calculated,(float,int)) or not dec(calculated)<0:
        raise CopyRejected("Broker cannot prove a positive monetary loss at stop for one lot.")
    loss_per_lot=abs(dec(calculated))
    equity=positive(getattr(account,"equity",None),"Follower equity")
    balance=positive(getattr(account,"balance",None),"Follower balance")
    if policy.mode=="equity_percentage":
        target=equity*policy.value/100
        theoretical=target/loss_per_lot
    elif policy.mode=="balance_percentage":
        target=balance*policy.value/100
        theoretical=target/loss_per_lot
    elif policy.mode=="fixed_amount":
        target=policy.value
        theoretical=target/loss_per_lot
    elif policy.mode=="balance_ratio":
        theoretical=positive(source_lots,"Source lots")*(balance/positive(source_balance,"Source balance"))*policy.value
        target=theoretical*loss_per_lot
    else:
        theoretical=positive(source_lots,"Source lots")*policy.value
        target=theoretical*loss_per_lot
    if target>equity*policy.max_risk_pct/100:
        theoretical=min(theoretical,equity*policy.max_risk_pct/100/loss_per_lot)
    lot=_broker_round_down(theoretical,dec(info.volume_step),dec(info.volume_min),
                           dec(info.volume_max),policy.max_lots)
    real_loss=loss_per_lot*lot
    if real_loss>equity*policy.max_risk_pct/100:
        raise CopyRejected("Calculated stop risk exceeds maximum follower exposure.")
    margin=mt5.order_calc_margin(side,symbol,float(lot),float(entry))
    if margin is None or dec(margin)<0:
        raise CopyRejected("Broker margin calculation unavailable; no order can be placed.")
    margin=dec(margin)
    free_margin=dec(getattr(account,"margin_free",None))
    if margin>free_margin or margin>equity*policy.max_margin_pct/100:
        raise CopyRejected("Order would exceed free-margin or configured margin budget.")
    return {
        "symbol":symbol,"kind":kind,"entry":str(entry),"sl":str(sl),
        "tp":str(tp) if tp is not None else None,
        "stoplimit":str(positive(stoplimit,"Stop-limit price")) if stoplimit is not None else None,
        "lots":str(lot),"target_risk":str(target),"estimated_loss_at_sl":str(real_loss),
        "estimated_profit_at_tp":str(dec(mt5.order_calc_profit(side,symbol,float(lot),float(entry),float(tp))))
          if tp is not None else None,
        "estimated_margin":str(margin),"margin_free":str(free_margin),
        "risk_pct_equity":str(real_loss/equity*100),
        "account_currency":str(getattr(account,"currency","")),
        "source_equity":str(source_equity) if source_equity is not None else None,
        "constraints":{
            "lot_min":str(info.volume_min),"lot_max":str(info.volume_max),
            "lot_step":str(info.volume_step),"maximum_policy_lots":str(policy.max_lots),
            "risk_limit_pct":str(policy.max_risk_pct),"margin_limit_pct":str(policy.max_margin_pct),
        },
        "broker_quote_validated":False,"margin_calculated":True,
        "execution_enabled":False,
        "warnings":["Stop execution may slip; estimated loss is not a guaranteed maximum.",
                    "Broker bid/ask, stop distances, filling policy, pending-order expiration and margin must be rechecked before sending."],
    }

def follower_routes(accounts, source, follower_ids):
    """Explicit one-to-many owner account mapping, never arbitrary broker discovery."""
    if not isinstance(follower_ids,list) or not 1<=len(follower_ids)<=MAX_FOLLOWERS:
        raise CopyRejected("Copy group needs 1 to 20 follower accounts.")
    if len(set(follower_ids))!=len(follower_ids) or source in follower_ids:
        raise CopyRejected("Duplicate or source-to-self follower route.")
    if source not in accounts:
        raise CopyRejected("Source account is not owned or connected.")
    for link in follower_ids:
        account=accounts.get(link)
        if account is None or not account.get("owned",False) or account.get("status")!="connected":
            raise CopyRejected("Every follower must be an explicitly owned connected account.")
        if account.get("trade_mode")!=0:
            raise CopyRejected("Only demo followers are permitted.")
    return tuple(follower_ids)
