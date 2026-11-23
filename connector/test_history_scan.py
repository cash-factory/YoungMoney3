import sqlite3
import time
from collections import namedtuple
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

import connect

DAY=86400000

class HistoryResumptionTests(unittest.TestCase):
    def setUp(self):
        self.stack=ExitStack()
        self.addCleanup(self.stack.close)
        self.db=sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.executescript("""
            CREATE TABLE links(link TEXT PRIMARY KEY,cursor INTEGER,last INTEGER,gap INTEGER);
            CREATE TABLE broker_clock(link TEXT PRIMARY KEY,offset INTEGER);
            CREATE TABLE capital_snapshots(link TEXT,at_ms INTEGER,equity TEXT,balance TEXT,PRIMARY KEY(link,at_ms));
            CREATE TABLE position_observations(link TEXT,position_id TEXT,at_ms INTEGER,sl TEXT,tp TEXT,PRIMARY KEY(link,position_id,at_ms));
            CREATE TABLE position_specs(link TEXT,position_id TEXT,payload TEXT,observed_at_ms INTEGER,PRIMARY KEY(link,position_id));
            CREATE TABLE position_recovery(link TEXT,position_id TEXT,status TEXT NOT NULL,checked_ms INTEGER NOT NULL,PRIMARY KEY(link,position_id));
            CREATE TABLE history_progress(link TEXT PRIMARY KEY,request TEXT,cursor INTEGER);
            CREATE TABLE cash_history_scan(link TEXT PRIMARY KEY,cursor INTEGER,complete INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE history_anchor_scan(link TEXT PRIMARY KEY,request TEXT,cursor INTEGER,candidate_at INTEGER,candidate_ticket TEXT,candidate_amount REAL);
            CREATE TABLE history_work(link TEXT,request TEXT,pid TEXT,done INTEGER,PRIMARY KEY(link,request,pid));
            CREATE TABLE latest(link TEXT,key TEXT,payload TEXT,PRIMARY KEY(link,key));
            CREATE TABLE outbox(seq INTEGER PRIMARY KEY,link TEXT,payload TEXT);
        """)
        self.now=int(time.time()*1000)
        self.start=self.now-5000
        self.since=self.start-42*DAY
        self.request='history-fixture'
        self.status='requested'
        self.calls=[]
        self.stack.enter_context(patch.object(connect,'db',self.db,create=True))
        self.stack.enter_context(patch.object(connect,'service','demo',create=True))
        self.stack.enter_context(patch.object(connect,'token','fixture',create=True))
        self.stack.enter_context(patch.object(connect,'heartbeats',{},create=True))
        self.stack.enter_context(patch.object(connect,'timezone_cache',{},create=True))
        self.stack.enter_context(patch.object(connect,'terminal_account',
            return_value=SimpleNamespace(balance=100.0,equity=102.0)))
        self.stack.enter_context(patch.object(connect.keyring,'get_password',return_value='investor'))
        self.api=self.stack.enter_context(patch.object(connect,'mt5'))
        self.api.positions_get.return_value=[]
        self.api.history_deals_get.return_value=[]
        self.api.history_orders_get.return_value=[]
        self.stack.enter_context(patch.object(connect,'post',side_effect=self.post))
        self.db.execute("INSERT INTO links VALUES(?,?,?,?)",('link',self.start,0,0))

    def post(self,action,payload,token=None):
        if action == 'history-progress':
            self.calls.append({"progress": payload["scanned_until"]})
            return {"ok": True}
        assert action=='sync', action
        self.calls.append(payload)
        if payload.get('history_done'):
            return {'history':{'id':self.request,'status':'ready'}}
        return {'history':{'id':self.request,'status':self.status,'since':self.since,'mode':'days'}}

    def scan(self):
        connect.scan('link','terminal64.exe','42','Demo',self.start,self.start,0,None,0)

    def test_history_scans_are_bounded_persistent_and_complete_without_fills(self):
        self.scan()
        cursor=self.db.execute("SELECT cursor FROM history_progress WHERE link='link'").fetchone()[0]
        self.assertEqual(cursor,self.since+14*DAY)
        self.scan()
        self.assertEqual(self.db.execute("SELECT cursor FROM history_progress WHERE link='link'").fetchone()[0],
                         self.since+28*DAY)
        self.scan()
        self.assertIsNone(self.db.execute("SELECT cursor FROM history_progress WHERE link='link'").fetchone())
        self.assertEqual(sum(bool(call.get('history_done')) for call in self.calls),1)
        for args,kwargs in self.api.history_deals_get.call_args_list:
            if len(args)==2:
                width=(args[1]-args[0]).total_seconds()*1000
                self.assertLessEqual(width,90*DAY+2500)

    def test_live_scan_keeps_uploading_when_broker_cash_history_contains_trade_deal_objects(self):
        # Production MT5 returns namedtuple TradeDeal objects; old raw()
        # accessed .items() and failed with AttributeError every retry.
        Deal = namedtuple("TradeDeal", "ticket type time time_msc profit position_id order magic")
        when = self.start - 2*DAY
        deposit = Deal(2**53 + 77, 2, when//1000, when, 500.0, 0, 0, 0)
        def broker_history(*args, **kwargs):
            if kwargs.get("position") is not None:
                return []
            low, high = [int(dt.timestamp()*1000) for dt in args]
            return [deposit] if low <= deposit.time_msc < high else []
        self.api.history_deals_get.side_effect = broker_history
        self.api.DEAL_TYPE_BALANCE = 2  # Real MT5 constant; MagicMock defaults are not integers.
        self.status = "declined"
        self.scan()
        updates = [row for row in self.calls if row.get("events")]
        self.assertTrue(updates, "Cash evidence must be sent after capture rather than crash")
        raw_events = [item for update in updates for item in update["events"]
                      if item.get("key") == "deal-" + str(deposit.ticket)]
        self.assertEqual(len(raw_events), 1)
        self.assertEqual(raw_events[0]["fields"]["ticket"], str(deposit.ticket))
        self.assertEqual(raw_events[0]["fields"]["profit"], 500.0)
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM outbox WHERE link='link'").fetchone()[0], 0,
            "Broker evidence is removed from local queue only after server acknowledgement")
        self.assertIsNotNone(self.db.execute(
            "SELECT cursor FROM cash_history_scan WHERE link='link'").fetchone())

    def test_cancelled_scan_stops_after_server_decline(self):
        self.scan()
        self.status='declined'
        self.scan()
        self.assertIsNone(self.db.execute("SELECT cursor FROM history_progress WHERE link='link'").fetchone())

if __name__=='__main__':
    unittest.main()
