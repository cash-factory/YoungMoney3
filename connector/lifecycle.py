"""Deterministic MT5 position-lifecycle projection.

Raw broker deals/orders/observations are authoritative. This module is a
derived, versioned calculation contract (v1): NEVER edit the broker evidence.
All financial arithmetic uses Decimal, and unknown data stays None.

A position identifier can contain several lifecycles after netting reversals;
scale-ins remain independent risk tranches inside the current lifecycle.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

CONTRACT_VERSION = 1
ZERO = Decimal("0")
SESSION_ZONES = (
    ("Sydney", "Australia/Sydney", 7, 16),
    ("Tokyo", "Asia/Tokyo", 9, 18),
    ("London", "Europe/London", 8, 17),
    ("New York", "America/New_York", 8, 17),
)


def D(value):
    if value is None or value == "":
        return None
    try:
        result = Decimal(str(value))
    except (ValueError, TypeError, InvalidOperation):
        return None
    return result if result.is_finite() else None


def money(value):
    return str(value) if value is not None else None


def as_iso(ms):
    return datetime.fromtimestamp(int(ms) / 1000, timezone.utc).isoformat(timespec="milliseconds")


def sessions_at(ms):
    """Session windows are defined in each market's own DST-aware timezone."""
    utc = datetime.fromtimestamp(int(ms) / 1000, timezone.utc)
    active = []
    for name, zone, opens, closes in SESSION_ZONES:
        local = utc.astimezone(ZoneInfo(zone))
        if local.weekday() < 5 and opens <= local.hour < closes:
            active.append(name)
    return active


def sessions_crossed(begin, end, confirmed=False, broker_timezone=None,
                     conversion_provenance=None):
    """Never label historical sessions without a verified UTC conversion."""
    if not confirmed or not broker_timezone or conversion_provenance != "confirmed":
        return {"status": "unresolved", "reason": "broker_timezone_or_utc_conversion_unconfirmed",
                "sessions": [], "overlaps": []}
    try:
        ZoneInfo(broker_timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return {"status": "unresolved", "reason": "invalid_broker_timezone",
                "sessions": [], "overlaps": []}
    if end is None:
        return {"status": "unresolved", "reason": "open_position", "sessions": [], "overlaps": []}
    if end < begin:
        return {"status": "unresolved", "reason": "invalid_timestamps", "sessions": [], "overlaps": []}
    # Bounded hourly traversal: avoid suggesting complete coverage of very long
    # holdings where the sampling budget could miss important transitions.
    if end - begin > 90 * 86400000:
        return {"status": "unresolved", "reason": "holding_period_exceeds_session_scan_budget",
                "sessions": [], "overlaps": []}
    names, overlaps = set(), set()
    sample = begin
    while sample <= end:
        active = sessions_at(sample)
        names.update(active)
        if len(active) >= 2:
            overlaps.add(" / ".join(active))
        sample += 30 * 60 * 1000
    active = sessions_at(end)
    names.update(active)
    if len(active) >= 2:
        overlaps.add(" / ".join(active))
    return {"status": "confirmed", "broker_timezone": broker_timezone,
            "conversion_provenance": conversion_provenance,
            "sessions": sorted(names), "overlaps": sorted(overlaps)}


def stop_risk(entry, sl, direction, volume, spec):
    """Account-currency stop risk; None if tick valuation is unavailable."""
    if entry is None or sl is None or volume <= ZERO:
        return None
    if direction == "long" and sl >= entry:
        return None
    if direction == "short" and sl <= entry:
        return None
    tick = D(spec.get("trade_tick_size"))
    value = D(spec.get("trade_tick_value_loss"))
    if value is None:
        value = D(spec.get("trade_tick_value"))
    if not tick or tick <= ZERO or not value or value <= ZERO:
        return None
    return abs(entry - sl) / tick * value * volume


def movement_unit(spec):
    """Symbol specifications, never asset-name heuristics, define movement."""
    if spec.get("is_forex") is True:
        digits = spec.get("digits")
        pip = D(spec.get("pip_size"))
        if pip is None and isinstance(digits, int):
            point = D(spec.get("point"))
            if point and point > ZERO:
                pip = point * (10 if digits in (3, 5) else 1)
        return ("pips", pip) if pip and pip > ZERO else ("unknown", None)
    tick = D(spec.get("trade_tick_size"))
    return ("ticks", tick) if tick and tick > ZERO else ("unknown", None)


def _capital(at, samples):
    """Freeze equity first, with balance fallback and explicit observation."""
    for item in sorted(samples, key=lambda row: int(row.get("at_ms", 0)), reverse=True):
        if int(item.get("at_ms", 0)) > at:
            continue
        equity = D(item.get("equity"))
        balance = D(item.get("balance"))
        if equity is not None and equity > ZERO:
            return {"value": money(equity), "source": "equity", "observed_at": as_iso(item["at_ms"])}
        if balance is not None and balance > ZERO:
            return {"value": money(balance), "source": "balance_fallback", "observed_at": as_iso(item["at_ms"])}
    return {"value": None, "source": "unavailable", "observed_at": None}


def reconstruct(deals, orders, observations, spec, *, capital_samples=(),
                broker_timezone=None, timezone_confirmed=False,
                conversion_provenance=None, observed_at_ms=None):
    """Replay one broker position identifier; return independent lifecycles.

    deals: MT5 deal dicts with ticket, position_id, time_msc, type (0=buy,
    1=sell), entry, order, price, volume, commission, fee, swap, profit.
    orders: mapping keyed by executed opening order ticket.
    observations: dicts with time_msc, sl, tp, position_id and raw provenance.
    Store raw sources separately; these summaries can be recalculated without
    losing original evidence.
    """
    deals = sorted((d for d in deals if d.get("type") in (0, 1)),
                   key=lambda row: (int(row["time_msc"]), int(row.get("ticket", 0))))
    if not deals:
        return []
    position = str(deals[0].get("position_id", ""))
    if not position or any(str(row.get("position_id")) != position for row in deals):
        raise ValueError("Exactly one broker position identifier is required.")
    observations = sorted((o for o in observations if str(o.get("position_id")) == position),
                          key=lambda o: int(o["time_msc"]))
    unit_name, unit_size = movement_unit(spec)
    timeline = []
    current = None
    state = None
    count = 0

    def open_cycle(at, direction):
        nonlocal count
        cycle = {
            "calculation_version": CONTRACT_VERSION, "position_id": position,
            "lifecycle_id": position + ":" + str(count), "lifecycle_index": count,
            "symbol": deals[0].get("symbol"), "direction": direction,
            "first_entry_at": as_iso(at), "final_exit_at": None,
            "open_volume": ZERO, "entry_volume": ZERO, "closed_volume": ZERO,
            "gross_profit": ZERO, "net_profit": ZERO, "costs": ZERO,
            "closed_risk": ZERO, "risk_missing": False,
            "movement_volume": ZERO, "movement_sum": ZERO,
            "weighted_holding_ms": ZERO, "holding_volume": ZERO,
            "entries": [], "exits": [], "tranches": [], "remaining_volume": ZERO,
            "initial_stop": None, "initial_stop_observed_at": None,
            "initial_stop_provenance": "unavailable",
            "current_stop": None, "current_tp": None,
            "capital": _capital(at, capital_samples),
            "unverified_legacy": False,
        }
        count += 1
        return cycle

    def initial_stop(tranche, cutoff=None):
        order = tranche["order"]
        opening = D(order.get("sl"))
        if opening is not None and opening > ZERO:
            tranche["frozen_sl"] = opening
            tranche["stop_provenance"] = "executed_open_order"
            tranche["stop_observed_at"] = as_iso(tranche["time"])
        else:
            # The FIRST observed stop is frozen, even when already beyond BE.
            # Later stops cannot silently repair unknown original risk.
            for obs in observations:
                when = int(obs["time_msc"])
                if when < tranche["time"] or cutoff is not None and when > cutoff:
                    continue
                level = D(obs.get("sl"))
                if level is None or level <= ZERO:
                    continue
                tranche["frozen_sl"] = level
                tranche["stop_provenance"] = "first_observed"
                tranche["stop_observed_at"] = as_iso(when)
                break
        sl = tranche["frozen_sl"]
        tranche["risk"] = stop_risk(tranche["entry"], sl, tranche["direction"], tranche["original_volume"], spec)
        if sl is not None and tranche["risk"] is None:
            tranche["risk_unavailable_reason"] = "non_protective_or_missing_tick_value"
        elif sl is None:
            tranche["risk_unavailable_reason"] = "stop_not_observed"
        else:
            tranche["risk_unavailable_reason"] = None

    for deal in deals:
        when = int(deal["time_msc"])
        volume = D(deal.get("volume"))
        price = D(deal.get("price"))
        if volume is None or volume <= ZERO or price is None or price <= ZERO:
            raise ValueError("Invalid broker deal volume or execution price.")
        direction = "long" if deal["type"] == 0 else "short"
        charges = (D(deal.get("commission")) or ZERO) + (D(deal.get("fee")) or ZERO)
        swap = D(deal.get("swap")) or ZERO
        profit = D(deal.get("profit")) or ZERO
        remaining = volume
        if current is not None and current["direction"] != direction:
            total_close = min(current["remaining_volume"], remaining)
            to_close = total_close
            # Each exiting deal shares profit/swap/costs across the tranches
            # it closes. FIFO allocation is deterministic and fully auditable.
            while to_close > ZERO:
                tranche = next(t for t in current["tranches"] if t["open_volume"] > ZERO)
                q = min(tranche["open_volume"], to_close)
                ratio = q / total_close
                entry_fee = tranche["unallocated_cost"] * q / tranche["open_volume"]
                exit_fee = charges * q / volume
                net = profit * ratio + swap * ratio + exit_fee + entry_fee
                risk = None
                if tranche["risk"] is not None:
                    risk = tranche["risk"] * q / tranche["original_volume"]
                    current["closed_risk"] += risk
                else:
                    current["risk_missing"] = True
                movement = (price - tranche["entry"]) if tranche["direction"] == "long" else (tranche["entry"] - price)
                current["movement_sum"] += movement * q
                current["movement_volume"] += q
                current["holding_volume"] += q
                current["weighted_holding_ms"] += q * Decimal(when - tranche["time"])
                current["gross_profit"] += profit * ratio
                current["net_profit"] += net
                current["costs"] += entry_fee + exit_fee + swap * ratio
                current["closed_volume"] += q
                current["exits"].append({
                    "deal_ticket": str(deal["ticket"]), "order_ticket": str(deal.get("order", "")),
                    "time": as_iso(when), "volume": money(q), "price": money(price),
                    "gross_profit": money(profit * ratio), "swap": money(swap * ratio),
                    "allocated_entry_cost": money(entry_fee), "exit_cost": money(exit_fee),
                    "net_profit": money(net), "allocated_initial_risk": money(risk),
                    "realized_r": money(net / risk) if risk and risk > ZERO else None,
                    "movement": money(movement / unit_size) if unit_size else None,
                    "movement_unit": unit_name, "holding_seconds": money(Decimal(when - tranche["time"]) / 1000),
                })
                tranche["unallocated_cost"] -= entry_fee
                tranche["open_volume"] -= q
                current["remaining_volume"] -= q
                to_close -= q
            remaining -= total_close
            if current["remaining_volume"] == ZERO:
                current["final_exit_at"] = as_iso(when)
                timeline.append(current)
                current = None
        if remaining > ZERO:
            if current is None:
                current = open_cycle(when, direction)
            opening_cost = charges * remaining / volume
            entry_order = orders.get(deal.get("order"), orders.get(str(deal.get("order")), {})) or {}
            tranche = {
                "entry": price, "time": when, "order": entry_order,
                "direction": direction, "original_volume": remaining,
                "open_volume": remaining, "unallocated_cost": opening_cost,
                "frozen_sl": None, "stop_provenance": "unavailable",
                "stop_observed_at": None, "risk": None, "risk_unavailable_reason": None,
            }
            # A stop first seen AFTER a partial/full exit cannot establish the
            # original risk for volume already closed at that time.
            next_exits = [int(row["time_msc"]) for row in deals
                          if int(row["time_msc"]) >= when
                          and ("long" if row["type"] == 0 else "short") != direction]
            cutoff = min(next_exits) if next_exits else observed_at_ms
            if observed_at_ms is not None and cutoff is not None:
                cutoff = min(cutoff, observed_at_ms)
            initial_stop(tranche, cutoff)
            current["tranches"].append(tranche)
            current["remaining_volume"] += remaining
            current["entry_volume"] += remaining
            current["open_volume"] += remaining
            current["costs"] += ZERO  # opening charges enter realized net on close
            current["entries"].append({
                "deal_ticket": str(deal["ticket"]), "order_ticket": str(deal.get("order", "")),
                "time": as_iso(when), "price": money(price), "volume": money(remaining),
                "opening_cost": money(opening_cost),
                "initial_sl": money(tranche["frozen_sl"]),
                "initial_tp": money(D(entry_order.get("tp"))),
                "initial_sl_provenance": tranche["stop_provenance"],
                "initial_sl_observed_at": tranche["stop_observed_at"],
                "initial_risk": money(tranche["risk"]),
                "risk_unavailable_reason": tranche["risk_unavailable_reason"],
            })
        if current:
            latest = [o for o in observations if int(o["time_msc"]) <= when]
            if latest:
                current["current_stop"] = D(latest[-1].get("sl"))
                current["current_tp"] = D(latest[-1].get("tp"))

    if current is not None:
        latest = [o for o in observations
                  if observed_at_ms is None or int(o["time_msc"]) <= observed_at_ms]
        if latest:
            current["current_stop"] = D(latest[-1].get("sl"))
            current["current_tp"] = D(latest[-1].get("tp"))
        timeline.append(current)

    results = []
    for cycle in timeline:
        open_tranches = cycle["tranches"]
        initial_risk = (sum((t["risk"] for t in open_tranches), ZERO)
                        if all(t["risk"] is not None for t in open_tranches) else None)
        current_risk = None
        if cycle["current_stop"] and cycle["remaining_volume"] > ZERO:
            current_risk = sum(
                ((stop_risk(t["entry"], cycle["current_stop"], t["direction"], t["open_volume"], spec) or ZERO)
                 for t in open_tranches if t["open_volume"] > ZERO), ZERO)
        closed = cycle["closed_volume"] > ZERO
        known_r = closed and not cycle["risk_missing"] and cycle["closed_risk"] > ZERO
        first = open_tranches[0]
        duration = None
        if cycle["final_exit_at"]:
            duration = money(Decimal((datetime.fromisoformat(cycle["final_exit_at"]) -
                                      datetime.fromisoformat(cycle["first_entry_at"])).total_seconds()))
        movement = cycle["movement_sum"] / cycle["movement_volume"] / unit_size if unit_size and cycle["movement_volume"] else None
        planned = None
        tp = D(first["order"].get("tp"))
        if tp is not None and first["risk"] and first["original_volume"] > ZERO:
            # Reward uses target distance, not stop-direction validation.
            tick = D(spec.get("trade_tick_size"))
            tick_val = D(spec.get("trade_tick_value_profit")) or D(spec.get("trade_tick_value"))
            if tick and tick > ZERO and tick_val and tick_val > ZERO:
                favourable = (tp > first["entry"]) if first["direction"] == "long" else (tp < first["entry"])
                if favourable:
                    planned = abs(tp - first["entry"]) / tick * tick_val * first["original_volume"] / first["risk"]
        result = {
            "calculation_version": CONTRACT_VERSION, "position_id": position,
            "lifecycle_id": cycle["lifecycle_id"], "lifecycle_index": cycle["lifecycle_index"],
            "symbol": cycle["symbol"], "direction": cycle["direction"],
            "status": "closed" if cycle["final_exit_at"] else "open",
            "first_entry_at": cycle["first_entry_at"], "final_exit_at": cycle["final_exit_at"],
            "initial_entry_price": money(first["entry"]),
            "initial_volume": money(cycle["entry_volume"]),
            "remaining_volume": money(cycle["remaining_volume"]),
            "closed_volume": money(cycle["closed_volume"]),
            "initial_sl": money(first["frozen_sl"]),
            "initial_sl_provenance": first["stop_provenance"],
            "initial_sl_observed_at": first["stop_observed_at"],
            "initial_tp": money(D(first["order"].get("tp"))),
            "current_sl": money(cycle["current_stop"]),
            "current_tp": money(cycle["current_tp"]),
            "initial_risk_account": money(initial_risk),
            "closed_volume_risk_account": money(cycle["closed_risk"]) if known_r else None,
            "current_stop_exposure_account": money(current_risk),
            "capital_at_entry": cycle["capital"],
            "initial_risk_pct": money(initial_risk / D(cycle["capital"]["value"]) * 100)
                                if initial_risk is not None and D(cycle["capital"]["value"]) else None,
            "gross_realized_profit": money(cycle["gross_profit"]),
            "net_realized_profit": money(cycle["net_profit"]) if closed else None,
            "realized_r": money(cycle["net_profit"] / cycle["closed_risk"]) if known_r else None,
            "final_realized_r": money(cycle["net_profit"] / cycle["closed_risk"])
                                if known_r and cycle["final_exit_at"] else None,
            "planned_reward_risk": money(planned),
            "movement": money(movement), "movement_unit": unit_name,
            "holding_seconds": duration,
            "weighted_holding_seconds": money(cycle["weighted_holding_ms"] / cycle["holding_volume"] / 1000)
                                         if cycle["holding_volume"] else None,
            "entry_weekday": datetime.fromisoformat(cycle["first_entry_at"]).strftime("%A"),
            "sessions": sessions_crossed(
                int(datetime.fromisoformat(cycle["first_entry_at"]).timestamp() * 1000),
                int(datetime.fromisoformat(cycle["final_exit_at"]).timestamp() * 1000) if cycle["final_exit_at"] else None,
                confirmed=timezone_confirmed, broker_timezone=broker_timezone,
                conversion_provenance=conversion_provenance),
            "entries": cycle["entries"], "exits": cycle["exits"],
            "capture_completeness": {
                "original_risk": "known" if initial_risk is not None else "unavailable",
                "risk_reason": next((t["risk_unavailable_reason"] for t in open_tranches
                                    if t["risk"] is None), None),
                "session_status": "confirmed" if timezone_confirmed and conversion_provenance == "confirmed" else "unresolved",
            },
        }
        results.append(result)
    return results
