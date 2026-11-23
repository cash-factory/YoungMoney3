"""MT5 follower sizing: account-currency risk from broker order_calc_profit.

No guessed pip values or implicit FX conversion. A sizing failure is a hard
rejection, not permission to trade a broker's minimum lot. Used immediately
before each DEMO order_send, not just by a browser simulation.
"""
from decimal import Decimal, ROUND_FLOOR, InvalidOperation

class CopyRiskError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code=code

def D(value):
    try:
        d=Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise CopyRiskError("invalid_numeric_value") from None
    if not d.is_finite():
        raise CopyRiskError("invalid_numeric_value")
    return d

def protective(direction, entry, stop):
    entry,stop=D(entry),D(stop)
    if entry<=0 or stop<=0:
        raise CopyRiskError("positive_entry_and_stop_required")
    if direction=="buy" and stop>=entry:
        raise CopyRiskError("stop_not_below_buy_entry")
    if direction=="sell" and stop<=entry:
        raise CopyRiskError("stop_not_above_sell_entry")
    if direction not in ("buy","sell"):
        raise CopyRiskError("invalid_direction")

def floor_volume(desired, minimum, maximum, step, cap):
    desired,minimum,maximum,step,cap=map(D,(desired,minimum,maximum,step,cap))
    if min(desired,minimum,maximum,step,cap)<=0 or maximum<minimum:
        raise CopyRiskError("invalid_broker_volume_specification")
    ceiling=min(desired,maximum,cap)
    # MT5 volume_step follows the venue's volume grid, which is typically zero
    # anchored. A venue min volume must not force increasing the budget.
    lots=(ceiling/step).to_integral_value(rounding=ROUND_FLOOR)*step
    if lots<minimum:
        raise CopyRiskError("risk_budget_below_broker_minimum")
    return lots

def calculate(mt5, account, instrument, *, direction, entry, stop,
              source_lots, source_equity, source_currency,
              sizing_mode, sizing_value, max_lots):
    protective(direction,entry,stop)
    info=mt5.symbol_info(instrument)
    if info is None:
        raise CopyRiskError("unknown_follower_instrument")
    if not mt5.symbol_select(instrument,True):
        raise CopyRiskError("instrument_not_selectable")
    equity=D(account.equity)
    if equity<=0:
        raise CopyRiskError("unavailable_account_equity")
    value=D(sizing_value)
    if value<=0:
        raise CopyRiskError("invalid_sizing_value")
    side=mt5.ORDER_TYPE_BUY if direction=="buy" else mt5.ORDER_TYPE_SELL
    # A 1-lot hypothetical loss uses MetaTrader's symbol contract specs and
    # the FOLLOWER account's currency conversion, not pip-value assumptions.
    loss=mt5.order_calc_profit(side,instrument,1.0,float(entry),float(stop))
    if loss is None or D(loss)>=0:
        raise CopyRiskError("broker_stop_loss_valuation_unavailable")
    loss_per_lot=-D(loss)
    if sizing_mode=="risk_pct_equity":
        if value>10:
            raise CopyRiskError("risk_percent_above_policy")
        budget=equity*value/100
        raw=budget/loss_per_lot
    elif sizing_mode=="fixed_risk":
        if value>equity*D("0.10"):
            raise CopyRiskError("fixed_risk_above_ten_percent_equity")
        budget=value
        raw=budget/loss_per_lot
    elif sizing_mode=="equity_ratio":
        if str(account.currency)!=str(source_currency):
            raise CopyRiskError("cross_currency_ratio_requires_verified_conversion")
        base=D(source_equity)
        if base<=0:
            raise CopyRiskError("invalid_source_equity")
        raw=D(source_lots)*equity/base*value
        budget=raw*loss_per_lot
    elif sizing_mode=="lot_multiplier":
        raw=D(source_lots)*value
        budget=raw*loss_per_lot
    else:
        raise CopyRiskError("unsupported_sizing_mode")
    lots=floor_volume(raw,info.volume_min,info.volume_max,info.volume_step,max_lots)
    risk=loss_per_lot*lots
    if risk>equity*D("0.10"):
        raise CopyRiskError("per_order_risk_exceeds_ten_percent_equity")
    if sizing_mode in ("risk_pct_equity","fixed_risk") and risk>budget:
        raise CopyRiskError("rounded_lots_exceed_risk_budget")
    return {"lots":float(lots),"risk_amount":float(risk),
            "risk_pct_equity":float(risk/equity*100),
            "target_budget":float(budget),
            "account_currency":str(account.currency),
            "loss_per_lot":float(loss_per_lot),
            "uncapped_lots":float(raw),
            "capped":lots<raw,
            "broker_validated":True}
