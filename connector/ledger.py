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
    entry_order = {}
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
                    "stop_loss":closing_order.get("sl") or entry_order.get("sl") or None,"take_profit":closing_order.get("tp") or entry_order.get("tp") or None,
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
                entry_order = orders.get(d.get("order"),{})
                basis = costs = ZERO
            basis = (abs(quantity)*basis + remaining*price)/(abs(quantity)+remaining)
            quantity += remaining if change>0 else -remaining
            # Opening balance already includes charges incurred before linking.
            if d["time_msc"] >= start_ms:
                costs += charges * remaining / volume

def position_lifecycles(deals, orders=None, risks=None, instrument=None, observations=None,
                        current_position=None, time_quality="inferred_offset"):
    """Replay fills into one position lifecycle, splitting a netting reversal at zero."""
    from metrics import text
    orders, risks = orders or {}, risks or {}
    instrument, observations = instrument or {}, observations or []
    cycle = None

    def begin(d, direction):
        return {"id": str(d["ticket"]), "pid": str(d["position_id"]), "symbol": d["symbol"],
                "direction": direction, "entries": [], "exits": [], "source_ids": [],
                "quantity": ZERO, "entered": ZERO, "closed": ZERO, "entry_value": ZERO,
                "exit_value": ZERO, "net": ZERO, "gross": ZERO, "swap": ZERO, "charges": ZERO,
                "weighted_seconds": ZERO, "movement": ZERO, "closed_risk": ZERO,
                "risk_complete": True, "first": d["time_msc"], "last": None}

    def finish(c):
        entries, exits = c["entries"], c["exits"]
        known = [e for e in entries if e["risk"] and e["risk"].get("risk_per_lot") is not None]
        initial_risk = sum((dec(e["risk"]["risk_per_lot"]) * e["volume"] for e in known), ZERO) if len(known) == len(entries) else None
        rewards = [e for e in entries if e["risk"] and e["risk"].get("planned_reward_per_lot") is not None]
        planned = sum((dec(e["risk"]["planned_reward_per_lot"]) * e["volume"] for e in rewards), ZERO) if len(rewards) == len(entries) else None
        closed_risk = c["closed_risk"] if c["risk_complete"] else None
        first_risk = entries[0]["risk"] if entries else None
        complete = c["quantity"] == ZERO
        unit = instrument.get("movement_unit", "points")
        step = dec(instrument.get("pip_size") if unit == "pips" else instrument.get("trade_tick_size") if unit == "ticks" else 1)
        movement = c["movement"] / c["closed"] if c["closed"] else None
        units = movement / step if movement is not None and step > 0 else None
        final_ms = c["last"] if complete else None
        closed_ids = [e["deal_ticket"] for e in exits]
        fills = []
        for kind, values in (("entry", entries), ("exit", exits)):
            for fill in values:
                fills.append({**{k: text(v) if isinstance(v, Decimal) else v for k, v in fill.items() if k != "risk"}, "kind": kind,
                              **({"risk_snapshot": fill["risk"]} if kind == "entry" else {})})
        for fill in fills:
            fill["ticket"]=fill["deal_ticket"]
            if fill["kind"]=="entry":
                risk=fill.get("risk_snapshot") or {}
                fill.update({"first_sl":risk.get("first_sl"), "first_tp":risk.get("first_tp"),
                             "first_sl_at":iso(risk["first_sl_at_ms"]) if risk else None,
                             "first_sl_source":risk.get("first_sl_source"),
                             "initial_risk":text(dec(risk["risk_per_lot"])*dec(fill["volume"])) if risk.get("risk_per_lot") is not None else None,
                             "initial_reward":text(dec(risk["planned_reward_per_lot"])*dec(fill["volume"])) if risk.get("planned_reward_per_lot") is not None else None,
                             "closed_volume":text(dec(fill["volume"])-dec(fill["remaining"]))})
        completeness = []
        if initial_risk is None:
            completeness.append("initial_risk_unknown")
        if time_quality != "confirmed_timezone":
            completeness.append("broker_clock_inferred")
        if any(e["risk"] and e["risk"].get("monetary_source") == "current_contract_estimate" for e in entries):
            completeness.append("historical_contract_estimate")
        metrics = {
            "version": 1, "cycle_id": c["id"], "position_id": c["pid"], "fills": fills,
            "source_deal_ids": list(dict.fromkeys(c["source_ids"])), "source_deal_tickets": list(dict.fromkeys(c["source_ids"])), "closed_deal_ids": closed_ids,
            "entries": [f for f in fills if f["kind"] == "entry"],
            "exits": [{**f, "ticket": f["deal_ticket"], "net_pnl": f["net"]} for f in fills if f["kind"] == "exit"],
            "first_sl": first_risk.get("first_sl") if first_risk else None,
            "first_tp": first_risk.get("first_tp") if first_risk else None,
            "first_sl_source": first_risk.get("first_sl_source") if first_risk else None,
            "first_sl_at": iso(first_risk["first_sl_at_ms"]) if first_risk else None,
            "delayed_sl": first_risk.get("delayed_sl", False) if first_risk else False,
            "initial_risk": text(initial_risk), "closed_risk": text(closed_risk),
            "capital_at_entry": first_risk.get("capital_at_entry") if first_risk else None,
            "current_risk": "0" if complete else None,
            "planned_r": text(planned / initial_risk) if planned is not None and initial_risk and initial_risk > 0 else None,
            "realized_r": text(c["net"] / closed_risk) if closed_risk and closed_risk > 0 else None,
            "realized_net": text(c["net"]), "gross_profit": text(c["gross"]), "swap": text(c["swap"]),
            "fees": text(-c["charges"]), "entered_volume": text(c["entered"]),
            "closed_volume": text(c["closed"]), "remaining_volume": text(abs(c["quantity"])),
            "movement": text(units), "movement_unit": unit, "price_movement": text(movement),
            "pip_size": instrument.get("pip_size"), "instrument": instrument,
            "first_entry_time": iso(c["first"]), "final_exit_time": iso(final_ms) if final_ms else None,
            "duration_seconds": (final_ms - c["first"]) / 1000 if final_ms else None,
            "weighted_duration_seconds": text(c["weighted_seconds"] / c["closed"]) if c["closed"] else None,
            "stop_observations": [o for o in observations if o["observed_at_ms"] >= c["first"] and (final_ms is None or o["observed_at_ms"] <= final_ms)],
            "time_quality": time_quality, "completeness": completeness,
        }
        latest = current_position if not complete else None
        final_order = orders.get(int(exits[-1]["order_ticket"]), {}) if exits and exits[-1].get("order_ticket") else {}
        last_stop = metrics["stop_observations"][-1] if metrics["stop_observations"] else {}
        stop = (latest or {}).get("sl") or final_order.get("sl") or last_stop.get("sl") or metrics["first_sl"]
        target = (latest or {}).get("tp") or final_order.get("tp") or last_stop.get("tp") or metrics["first_tp"]
        pnl = c["net"]
        return {"kind": "lifecycle", "key": "position-" + c["pid"] + "-" + c["id"], "fields": {
            "pair": c["symbol"], "direction": c["direction"], "status": "closed" if complete else "open",
            "entry_time": iso(c["first"]), "exit_time": iso(final_ms) if final_ms else None,
            "entry_price": float(c["entry_value"] / c["entered"]),
            "exit_price": float(c["exit_value"] / c["closed"]) if c["closed"] else None,
            "lot_size": float(c["entered"]), "stop_loss": stop or None, "take_profit": target or None,
            "pnl": float(pnl), "pnl_decimal": text(pnl), "pips": float(units) if unit == "pips" and units is not None else None,
            "fees": float(-c["charges"]), "initial_risk": float(initial_risk) if initial_risk is not None else None,
            "planned_r": float(dec(metrics["planned_r"])) if metrics["planned_r"] is not None else None,
            "realized_r": float(dec(metrics["realized_r"])) if metrics["realized_r"] is not None else None,
            "risk_reward_ratio": float(dec(metrics["realized_r"])) if metrics["realized_r"] is not None else None,
            "risk_capital_at_entry": metrics["capital_at_entry"],
            "risk_percent": float(initial_risk / dec(metrics["capital_at_entry"]) * 100) if initial_risk is not None and metrics["capital_at_entry"] and dec(metrics["capital_at_entry"]) > 0 else None,
            "execution_metrics": metrics,
            "broker_details": {"position_id": c["pid"], "cycle_id": c["id"], "deal_ticket": closed_ids[-1] if closed_ids else None,
                               "gross_profit": text(c["gross"]), "swap": text(c["swap"]), "net": text(c["net"])}}}

    for d in sorted(deals, key=lambda item: (item["time_msc"], int(item["ticket"]))):
        if d.get("type") not in (0, 1) or dec(d.get("volume")) <= 0:
            continue
        volume = dec(d["volume"])
        change = volume if d["type"] == 0 else -volume
        price = dec(d["price"])
        ticket = str(d["ticket"])
        charges = dec(d.get("commission")) + dec(d.get("fee"))
        closed = min(abs(cycle["quantity"]), volume) if cycle and cycle["quantity"] * change < 0 else ZERO
        if closed:
            allocated_risk = ZERO
            allocations, opening_costs = [], ZERO
            old_quantity = abs(cycle["quantity"])
            for entry in cycle["entries"]:
                allocation = entry["remaining"] * closed / old_quantity
                if allocation <= 0:
                    continue
                entry["remaining"] -= allocation
                opening_costs += entry["charges"] * allocation / entry["volume"]
                move = price - entry["price"] if cycle["direction"] == "long" else entry["price"] - price
                cycle["movement"] += move * allocation
                cycle["weighted_seconds"] += dec(d["time_msc"] - entry["time_ms"]) / 1000 * allocation
                risk = entry["risk"]
                risk_known = risk and risk.get("risk_per_lot") is not None and risk["first_sl_at_ms"] <= d["time_msc"]
                if risk_known:
                    allocated_risk += dec(risk["risk_per_lot"]) * allocation
                else:
                    cycle["risk_complete"] = False
                allocations.append({"entry_deal_id": entry["deal_ticket"], "volume": text(allocation),
                                    "initial_risk": text(dec(risk["risk_per_lot"]) * allocation) if risk_known else None})
            exit_charges = charges * closed / volume
            net = dec(d.get("profit")) + dec(d.get("swap")) + exit_charges + opening_costs
            cycle["net"] += net
            cycle["gross"] += dec(d.get("profit"))
            cycle["swap"] += dec(d.get("swap"))
            cycle["charges"] += exit_charges + opening_costs
            cycle["closed_risk"] += allocated_risk
            cycle["closed"] += closed
            cycle["exit_value"] += price * closed
            cycle["last"] = d["time_msc"]
            cycle["source_ids"].append(ticket)
            cycle["exits"].append({"deal_ticket": ticket, "order_ticket": str(d["order"]) if d.get("order") is not None else None, "time": iso(d["time_msc"]),
                                   "time_ms": d["time_msc"], "broker_time_ms": d.get("broker_time_msc"),
                                   "volume": closed, "price": price, "gross_profit": dec(d.get("profit")),
                                   "commission": dec(d.get("commission")) * closed / volume,
                                   "fee": dec(d.get("fee")) * closed / volume, "swap": dec(d.get("swap")),
                                   "net": net, "allocated_risk": allocated_risk, "allocations": allocations,
                                   "reason": d.get("reason"), "comment": d.get("comment"), "magic": str(d.get("magic", 0))})
            cycle["quantity"] += closed if cycle["quantity"] < 0 else -closed
            if cycle["quantity"] == ZERO:
                yield finish(cycle)
                cycle = None
        remaining = volume - closed
        if remaining:
            if cycle is None:
                cycle = begin(d, "long" if change > 0 else "short")
            cycle["quantity"] += remaining if change > 0 else -remaining
            cycle["entered"] += remaining
            cycle["entry_value"] += price * remaining
            cycle["source_ids"].append(ticket)
            cycle["entries"].append({"deal_ticket": ticket, "order_ticket": str(d["order"]) if d.get("order") is not None else None, "time": iso(d["time_msc"]),
                                     "time_ms": d["time_msc"], "broker_time_ms": d.get("broker_time_msc"),
                                     "volume": remaining, "remaining": remaining, "price": price,
                                     "charges": charges * remaining / volume,
                                     "commission": dec(d.get("commission")) * remaining / volume,
                                     "fee": dec(d.get("fee")) * remaining / volume,
                                     "risk": risks.get(ticket), "reason": d.get("reason"), "comment": d.get("comment"), "magic": str(d.get("magic", 0))})
    if cycle:
        yield finish(cycle)
