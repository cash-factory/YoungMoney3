"""Broker lifecycle fixtures: no MT5 terminal, credentials, or external services needed."""
import unittest
from datetime import datetime, timezone
from decimal import Decimal

from lifecycle import reconstruct, sessions_at, sessions_crossed

SPEC = {"is_forex": True, "digits": 5, "point": "0.00001",
        "trade_tick_size": "0.00001", "trade_tick_value": "1",
        "trade_tick_value_loss": "1", "trade_tick_value_profit": "1"}
BASE = 1730815200000  # UTC fixed synthetic timestamp


def deal(ticket, at, typ, volume, price, entry, *, profit="0", fee="0", commission="0", swap="0", pid="77", order=None):
    return {"ticket": ticket, "time_msc": at, "type": typ, "entry": entry,
            "volume": volume, "price": price, "profit": profit, "fee": fee,
            "commission": commission, "swap": swap, "position_id": pid,
            "symbol": "EURUSD", "order": order if order is not None else ticket}


class LifecycleContractTests(unittest.TestCase):
    def test_partial_closes_allocate_risk_and_opening_cost_without_rewriting_stop(self):
        rows = [
            deal(1, BASE, 0, "2", "1.10000", 0, commission="-4"),
            deal(2, BASE + 3600000, 1, "0.5", "1.10100", 1, profit="50", commission="-1"),
            deal(3, BASE + 7200000, 1, "1.5", "1.10300", 1, profit="450", commission="-3"),
        ]
        obs = [{"position_id": "77", "time_msc": BASE + 30000, "sl": 1.099, "tp": 1.104},
               {"position_id": "77", "time_msc": BASE + 100000, "sl": 1.1005, "tp": 1.105}]
        s = reconstruct(rows, {}, obs, SPEC, capital_samples=[{"at_ms": BASE-5000, "equity": "20000", "balance": "18000"}])
        self.assertEqual(len(s), 1)
        x = s[0]
        self.assertEqual(x["status"], "closed")
        self.assertEqual(x["initial_sl_provenance"], "first_observed")
        self.assertEqual(x["initial_sl"], "1.099")
        self.assertEqual(x["initial_risk_account"], "200.000")
        self.assertEqual(x["closed_volume_risk_account"], "200.0000")
        self.assertEqual(x["capital_at_entry"]["source"], "equity")
        self.assertEqual(x["capital_at_entry"]["value"], "20000")
        self.assertEqual(x["net_realized_profit"], "492.000")
        self.assertEqual(x["final_realized_r"], "2.46")
        self.assertEqual(x["remaining_volume"], "0.0")
        self.assertEqual(x["weighted_holding_seconds"], "6300.0")
        self.assertEqual(x["movement_unit"], "pips")
        self.assertEqual(x["movement"], "25.0")

    def test_first_observed_beyond_break_even_stays_unavailable(self):
        rows=[deal(1, BASE, 0, "1", "1.10000", 0),
              deal(2, BASE+60000, 1, "1", "1.10200", 1, profit="200")]
        obs=[{"position_id":"77","time_msc":BASE+1000,"sl":1.101,"tp":0},
             {"position_id":"77","time_msc":BASE+2000,"sl":1.099,"tp":0}]
        x=reconstruct(rows,{},obs,SPEC)[0]
        self.assertEqual(x["initial_sl_provenance"],"first_observed")
        self.assertIsNone(x["initial_risk_account"])
        self.assertIsNone(x["final_realized_r"])
        self.assertEqual(x["capture_completeness"]["risk_reason"],"non_protective_or_missing_tick_value")

    def test_original_open_order_sl_dominates_later_observations(self):
        rows=[deal(1, BASE, 0, "1", "1.10000", 0),
              deal(2, BASE+60000, 1, "1", "1.10200", 1, profit="200")]
        obs=[{"position_id":"77","time_msc":BASE+1000,"sl":1.101,"tp":0}]
        x=reconstruct(rows,{1:{"sl":"1.09800","tp":"1.10600"}},obs,SPEC)[0]
        self.assertEqual(x["initial_sl"],"1.09800")
        self.assertEqual(x["initial_sl_provenance"],"executed_open_order")
        self.assertEqual(x["initial_risk_account"],"200.000")
        self.assertEqual(x["planned_reward_risk"],"3")

    def test_scale_in_has_independent_risk_and_one_lifecycle(self):
        rows=[deal(1, BASE, 0, "1", "1.10000", 0, commission="-2"),
              deal(2, BASE+10000, 0, "1", "1.10100", 0, commission="-2"),
              deal(3, BASE+100000, 1, "2", "1.10500", 1, profit="900")]
        orders={1:{"sl":"1.09800"},2:{"sl":"1.09900"}}
        x=reconstruct(rows,orders,[],SPEC)[0]
        self.assertEqual(len(x["entries"]),2)
        self.assertEqual(x["initial_risk_account"],"400.000")
        self.assertEqual(x["net_realized_profit"],"896")
        self.assertEqual(x["closed_volume"],"2")
        self.assertEqual(x["final_realized_r"],"2.24")

    def test_netting_reversal_creates_second_lifecycle(self):
        rows=[deal(1,BASE,0,"1","1.10000",0),
              deal(2,BASE+10000,1,"2","1.09800",2,profit="-200"),
              deal(3,BASE+20000,0,"1","1.09600",1,profit="200")]
        x=reconstruct(rows,{1:{"sl":"1.099"},2:{"sl":"1.100"}},[],SPEC)
        self.assertEqual(len(x),2)
        self.assertEqual(x[0]["lifecycle_id"],"77:0")
        self.assertEqual(x[1]["lifecycle_id"],"77:1")
        self.assertEqual(x[0]["direction"],"long")
        self.assertEqual(x[1]["direction"],"short")
        self.assertEqual(x[1]["status"],"closed")

    def test_unknown_tick_value_keeps_r_null(self):
        rows=[deal(1,BASE,0,"1","1.10000",0),
              deal(2,BASE+10000,1,"1","1.10100",1,profit="100")]
        x=reconstruct(rows,{1:{"sl":"1.098"}},[],{"is_forex":True,"digits":5,"point":"0.00001"})[0]
        self.assertIsNone(x["final_realized_r"])
        self.assertEqual(x["movement_unit"],"pips")

    def test_non_forex_uses_ticks_not_pips(self):
        spec={"is_forex":False,"trade_tick_size":"0.25","trade_tick_value_loss":"12.5"}
        rows=[deal(1,BASE,0,"1","5250",0),deal(2,BASE+30000,1,"1","5251",1,profit="50")]
        x=reconstruct(rows,{1:{"sl":"5249"}},[],spec)[0]
        self.assertEqual(x["movement_unit"],"ticks")
        self.assertEqual(x["movement"],"4")
        self.assertEqual(x["initial_risk_account"],"50.0")

    def test_dst_sessions_require_explicit_confirmed_conversion(self):
        stamp=lambda iso:int(datetime.fromisoformat(iso).timestamp()*1000)
        before=stamp("2026-03-27T08:30:00+00:00")
        after=stamp("2026-03-30T08:30:00+00:00")
        self.assertIn("London",sessions_at(before))
        self.assertIn("London",sessions_at(after))
        x=sessions_crossed(before,before+3600000,confirmed=False,broker_timezone="Europe/Athens",conversion_provenance="confirmed")
        self.assertEqual(x["status"],"unresolved")
        y=sessions_crossed(after,after+3600000,confirmed=True,broker_timezone="Europe/Athens",conversion_provenance="confirmed")
        self.assertEqual(y["status"],"confirmed")
        self.assertIn("London",y["sessions"])


if __name__=="__main__":
    unittest.main()
