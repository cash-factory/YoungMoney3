"""Real broker-path shape tests using a fake MT5 terminal only.

No credentials, sockets, demo or live account needed. Tests ensure a valid
short-lived task can reach order_send only after explicit local consent and
broker-native checks, and can NEVER repeat an ambiguous submission.
"""
import copy
import sqlite3
import time
import unittest
from types import SimpleNamespace
from uuid import uuid4

from copy_execution import (execute, prepare_database, set_consent,
                            COPY_MARKER)

class FakeMT5:
    ORDER_TYPE_BUY=0
    ORDER_TYPE_SELL=1
    ORDER_TYPE_BUY_LIMIT=2
    ORDER_TYPE_SELL_LIMIT=3
    ORDER_TYPE_BUY_STOP=4
    ORDER_TYPE_SELL_STOP=5
    ORDER_TYPE_BUY_STOP_LIMIT=6
    ORDER_TYPE_SELL_STOP_LIMIT=7
    TRADE_ACTION_DEAL=1
    TRADE_ACTION_PENDING=5
    TRADE_ACTION_SLTP=6
    TRADE_ACTION_MODIFY=7
    TRADE_ACTION_REMOVE=8
    ORDER_FILLING_FOK=0
    ORDER_FILLING_IOC=1
    ORDER_FILLING_RETURN=2
    ORDER_TIME_GTC=0
    ORDER_TIME_SPECIFIED=2
    SYMBOL_TRADE_EXECUTION_MARKET=2
    ORDER_STATE_CANCELED=2
    ORDER_STATE_EXPIRED=6

    def __init__(self):
        self.sent=[]
        self.now=int(time.time()*1000)
        self.quote=SimpleNamespace(time_msc=self.now,bid=1.101,ask=1.1012)
        self.info=SimpleNamespace(volume_min=0.01,volume_max=100,
                                  volume_step=0.01,trade_exemode=2,filling_mode=3)
        self.positions=[]
        self.pending=[]
        self.deal_receipts={}
        self.daily_deals=[]
        self.rejected=False
        self.partial=False
        self.profit=-100
        self.terminal=SimpleNamespace(connected=True,trade_allowed=True)

    def terminal_info(self):
        return self.terminal

    def symbol_info(self,symbol):
        return self.info if symbol in ('EURUSD','EURUSD.a') else None

    def symbol_select(self,symbol,enable):
        return symbol in ('EURUSD','EURUSD.a') and enable

    def symbol_info_tick(self,symbol):
        return self.quote

    def order_calc_profit(self,side,symbol,volume,entry,stop):
        return self.profit

    def history_deals_get(self,*args,**kwargs):
        if 'ticket' in kwargs:
            return [self.deal_receipts[kwargs['ticket']]] if kwargs['ticket'] in self.deal_receipts else []
        return self.daily_deals

    def positions_get(self,*args,**kwargs):
        if 'ticket' in kwargs:
            return [p for p in self.positions if p.ticket==kwargs['ticket']]
        return list(self.positions)

    def orders_get(self,*args,**kwargs):
        if 'ticket' in kwargs:
            return [p for p in self.pending if p.ticket==kwargs['ticket']]
        return list(self.pending)

    def order_check(self,request):
        return SimpleNamespace(retcode=10016 if self.rejected else 0,margin=12)

    def order_send(self,request):
        self.sent.append(copy.deepcopy(request))
        if request['action']==self.TRADE_ACTION_DEAL and 'position' not in request:
            ticket=9901
            pid=9901
            self.positions.append(SimpleNamespace(ticket=ticket,identifier=pid,
                symbol=request['symbol'],type=request['type'],volume=request['volume'],profit=0))
            self.deal_receipts[881]=SimpleNamespace(position_id=pid)
            return SimpleNamespace(retcode=10010 if self.partial else 10009,order=880,deal=881)
        if request['action']==self.TRADE_ACTION_PENDING:
            ticket=9902
            self.pending.append(SimpleNamespace(ticket=ticket,symbol=request['symbol']))
            return SimpleNamespace(retcode=10008,order=ticket,deal=0)
        if request['action']==self.TRADE_ACTION_DEAL and 'position' in request:
            self.positions=[]
            return SimpleNamespace(retcode=10009,order=882,deal=883)
        return SimpleNamespace(retcode=10009,order=request.get('order',885),deal=0)

class LocalExecutionTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        prepare_database(self.db)
        self.mt5=FakeMT5()
        self.link='00000000-0000-4000-8000-000000000001'
        self.account=SimpleNamespace(equity=2000,balance=2000,margin_free=1950,
            currency='USD',trade_mode=0,trade_allowed=True)
        self.source={
          'key':'position:888','kind':'position','symbol':'EURUSD','type':0,
          'volume':0.3,'price':1.1,'sl':1.09,'tp':1.2,
          'stoplimit':0,'expiration':0,'time_ms':self.mt5.now,
        }
        self.risk={'mode':'risk_pct_equity','value':1,'maxLots':2,
                   'maxDailyLossPct':2,'symbolMap':{},'mirrorProtection':True}

    def task(self,action='open_market',source=None,confirmed=None):
        return {'id':str(uuid4()),'sourceKey':(source or self.source)['key'],
          'action':action,'expiresAt':self.mt5.now+12000,
          'payload':{'source':source or self.source,'sourceVolume':0.3,
                     'sourceEquity':1000,'sourceCurrency':'USD',
                     'risk':self.risk.copy(),'confirmedBy':confirmed}}

    def test_demo_market_entry_broker_risk_stops_and_idempotency(self):
        task=self.task()
        assert not self.mt5.sent
        refused=execute(self.mt5,self.db,self.link,task,self.account,now_ms=self.mt5.now)
        self.assertEqual(refused['code'],'local_demo_execution_not_consented')
        self.assertEqual(self.mt5.sent,[])
        set_consent(self.db,self.link,True)
        result=execute(self.mt5,self.db,self.link,task,self.account,now_ms=self.mt5.now)
        self.assertEqual(result['status'],'applied',result)
        self.assertEqual(result['brokerTicket'],'9901')
        self.assertAlmostEqual(result['details']['risk_pct_equity'],1)
        self.assertEqual(len(self.mt5.sent),1)
        order=self.mt5.sent[0]
        self.assertEqual(order['action'],self.mt5.TRADE_ACTION_DEAL)
        self.assertEqual(order['sl'],1.09)
        self.assertEqual(order['tp'],1.2)
        self.assertGreater(order['volume'],0)
        self.assertEqual(order['type'],self.mt5.ORDER_TYPE_BUY)
        self.assertTrue(order['comment'].startswith(COPY_MARKER))
        self.assertEqual(execute(self.mt5,self.db,self.link,task,self.account,now_ms=self.mt5.now),result)
        self.assertEqual(len(self.mt5.sent),1,'Same instruction must never submit twice')
        stored=self.db.execute('SELECT ticket,kind FROM copy_local_mappings').fetchone()
        self.assertEqual(stored,('9901','position'))

    def test_partial_broker_fill_is_never_assumed_full_and_replayed(self):
        set_consent(self.db,self.link,True)
        self.mt5.partial=True
        order=self.task()
        response=execute(self.mt5,self.db,self.link,order,self.account,now_ms=self.mt5.now)
        self.assertEqual(response['status'],'unknown')
        self.assertEqual(response['code'],'partial_fill_requires_broker_reconciliation')
        self.assertEqual(len(self.mt5.sent),1)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM copy_local_mappings').fetchone()[0],0,
                         'The full source-to-follower lot ratio must not be guessed from a partial fill.')
        again=execute(self.mt5,self.db,self.link,order,self.account,now_ms=self.mt5.now)
        self.assertEqual(again,response)
        self.assertEqual(len(self.mt5.sent),1,'No second order on ambiguous broker partial fill.')

    def test_pending_stop_limit_orders_preserve_broker_fields_and_map_order(self):
        set_consent(self.db,self.link,True)
        source={**self.source,'key':'pending:555','kind':'pending','type':6,
            'price':1.12,'stoplimit':1.115,'expiration':self.mt5.now+600000}
        result=execute(self.mt5,self.db,self.link,self.task('place_pending',source),
                       self.account,now_ms=self.mt5.now)
        self.assertEqual(result['status'],'applied',result)
        request=self.mt5.sent[-1]
        self.assertEqual(request['action'],self.mt5.TRADE_ACTION_PENDING)
        self.assertEqual(request['type'],self.mt5.ORDER_TYPE_BUY_STOP_LIMIT)
        self.assertEqual(request['stoplimit'],1.115)
        self.assertEqual(request['sl'],1.09)
        self.assertEqual(request['tp'],1.2)
        self.assertEqual(request['type_filling'],self.mt5.ORDER_FILLING_RETURN)
        self.assertEqual(result['brokerTicket'],'9902')
        self.assertEqual(self.db.execute('SELECT kind FROM copy_local_mappings').fetchone()[0],'pending')
        # Modify this exact mapped broker ticket rather than hunting by symbol.
        self.mt5.quote.time_msc=self.mt5.now
        modified={**source,'price':1.118,'sl':1.091,'tp':1.198}
        result=execute(self.mt5,self.db,self.link,self.task('modify_pending',modified),
                       self.account,now_ms=self.mt5.now)
        self.assertEqual(result['status'],'applied')
        self.assertEqual(self.mt5.sent[-1]['order'],9902)
        self.assertEqual(self.mt5.sent[-1]['price'],1.118)
        cancelled=execute(self.mt5,self.db,self.link,self.task('cancel_pending',source,confirmed='555'),
                          self.account,now_ms=self.mt5.now)
        self.assertEqual(cancelled['status'],'applied')
        self.assertEqual(self.mt5.sent[-1]['action'],self.mt5.TRADE_ACTION_REMOVE)

    def test_local_revoke_live_accounts_risk_preflight_and_uncertain_result(self):
        task=self.task()
        set_consent(self.db,self.link,True)
        live=SimpleNamespace(**{**vars(self.account),'trade_mode':2})
        denied=execute(self.mt5,self.db,self.link,task,live,now_ms=self.mt5.now)
        self.assertEqual(denied['code'],'real_or_contest_account_execution_blocked')
        self.assertEqual(self.mt5.sent,[])
        readonly=SimpleNamespace(**{**vars(self.account),'trade_allowed':False})
        denied2=execute(self.mt5,self.db,self.link,self.task(),readonly,now_ms=self.mt5.now)
        self.assertEqual(denied2['code'],'investor_or_restricted_broker_access')
        self.assertEqual(self.mt5.sent,[])
        self.mt5.rejected=True
        blocked=execute(self.mt5,self.db,self.link,self.task(),self.account,now_ms=self.mt5.now)
        self.assertEqual(blocked['code'],'broker_order_precheck_rejected')
        self.assertEqual(self.mt5.sent,[])
        self.mt5.rejected=False
        no_stop=execute(self.mt5,self.db,self.link,self.task(source={**self.source,'sl':0}),
                        self.account,now_ms=self.mt5.now)
        self.assertEqual(no_stop['status'],'rejected')
        self.assertEqual(self.mt5.sent,[])
        set_consent(self.db,self.link,False)
        revoked=execute(self.mt5,self.db,self.link,self.task(),self.account,now_ms=self.mt5.now)
        self.assertEqual(revoked['code'],'local_demo_execution_not_consented')
        self.assertEqual(self.mt5.sent,[])

    def test_daily_loss_budget_rejects_new_risk_that_would_exceed_cap(self):
        set_consent(self.db,self.link,True)
        self.mt5.daily_deals=[SimpleNamespace(type=0,profit=-35,commission=0,fee=0,swap=0)]
        # The follower has $2000 equity. Max 2% loss => $40. A new order
        # risking $20 would exceed the $5 remaining budget.
        blocked=execute(self.mt5,self.db,self.link,self.task(),
                        self.account,now_ms=self.mt5.now)
        self.assertEqual(blocked['status'],'rejected',blocked)
        self.assertEqual(blocked['code'],'new_order_risk_exceeds_remaining_daily_limit')
        self.assertEqual(self.mt5.sent,[])

    def test_verified_ticket_mapping_controls_sltp_and_close(self):
        set_consent(self.db,self.link,True)
        opened=execute(self.mt5,self.db,self.link,self.task(),self.account,now_ms=self.mt5.now)
        self.assertEqual(opened['status'],'applied',opened)
        modified={**self.source,'sl':1.095,'tp':1.21}
        response=execute(self.mt5,self.db,self.link,self.task('modify_sl_tp',modified),
                         self.account,now_ms=self.mt5.now)
        self.assertEqual(response['status'],'applied',response)
        command=self.mt5.sent[-1]
        self.assertEqual(command['action'],self.mt5.TRADE_ACTION_SLTP)
        self.assertEqual(command['position'],9901)
        self.assertEqual(command['sl'],1.095)
        no_proof=execute(self.mt5,self.db,self.link,self.task('close_position'),
                         self.account,now_ms=self.mt5.now)
        self.assertEqual(no_proof['code'],'source_broker_execution_proof_missing')
        done=execute(self.mt5,self.db,self.link,self.task('close_position',confirmed='123456'),
                     self.account,now_ms=self.mt5.now)
        self.assertEqual(done['status'],'applied',done)
        self.assertEqual(self.mt5.sent[-1]['position'],9901)
        self.assertEqual(self.mt5.sent[-1]['type'],self.mt5.ORDER_TYPE_SELL)
        self.assertEqual(self.mt5.positions,[])

if __name__=='__main__': unittest.main()
