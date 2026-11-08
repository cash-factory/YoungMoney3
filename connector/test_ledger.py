from ledger import closed_legs
import unittest

def deal(ticket, direction, size, price, profit=0, fee=0):
    return dict(ticket=ticket,type=direction,volume=size,price=price,profit=profit,commission=fee,
                fee=0,swap=0,time_msc=ticket*1000,position_id=17,symbol="DEMO")

class TestLedger(unittest.TestCase):
    def test_partial_close_and_reversal(self):
        events=list(closed_legs([deal(1,0,2,100,fee=-2),deal(2,1,1,95,-5,-1),
                                 deal(3,1,2,110,10,-2),deal(4,0,1,108,2,-1)],1000))
        self.assertEqual([e["fields"]["pnl"] for e in events],[-7,8,0])
        self.assertEqual(events[-1]["fields"]["direction"],"short")
    def test_preexisting_position_costs_already_in_opening_balance(self):
        events=list(closed_legs([deal(1,0,1,100,fee=-2),deal(2,1,1,105,5,-1)],2000))
        self.assertEqual(events[0]["fields"]["pnl"],4)
