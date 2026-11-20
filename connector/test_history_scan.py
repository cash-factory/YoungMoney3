import sqlite3
import time
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
            CREATE TABLE history_progress(link TEXT PRIMARY KEY,request TEXT,cursor INTEGER);
            CREATE TABLE history_work(link TEXT,request TEXT,pid TEXT,done INTEGER,PRIMARY KEY(link,request,pid));
            CREATE TABLE latest(link TEXT,key TEXT,payload TEXT,PRIMARY KEY(link,key));
            CREATE TABLE outbox(seq INTEGER PRIMARY KEY,link TEXT,payload TEXT);
        """)
        self.now=int(time.time()*1000)
        self.start=self.now-5000
        self.since=self.start-20*DAY
        self.request='history-fixture'
        self.status='requested'
        self.calls=[]
        self.stack.enter_context(patch.object(connect,'db',self.db,create=True))
        self.stack.enter_context(patch.object(connect,'service','demo',create=True))
        self.stack.enter_context(patch.object(connect,'token','fixture',create=True))
        self.stack.enter_context(patch.object(connect,'heartbeats',{},create=True))
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
        assert action=='sync', action
        self.calls.append(payload)
        if payload.get('history_done'):
            return {'history':{'id':self.request,'status':'ready'}}
        return {'history':{'id':self.request,'status':self.status,'since':self.since}}

    def scan(self):
        connect.scan('link','terminal64.exe','42','Demo',self.start,self.start,0,None,0)

    def test_history_scans_are_bounded_persistent_and_complete_without_fills(self):
        self.scan()
        cursor=self.db.execute("SELECT cursor FROM history_progress WHERE link='link'").fetchone()[0]
        self.assertEqual(cursor,self.since+7*DAY)
        self.scan()
        self.assertEqual(self.db.execute("SELECT cursor FROM history_progress WHERE link='link'").fetchone()[0],
                         self.since+14*DAY)
        self.scan()
        self.assertIsNone(self.db.execute("SELECT cursor FROM history_progress WHERE link='link'").fetchone())
        self.assertEqual(sum(bool(call.get('history_done')) for call in self.calls),1)
        for args,kwargs in self.api.history_deals_get.call_args_list:
            if len(args)==2:
                width=(args[1]-args[0]).total_seconds()*1000
                self.assertLessEqual(width,7*DAY+2500)

    def test_closed_position_uploads_one_rich_lifecycle(self):
        class Record(dict):
            def _asdict(self):
                return dict(self)
        opened=Record(ticket=9007199254740993,order=11,position_id=17,symbol="EURUSD",type=0,entry=0,
                      volume=1,price=1.1,profit=0,commission=-1,fee=0,swap=0,time_msc=self.start+1000)
        closed=Record(ticket=9007199254740994,order=12,position_id=17,symbol="EURUSD",type=1,entry=1,
                      volume=1,price=1.101,profit=100,commission=-1,fee=0,swap=0,time_msc=self.start+2000)
        self.api.history_deals_get.return_value=[opened,closed]
        self.api.history_orders_get.return_value=[Record(ticket=11,sl=1.099,tp=1.102,time_done_msc=self.start+1000,time_setup_msc=self.start+1000)]
        self.api.symbol_info_tick.return_value=None
        self.api.symbol_info.return_value=Record(name="EURUSD",trade_calc_mode=0,currency_base="EUR",currency_profit="USD",trade_tick_size=.00001)
        self.api.order_calc_profit.side_effect=lambda action,symbol,volume,entry,exit:(exit-entry)*100000*volume
        self.scan()
        events=[event for call in self.calls for event in call.get("events",[]) if event["kind"]=="lifecycle"]
        self.assertEqual(len(events),1)
        event=events[0]
        self.assertEqual(event["key"],"position-17-9007199254740993")
        self.assertEqual(event["fields"]["status"],"closed")
        self.assertEqual(event["fields"]["pnl"],98)
        self.assertAlmostEqual(event["fields"]["pips"],10)
        self.assertEqual(event["fields"]["execution_metrics"]["first_sl"],1.099)
        self.assertEqual(event["fields"]["execution_metrics"]["source_deal_tickets"],["9007199254740993","9007199254740994"])

    def test_cancelled_scan_stops_after_server_decline(self):
        self.scan()
        self.status='declined'
        self.scan()
        self.assertIsNone(self.db.execute("SELECT cursor FROM history_progress WHERE link='link'").fetchone())

if __name__=='__main__':
    unittest.main()
