"""Project broker deal history into journal legs using decimal arithmetic."""
from decimal import Decimal
from datetime import datetime, timezone

ZERO = Decimal(0)

def dec(value):
    return Decimal(str(value or 0))

def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec="milliseconds")

def closed_legs(deals, start_ms, orders=None):
    """Replay the position history for cost basis; emit exits from linking onward."""
    orders = orders or {}
    quantity = basis = costs = ZERO
    entry_ms = None
    for d in sorted(deals, key=lambda x: (x["time_msc"], int(x["ticket"]))):
        if d["type"] not in (0, 1):
            continue
        volume = dec(d["volume"])
        if volume <= 0:
            continue
        change = volume if d["type"] == 0 else -volume
        price = dec(d["price"])
        charges = dec(d["commission"]) + dec(d["fee"])
        closed = min(abs(quantity), volume) if quantity * change < 0 else ZERO
        if closed:
            fraction = closed / volume
            prior_costs = costs * closed / abs(quantity)
            costs -= prior_costs
            exit_costs = charges * fraction
            net = dec(d["profit"]) + dec(d["swap"]) + exit_costs + prior_costs
            if d["time_msc"] >= start_ms:
                closing_order=orders.get(d.get("order"),{})
                yield {"kind":"trade","key":"close-"+str(d["ticket"]), "fields":{
                    "pair":d["symbol"], "direction":"long" if quantity>0 else "short",
                    "status":"closed","entry_time":iso(entry_ms), "exit_time":iso(d["time_msc"]),
                    "stop_loss":closing_order.get("sl") or None,"take_profit":closing_order.get("tp") or None,
                    "entry_price":float(basis),"exit_price":float(price),"lot_size":float(closed),
                    "fees":float(-exit_costs-prior_costs), "pnl":float(net),
                    "broker_details":{"deal_ticket":str(d["ticket"]), "position_id":str(d["position_id"]),
                                      "gross_profit":str(d["profit"]), "swap":str(d["swap"]),
                                      "net":str(net),"entry_charges":str(prior_costs),"exit_charges":str(exit_costs)}}}
            quantity += closed if quantity < 0 else -closed
        remaining = volume - closed
        if remaining:
            if not quantity:
                entry_ms = d["time_msc"]
                basis = costs = ZERO
            basis = (abs(quantity)*basis + remaining*price)/(abs(quantity)+remaining)
            quantity += remaining if change>0 else -remaining
            # Opening balance already includes charges incurred before linking.
            if d["time_msc"] >= start_ms:
                costs += charges * remaining / volume
