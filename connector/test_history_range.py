import sqlite3
import unittest

from history_range import DAY_MS, discover_deposit, deposit_candidates, clear_discovery


class FakeMT5:
    DEAL_TYPE_BALANCE = 2

    def __init__(self, deals):
        self.deals = deals
        self.calls = 0

    def history_deals_get(self, start, end):
        self.calls += 1
        low, high = int(start.timestamp()*1000), int(end.timestamp()*1000)
        return [row for row in self.deals if low <= row["time_msc"] < high]


def cash(ticket, day, amount, *, typ=2):
    return {"ticket":ticket,"type":typ,"time_msc":day*DAY_MS,
            "profit":amount,"comment":"broker cash movement"}


class DepositHistoryTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)

    def test_balance_deposit_not_withdrawal_or_broker_credit(self):
        rows = [cash(1, 2, 100),cash(2, 3, -40),cash(3, 4, 80, typ=6)]
        selected = deposit_candidates(rows,0,10*DAY_MS)
        self.assertEqual([x["ticket"] for x in selected],["1"])

    def test_latest_deposit_stops_at_first_recent_window(self):
        mt5 = FakeMT5([cash(10,100,50),cash(11,900,150)])
        done, anchor = discover_deposit(
            self.db,"link","request",1000*DAY_MS,0,
            "since_last_deposit",mt5)
        self.assertTrue(done)
        self.assertEqual(anchor["ticket"],"11")
        self.assertEqual(anchor["since"],900*DAY_MS)
        self.assertLess(mt5.calls,4)

    def test_first_deposit_resumes_without_losing_candidate(self):
        mt5 = FakeMT5([cash(10,100,50),cash(11,900,150)])
        done, anchor = discover_deposit(
            self.db,"link","request",1000*DAY_MS,0,
            "since_first_deposit",mt5)
        self.assertFalse(done)
        self.assertIsNone(anchor)
        done, anchor = discover_deposit(
            self.db,"link","request",1000*DAY_MS,0,
            "since_first_deposit",mt5)
        self.assertTrue(done)
        self.assertEqual(anchor["ticket"],"10")
        clear_discovery(self.db,"link","request")
        self.assertFalse(self.db.execute("SELECT 1 FROM history_anchor_scan").fetchone())

    def test_no_deposit_is_explicit_and_not_a_guessed_date(self):
        mt5=FakeMT5([cash(1,20,-100),cash(2,30,100,typ=6)])
        done, anchor = discover_deposit(
            self.db,"link","request",100*DAY_MS,0,
            "since_first_deposit",mt5)
        self.assertTrue(done)
        self.assertIsNone(anchor)

    def test_broker_unavailable_does_not_advance_cursor(self):
        mt5=FakeMT5([])
        mt5.history_deals_get=lambda *args: None
        with self.assertRaisesRegex(RuntimeError,"unavailable"):
            discover_deposit(self.db,"link","request",100*DAY_MS,0,
                             "since_last_deposit",mt5)
        self.assertEqual(self.db.execute(
            "SELECT cursor FROM history_anchor_scan").fetchone()[0],100*DAY_MS)


if __name__ == "__main__":
    unittest.main()
