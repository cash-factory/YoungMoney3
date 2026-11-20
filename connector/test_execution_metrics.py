from decimal import Decimal
import json
import sqlite3
import unittest

from ledger import position_lifecycles
from metrics import (instrument_snapshot, ensure_capture_schema, capture_entry_risks,
                     stored_risks, add_current_exposure)
from test_ledger import deal


def entry(ticket=1, size=2, price=100):
    return {**deal(ticket, 0, size, price, fee=-size), "entry": 0, "order": ticket,
            "time_msc": ticket * 1000}


def exit_fill(ticket, size, price, profit):
    return {**deal(ticket, 1, size, price, profit, -size), "entry": 1, "order": ticket,
            "time_msc": ticket * 1000}


class ExecutionMetricsTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        ensure_capture_schema(self.db)
        self.symbol = {"name": "TEST", "trade_calc_mode": 2, "trade_tick_size": 0.5}
        self.profit = lambda action, symbol, lots, opened, closed: (closed-opened)*lots*(1 if action == 0 else -1)

    def capture(self, deals, orders, positions=None, observed=1500):
        capture_entry_risks(self.db, "link", deals, orders, positions or {}, observed, 0,
                            lambda symbol: self.symbol, self.profit, "USD", 1000)
        return stored_risks(self.db, "link")

    def test_stop_is_immutable_and_partial_closes_form_one_trade(self):
        opened = entry()
        orders = {1: {"sl": 95, "tp": 110}}
        risks = self.capture([opened], orders)
        risks = self.capture([opened], {1: {"sl": 99, "tp": 120}}, {"17": {"sl": 99}}, 2000)
        self.assertEqual(risks["1"]["first_sl"], 95)
        events = list(position_lifecycles([opened, exit_fill(2, 1, 110, 10), exit_fill(4, 1, 95, -5)],
                                          orders, risks, instrument_snapshot(self.symbol)))
        self.assertEqual(len(events), 1)
        f = events[0]["fields"]
        self.assertEqual(f["pnl"], 1)
        self.assertEqual(f["initial_risk"], 10)
        self.assertEqual(f["realized_r"], 0.1)
        self.assertEqual(f["execution_metrics"]["duration_seconds"], 3)
        self.assertEqual(f["execution_metrics"]["movement_unit"], "ticks")
        self.assertEqual(f["execution_metrics"]["movement"], "5")
        self.assertEqual(len(f["execution_metrics"]["exits"]), 2)
        json.dumps(events)

    def test_late_stop_marks_provenance_and_does_not_invent_prior_closed_risk(self):
        fills = [entry(), exit_fill(2, 1, 101, 1)]
        risks = self.capture(fills, {}, {"17": {"sl": 95}}, observed=3000)
        self.assertTrue(risks["1"]["delayed_sl"])
        event = list(position_lifecycles(fills, {}, risks))[0]
        self.assertIsNone(event["fields"]["execution_metrics"]["closed_risk"])
        self.assertIsNone(event["fields"]["realized_r"])

    def test_nonprotective_first_stop_is_unknown_and_current_exposure_is_independent(self):
        risks = self.capture([entry()], {}, {"17": {"sl": 101}})
        self.assertIsNone(risks["1"]["risk_per_lot"])
        event = list(position_lifecycles([entry()], {}, risks))[0]
        add_current_exposure(event, {"sl": 99}, self.profit)
        self.assertEqual(Decimal(event["fields"]["execution_metrics"]["current_risk"]), Decimal(2))
        self.assertIsNone(event["fields"]["initial_risk"])

    def test_restart_reuses_first_stop(self):
        self.capture([entry()], {1: {"sl": 95}})
        self.db.commit()
        self.capture([entry()], {1: {"sl": 99}})
        self.assertEqual(stored_risks(self.db, "link")["1"]["first_sl"], 95)

    def test_fx_units_come_from_contract_and_jpy_precision(self):
        fx = {"trade_calc_mode": 0, "currency_base": "EUR", "currency_profit": "USD"}
        self.assertEqual(instrument_snapshot(fx)["pip_size"], "0.0001")
        self.assertEqual(instrument_snapshot({**fx, "currency_profit": "JPY"})["pip_size"], "0.01")
        self.assertEqual(instrument_snapshot({**fx, "trade_calc_mode": 2, "trade_tick_size": .01})["movement_unit"], "ticks")

    def test_reversal_splits_lifecycles_and_keeps_large_ticket_ids_as_strings(self):
        first = entry(ticket=9007199254740993, size=1)
        first["time_msc"] = 1000
        reverse = {**exit_fill(2, 2, 110, 10), "entry": 2}
        events = list(position_lifecycles([first, reverse]))
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["fields"]["status"], "closed")
        self.assertEqual(events[1]["fields"]["status"], "open")
        self.assertEqual(events[1]["fields"]["direction"], "short")
        self.assertEqual(events[0]["fields"]["execution_metrics"]["source_deal_tickets"][0], "9007199254740993")

    def test_closed_old_lifecycle_does_not_inherit_new_position_stop(self):
        fills = [entry(size=1), exit_fill(2, 1, 110, 10), entry(ticket=3, size=1)]
        risks = self.capture(fills, {}, {"17": {"sl": 95}}, observed=4000)
        self.assertNotIn("1", risks)
        self.assertIn("3", risks)


if __name__ == "__main__":
    unittest.main()
