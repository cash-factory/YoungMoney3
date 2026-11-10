"""Immutable MT5 execution snapshots and decimal-derived position metrics."""
from decimal import Decimal
import json

ZERO = Decimal(0)


def number(value):
    return Decimal(str(value or 0))


def text(value):
    return format(value, "f") if value is not None else None


def instrument_snapshot(symbol):
    """Broker symbols determine units; CFD names never establish a forex pip size."""
    if not symbol:
        return {"movement_unit": "points", "pip_size": None}
    fields = ("name", "digits", "point", "trade_tick_size", "trade_tick_value",
              "trade_contract_size", "trade_calc_mode", "currency_base", "currency_profit",
              "currency_margin", "volume_min", "volume_max", "volume_step")
    snapshot = {key: symbol.get(key) for key in fields}
    base, quote = symbol.get("currency_base", ""), symbol.get("currency_profit", "")
    forex = symbol.get("trade_calc_mode") in (0, 5) and len(base) == len(quote) == 3
    snapshot["pip_size"] = "0.01" if forex and quote == "JPY" else "0.0001" if forex else None
    snapshot["movement_unit"] = "pips" if forex else "ticks" if symbol.get("trade_tick_size") else "points"
    return snapshot


def ensure_capture_schema(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS entry_risk(
            link TEXT, deal TEXT, payload TEXT NOT NULL, PRIMARY KEY(link,deal)
        );
        CREATE TABLE IF NOT EXISTS execution_stops(
            link TEXT, position TEXT, observed INTEGER, payload TEXT NOT NULL,
            PRIMARY KEY(link,position,observed)
        );
    """)


def risk_snapshot(entry, order, current_position, observed_ms, instrument, currency,
                  calculate_profit, historical=False, capital=None):
    """Freeze the first nonzero stop; a later stop cannot replace an invalid initial risk."""
    opening_sl = order.get("sl")
    observed_sl = current_position.get("sl") if current_position else None
    first_sl = opening_sl or observed_sl
    if not first_sl:
        return None
    at_entry = bool(opening_sl)
    entry_price = number(entry["price"])
    sl = number(first_sl)
    direction = "long" if entry["type"] == 0 else "short"
    distance = entry_price - sl if direction == "long" else sl - entry_price
    tp = order.get("tp") or (current_position.get("tp") if current_position else None)
    risk = reward = None
    if distance > 0:
        result = calculate_profit(entry["type"], entry["symbol"], 1.0, float(entry_price), float(sl))
        if result is not None and number(result).is_finite() and number(result) < 0:
            risk = -number(result)
        if tp:
            result = calculate_profit(entry["type"], entry["symbol"], 1.0, float(entry_price), float(tp))
            if result is not None and number(result).is_finite():
                reward = number(result)
    return {
        "first_sl": float(sl), "first_tp": tp or None,
        "first_sl_source": "opening_order" if at_entry else "first_observed",
        "first_sl_at_ms": entry["time_msc"] if at_entry else observed_ms,
        "delayed_sl": not at_entry, "risk_distance": text(distance) if distance > 0 else None,
        "risk_per_lot": text(risk), "planned_reward_per_lot": text(reward),
        "account_currency": currency, "capital_at_entry": capital,
        "monetary_source": "current_contract_estimate" if historical else "broker_calculation_at_capture",
        "instrument": instrument, "captured_at_ms": observed_ms,
        "risk_unavailable_reason": None if risk is not None else "non_protective_first_stop" if distance <= 0 else "broker_calculation_unavailable",
    }


def capture_entry_risks(db, link, deals, orders, positions, observed_ms, start_ms,
                        symbol_lookup, calculate_profit, currency, capital):
    """Write-once snapshots are committed before their corresponding upload is queued."""
    # Only the current lifecycle may inherit a presently observed stop. A prior
    # closed cycle using the same netting position identifier has separate risk.
    from ledger import position_lifecycles
    active=set()
    for lifecycle in position_lifecycles(deals):
        if lifecycle["fields"]["status"]=="open":
            active.update(fill["ticket"] for fill in lifecycle["fields"]["execution_metrics"]["entries"]
                          if number(fill["remaining"])>0)
    for entry in deals:
        if entry.get("type") not in (0, 1) or entry.get("entry") not in (0, 2):
            continue
        ticket = str(entry["ticket"])
        if db.execute("SELECT 1 FROM entry_risk WHERE link=? AND deal=?", (link, ticket)).fetchone():
            continue
        position = positions.get(str(entry["position_id"])) if ticket in active else None
        order = orders.get(entry.get("order"), {})
        snapshot = risk_snapshot(entry, order, position, observed_ms,
                                 instrument_snapshot(symbol_lookup(entry["symbol"])), currency,
                                 calculate_profit, historical=entry["time_msc"] < start_ms,
                                 capital=capital if entry["time_msc"] >= start_ms and observed_ms-entry["time_msc"] < 10000 else None)
        if snapshot:
            db.execute("INSERT OR IGNORE INTO entry_risk VALUES(?,?,?)", (link, ticket, json.dumps(snapshot)))


def stored_risks(db, link):
    return {ticket: json.loads(payload) for ticket, payload in db.execute("SELECT deal,payload FROM entry_risk WHERE link=?", (link,))}


def observe_stops(db, link, position, observed_ms):
    pid = str(position["identifier"])
    payload = {"observed_at_ms": observed_ms, "sl": position.get("sl") or None, "tp": position.get("tp") or None}
    previous = db.execute("SELECT payload FROM execution_stops WHERE link=? AND position=? ORDER BY observed DESC LIMIT 1", (link, pid)).fetchone()
    if previous:
        old = json.loads(previous[0])
        if old["sl"] == payload["sl"] and old["tp"] == payload["tp"]:
            return
    db.execute("INSERT OR IGNORE INTO execution_stops VALUES(?,?,?,?)", (link, pid, observed_ms, json.dumps(payload)))


def add_current_exposure(event, position, calculate_profit):
    """Current stop exposure uses remaining entries without changing their initial risk."""
    fields = event["fields"]
    metrics = fields["execution_metrics"]
    metrics["current_risk"] = None
    if fields["status"] == "closed":
        metrics["current_risk"] = "0"
        return
    if not position or not position.get("sl"):
        return
    total = ZERO
    direction = 0 if fields["direction"] == "long" else 1
    for entry in metrics["entries"]:
        remaining = number(entry["remaining"])
        if remaining <= 0:
            continue
        result = calculate_profit(direction, fields["pair"], float(remaining),
                                  float(entry["price"]), position["sl"])
        if result is None or not number(result).is_finite():
            return
        total += max(ZERO, -number(result))
    metrics["current_risk"] = text(total)
