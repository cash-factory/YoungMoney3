import unittest
from types import SimpleNamespace as NS
from unittest.mock import Mock
from copy_engine import CopyRejected, RiskPolicy, plan_follower, follower_routes
from copy_execution import ExecutionGrant, create_request, execute_demo_once, build_lifecycle_request

def broker():
    mt5=NS(
        ACCOUNT_TRADE_MODE_DEMO=0,SYMBOL_TRADE_MODE_DISABLED=0,
        ORDER_TYPE_BUY=0,ORDER_TYPE_SELL=1,
        ORDER_TYPE_BUY_LIMIT=2,ORDER_TYPE_SELL_LIMIT=3,
        ORDER_TYPE_BUY_STOP=4,ORDER_TYPE_SELL_STOP=5,
        ORDER_TYPE_BUY_STOP_LIMIT=6,ORDER_TYPE_SELL_STOP_LIMIT=7,
        TRADE_ACTION_DEAL=1,TRADE_ACTION_PENDING=5,TRADE_ACTION_SLTP=6,
        TRADE_ACTION_MODIFY=7,TRADE_ACTION_REMOVE=8,
        ORDER_TIME_GTC=0,ORDER_TIME_SPECIFIED=2,
        TRADE_RETCODE_DONE=10009,TRADE_RETCODE_PLACED=10008,
        symbol_info=lambda s:NS(volume_min=0.01,volume_max=20,volume_step=0.01,trade_mode=4),
        order_calc_profit=lambda side,symbol,lot,entry,exit:(exit-entry)*1000*lot*(1 if side==0 else -1),
        order_calc_margin=lambda side,symbol,lot,entry:lot*300,
        order_check=lambda req:NS(retcode=0),
        order_send=Mock(return_value=NS(retcode=10008,order=993,deal=0)),
    )
    account=NS(login=50001,server='Broker-Demo',currency='USD',
               equity=10000,balance=9000,margin_free=8000,trade_allowed=True,trade_expert=True,trade_mode=0)
    return mt5,account

def policy(mode='equity_percentage',value=1):
    return RiskPolicy.from_json({'mode':mode,'value':value,'max_lots':5,'max_risk_pct':5,'max_margin_pct':35})

class MockLedger:
    def __init__(self):
        self.sent=set()
        self.states={}
    def claim(self,key):
        if key in self.sent:return False
        self.sent.add(key);return True
    def finalize(self,key,status,receipt):
        self.states[key]=(status,receipt)

class CopyEngineTests(unittest.TestCase):
    def setUp(self):
        self.mt5,self.account=broker()

    def test_per_follower_equity_percentage_uses_broker_account_currency(self):
        result=plan_follower(self.mt5,account=self.account,symbol='EURUSD',
                             kind='buy',entry=1.2,sl=1.1,tp=1.4,policy=policy())
        self.assertEqual(result['lots'],'1.00')
        self.assertAlmostEqual(float(result['estimated_loss_at_sl']),100,places=5)
        self.assertAlmostEqual(float(result['estimated_profit_at_tp']),200,places=5)
        self.assertAlmostEqual(float(result['risk_pct_equity']),1,places=5)
        self.assertFalse(result['execution_enabled'])
    def test_fixed_amount_and_balance_percent_are_distinct(self):
        args=dict(account=self.account,symbol='EURUSD',kind='buy',
                  entry=1.2,sl=1.1,tp=1.4)
        fixed=plan_follower(self.mt5,**args,policy=policy('fixed_amount',47))
        bal=plan_follower(self.mt5,**args,policy=policy('balance_percentage',1))
        self.assertEqual(fixed['lots'],'0.47')
        self.assertEqual(bal['lots'],'0.90')
    def test_ratios_and_multiple_follower_support(self):
        source={'src':{'owned':True,'status':'connected','trade_mode':0}}
        for i in range(8):
            source[str(i)]={'owned':True,'status':'connected','trade_mode':0}
        self.assertEqual(len(follower_routes(source,'src',[str(i) for i in range(8)])),8)
        args=dict(account=self.account,symbol='EURUSD',kind='sell',entry=1.3,sl=1.4,tp=1.1)
        answer=plan_follower(self.mt5,**args,policy=policy('balance_ratio',1),
                             source_lots=0.4,source_balance=4500)
        self.assertEqual(answer['lots'],'0.80')
        with self.assertRaises(CopyRejected):
            follower_routes(source,'src',['src','1'])
        with self.assertRaises(CopyRejected):
            follower_routes(source,'src',['1','1'])
        with self.assertRaises(CopyRejected):
            follower_routes(source,'src',[str(i) for i in range(21)])
    def test_pending_types_and_sltp_command_mapping(self):
        for name in ('buy_limit','sell_limit','buy_stop','sell_stop',
                     'buy_stop_limit','sell_stop_limit'):
            direction='buy' if name.startswith('buy') else 'sell'
            v=plan_follower(self.mt5,account=self.account,symbol='EURUSD',
               kind=name,entry=1.2,sl=1.1 if direction=='buy' else 1.3,
               tp=1.4 if direction=='buy' else 1.0,policy=policy(),
               stoplimit=1.21 if name.endswith('stop_limit') else None)
            request=create_request(self.mt5,v)
            self.assertEqual(request['action'],self.mt5.TRADE_ACTION_PENDING)
            if name.endswith('stop_limit'):
                self.assertEqual(request['stoplimit'],1.21)
        self.assertEqual(build_lifecycle_request(self.mt5,'cancel_pending',
                         symbol='EURUSD',ticket='777')['action'],self.mt5.TRADE_ACTION_REMOVE)
        self.assertEqual(build_lifecycle_request(self.mt5,'adjust_protection',
                         symbol='EURUSD',ticket='777',sl=1.1,tp=1.4)['action'],self.mt5.TRADE_ACTION_SLTP)
        with self.assertRaises(CopyRejected):
            build_lifecycle_request(self.mt5,'adjust_protection',symbol='EURUSD',ticket='777',sl=1.1)
        with self.assertRaises(CopyRejected):
            build_lifecycle_request(self.mt5,'adjust_protection',symbol='EURUSD',ticket='777',tp=1.4)
        self.assertEqual(build_lifecycle_request(self.mt5,'modify_pending',
                         symbol='EURUSD',ticket='777',price=1.2)['action'],self.mt5.TRADE_ACTION_MODIFY)
    def test_missing_stop_and_minimum_lot_cannot_be_rounded_up(self):
        for stop in (None,0,1.3):
            with self.assertRaises(CopyRejected):
                plan_follower(self.mt5,account=self.account,symbol='EURUSD',
                              kind='buy',entry=1.2,sl=stop,tp=None,policy=policy())
        with self.assertRaises(CopyRejected):
            plan_follower(self.mt5,account=self.account,symbol='EURUSD',
                 kind='buy',entry=1.2,sl=0.1,tp=None,policy=policy('fixed_amount',1))
    def test_live_account_and_missing_margin_block_all_requests(self):
        self.account.trade_mode=2
        with self.assertRaises(CopyRejected):
            plan_follower(self.mt5,account=self.account,symbol='EURUSD',
                          kind='buy',entry=1.2,sl=1.1,tp=None,policy=policy())
        self.account.trade_mode=0
        self.mt5.order_calc_margin=lambda *args:None
        with self.assertRaises(CopyRejected):
            plan_follower(self.mt5,account=self.account,symbol='EURUSD',
                          kind='buy',entry=1.2,sl=1.1,tp=None,policy=policy())
    def test_execution_requires_local_opt_in_and_exact_destination(self):
        v=plan_follower(self.mt5,account=self.account,symbol='EURUSD',kind='buy_limit',
                         entry=1.2,sl=1.1,tp=1.3,policy=policy())
        grant=ExecutionGrant('owner','src','follower',50001,'Broker-Demo','id-1',True,False)
        ledger=MockLedger()
        term=NS(connected=True)
        kwargs=dict(grant=grant,expected_slot='C:/A/terminal64.exe',
                    actual_slot='C:/A/terminal64.exe',account=self.account,terminal=term,
                    planned=v,now_ms=100000,event_created_ms=99000,ledger=ledger)
        with self.assertRaises(CopyRejected):
            execute_demo_once(self.mt5,**kwargs)
        self.mt5.order_send.assert_not_called()
        from dataclasses import replace
        kwargs['grant']=replace(grant,locally_armed=True)
        kwargs['actual_slot']='C:/B/terminal64.exe'
        with self.assertRaises(CopyRejected):
            execute_demo_once(self.mt5,**kwargs)
        kwargs['actual_slot']='C:/A/terminal64.exe'
        output=execute_demo_once(self.mt5,**kwargs)
        self.assertTrue(output['accepted'])
        self.assertEqual(ledger.states['id-1'][0],'acknowledged')
        with self.assertRaises(CopyRejected):
            execute_demo_once(self.mt5,**kwargs)
        self.assertEqual(self.mt5.order_send.call_count,1)
    def test_ambiguous_broker_response_never_retries(self):
        plan=plan_follower(self.mt5,account=self.account,symbol='EURUSD',kind='buy',
                           entry=1.2,sl=1.1,tp=None,policy=policy())
        grant=ExecutionGrant('owner','s','f',50001,'Broker-Demo','evt',True,True)
        ledger=MockLedger()
        self.mt5.order_send.side_effect=TimeoutError('ambiguous')
        args=dict(grant=grant,expected_slot='slot',actual_slot='slot',
                  account=self.account,terminal=NS(connected=True),planned=plan,
                  now_ms=4000,event_created_ms=3900,ledger=ledger)
        with self.assertRaises(CopyRejected):
            execute_demo_once(self.mt5,**args)
        self.assertEqual(ledger.states['evt'][0],'unknown')
        with self.assertRaises(CopyRejected):
            execute_demo_once(self.mt5,**args)
        self.assertEqual(self.mt5.order_send.call_count,1)
    def test_stale_commands_do_not_transmit(self):
        plan=plan_follower(self.mt5,account=self.account,symbol='EURUSD',kind='buy',
                           entry=1.2,sl=1.1,tp=None,policy=policy())
        with self.assertRaises(CopyRejected):
            execute_demo_once(self.mt5,grant=ExecutionGrant('owner','s','f',50001,'Broker-Demo','evt',True,True),
                expected_slot='slot',actual_slot='slot',account=self.account,terminal=NS(connected=True),
                planned=plan,now_ms=10000,event_created_ms=1000,ledger=MockLedger())
        self.mt5.order_send.assert_not_called()
if __name__=='__main__':
    unittest.main()
