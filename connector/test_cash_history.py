import sqlite3
import unittest
from collections import namedtuple

from connect import raw
from datetime import datetime,timezone
from cash_history import WINDOW_MS, backfill

def deal(ticket,at,amount,kind=2):
    return {"ticket":ticket,"type":kind,"time_msc":at,"profit":amount}

class MT5:
    DEAL_TYPE_BALANCE=2
    def __init__(self,rows):
        self.rows=rows
        self.calls=0
    def history_deals_get(self,a,b):
        self.calls+=1
        low,high=int(a.timestamp()*1000),int(b.timestamp()*1000)
        return [r for r in self.rows if low<=r["time_msc"]<high]

class CashBackfillTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(":memory:")
        self.db.executescript("""
          CREATE TABLE cash_history_scan(link TEXT PRIMARY KEY,cursor INTEGER,complete INTEGER);
          CREATE TABLE outbox(link TEXT,key TEXT,payload TEXT,PRIMARY KEY(link,key));
        """)
        self.events=[]
        self.enqueue=lambda link,kind,key,row:self.events.append((link,kind,key,row))
    def test_backfills_older_deposit_and_withdrawal_without_trading_events(self):
        start=3*WINDOW_MS
        api=MT5([deal(11,WINDOW_MS+1,125),deal(12,WINDOW_MS+3,-40),
                 deal(13,WINDOW_MS+7,50,6),deal(14,WINDOW_MS+15,10,0)])
        result=backfill(self.db,"link",start,0,api,self.enqueue,lambda row:row)
        self.assertEqual(result["cursor"],WINDOW_MS)
        self.assertEqual([x[2] for x in self.events],["deal-11","deal-12"])
        end=backfill(self.db,"link",start,0,api,self.enqueue,lambda row:row)
        self.assertEqual(end,{"cursor":0,"complete":True})
        self.assertEqual(self.db.execute("SELECT complete FROM cash_history_scan WHERE link='link'").fetchone()[0],1)
        self.assertEqual(api.calls,3)
        backfill(self.db,"link",start,0,api,self.enqueue,lambda row:row)
        self.assertEqual(api.calls,3)

    def test_real_mt5_trade_deal_named_tuples_backfill_without_attribute_error(self):
        # MetaTrader5.history_deals_get returns TradeDeal namedtuples, not dicts.
        # The old raw() called .items() directly and crashed every capture loop.
        Deal = namedtuple("TradeDeal", "ticket type time time_msc profit position_id order magic")
        earlier = WINDOW_MS + 7000
        deposit = Deal(2**53 + 27, 2, earlier, earlier, 200.25, 2**53 + 28, 2**53 + 29, 7)
        withdrawal = Deal(101, 2, earlier + 250, earlier + 250, -35.5, 9, 10, 0)
        trade = Deal(102, 0, earlier + 400, earlier + 400, 100, 9, 10, 0)
        api = MT5([])
        api.history_deals_get = lambda _a, _b: [deposit, withdrawal, trade]
        result = backfill(self.db, "link", 2*WINDOW_MS, 0, api, self.enqueue, raw, windows=1)
        self.assertFalse(result["complete"])
        self.assertEqual([item[2] for item in self.events],
                         ["deal-" + str(deposit.ticket), "deal-101"])
        preserved = self.events[0][3]
        self.assertEqual(preserved["ticket"], str(deposit.ticket))
        self.assertEqual(preserved["position_id"], str(deposit.position_id))
        self.assertEqual(preserved["order"], str(deposit.order))
        self.assertEqual(preserved["time_msc"], earlier)
        self.assertEqual(preserved["profit"], 200.25)
        self.assertEqual(self.db.execute("SELECT cursor FROM cash_history_scan WHERE link='link'")
                         .fetchone()[0], WINDOW_MS)

    def test_raw_accepts_dict_and_namedtuple_without_changing_broker_fields(self):
        Deal = namedtuple("TradeDeal", "ticket order position_id comment")
        item = Deal(2**53 + 123, 999, 2**53 + 321, "broker evidence")
        self.assertEqual(raw(item), raw(item._asdict()))
        self.assertEqual(raw(item)["ticket"], str(item.ticket))
        self.assertEqual(raw(item)["comment"], "broker evidence")
        with self.assertRaisesRegex(TypeError, "Unsupported MT5 record"):
            raw(object())

    def test_history_failure_preserves_checkpoint(self):
        start=2*WINDOW_MS
        api=MT5([])
        api.history_deals_get=lambda *args:None
        with self.assertRaisesRegex(RuntimeError,"did not return"):
            backfill(self.db,"link",start,0,api,self.enqueue,lambda row:row)
        self.assertEqual(self.db.execute("SELECT cursor FROM cash_history_scan WHERE link='link'").fetchone()[0],start)

    def test_clock_offset_keeps_original_broker_evidence(self):
        start=WINDOW_MS+10000
        offset=3600000
        original=deal(991,5000+offset,100)
        api=MT5([original])
        result=backfill(self.db,"link",start,offset,api,self.enqueue,lambda row:row)
        self.assertEqual(result["cursor"],0)
        self.assertEqual(self.events[0][3]["time_msc"],5000+offset)

if __name__=="__main__":
    unittest.main()
