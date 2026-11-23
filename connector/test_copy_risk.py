"""Deterministic follower sizing tests: all price/risk math is broker-native."""
import unittest
from types import SimpleNamespace
from copy_risk import calculate, floor_volume, CopyRiskError

class FakeMT5:
    ORDER_TYPE_BUY=0
    ORDER_TYPE_SELL=1
    def __init__(self,profit=-100):
        self.profit=profit
        self.selected=[]
    def symbol_info(self,symbol):
        return SimpleNamespace(volume_min=0.01,volume_max=30,volume_step=0.01)
    def symbol_select(self,symbol,enable):
        self.selected.append(symbol)
        return True
    def order_calc_profit(self,side,symbol,lots,entry,sl):
        return self.profit

class RiskTests(unittest.TestCase):
    def setUp(self):
        self.mt5=FakeMT5()
        self.account=SimpleNamespace(equity=2000,currency='USD')
        self.common=dict(direction='buy',entry=1.10,stop=1.09,
            source_lots=1,source_equity=1000,source_currency='USD',
            max_lots=5)
    def test_percent_risk_uses_follower_equity_and_broker_loss_per_lot(self):
        r=calculate(self.mt5,self.account,'EURUSD',sizing_mode='risk_pct_equity',
                    sizing_value=2,**self.common)
        self.assertEqual(r['lots'],0.4)
        self.assertEqual(r['risk_amount'],40)
        self.assertEqual(r['risk_pct_equity'],2)
    def test_fixed_risk_in_follower_account_currency(self):
        account=SimpleNamespace(equity=1500,currency='EUR')
        r=calculate(self.mt5,account,'EURUSD',sizing_mode='fixed_risk',
                    sizing_value=25,**self.common)
        self.assertEqual(r['lots'],0.25)
        self.assertEqual(r['account_currency'],'EUR')
    def test_equity_ratio_and_source_currency(self):
        r=calculate(self.mt5,self.account,'EURUSD',sizing_mode='equity_ratio',
                    sizing_value=1,**self.common)
        self.assertEqual(r['lots'],2.0)
        with self.assertRaisesRegex(CopyRiskError,'cross_currency'):
            calculate(self.mt5,SimpleNamespace(equity=2000,currency='EUR'),
                      'EURUSD',sizing_mode='equity_ratio',sizing_value=1,**self.common)
    def test_broker_volume_step_is_not_rounded_up(self):
        self.assertEqual(float(floor_volume('0.213',0.1,4,0.05,1)),0.20)
        with self.assertRaisesRegex(CopyRiskError,'risk_budget_below_broker_minimum'):
            floor_volume(0.04,0.1,4,0.05,1)
    def test_reject_no_stop_wrong_side_bad_broker_loss(self):
        with self.assertRaises(CopyRiskError):
            calculate(self.mt5,self.account,'EURUSD',sizing_mode='fixed_risk',
                      sizing_value=25,**{**self.common,'stop':1.11})
        with self.assertRaisesRegex(CopyRiskError,'broker_stop_loss_valuation_unavailable'):
            calculate(FakeMT5(profit=None),self.account,'EURUSD',sizing_mode='fixed_risk',
                      sizing_value=25,**self.common)
    def test_risk_caps_and_no_minimum_lot_force(self):
        with self.assertRaisesRegex(CopyRiskError,'fixed_risk_above'):
            calculate(self.mt5,self.account,'EURUSD',sizing_mode='fixed_risk',
                      sizing_value=500,**self.common)
        with self.assertRaisesRegex(CopyRiskError,'risk_budget_below'):
            calculate(self.mt5,self.account,'EURUSD',sizing_mode='fixed_risk',
                      sizing_value=0.25,**self.common)

if __name__=='__main__':unittest.main()
