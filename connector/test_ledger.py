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
    def test_open_order_sl_tp_and_close_order_levels_are_not_confused(self):
        entry=deal(1,0,1,100)
        entry["order"]=101
        close=deal(2,1,1,105,5)
        close["order"]=102
        close["reason"]=4
        close["comment"]="closed at target"
        orders={101:{"ticket":101,"sl":98.0,"tp":106.0},
                102:{"ticket":102,"sl":101.0,"tp":105.0}}
        record=list(closed_legs([entry,close],0,orders))[0]["fields"]
        self.assertEqual(record["stop_loss"],98.0)
        self.assertEqual(record["take_profit"],106.0)
        self.assertEqual(record["broker_details"]["closing_order_sl"],101.0)
        self.assertEqual(record["broker_details"]["closing_order_tp"],105.0)
        self.assertEqual(record["broker_details"]["close_reason"],4)
        self.assertEqual(record["broker_details"]["entry_order_ticket"],"101")
    def test_preexisting_position_costs_already_in_opening_balance(self):
        events=list(closed_legs([deal(1,0,1,100,fee=-2),deal(2,1,1,105,5,-1)],2000))
        self.assertEqual(events[0]["fields"]["pnl"],4)
