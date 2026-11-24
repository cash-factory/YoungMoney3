"""A trader can understand copying permission without entering a broker order."""
import sys
import tkinter as tk
import unittest
import time

from trader_ui import permission_summary, trader_message, TradeJourney


class LanguageTests(unittest.TestCase):
    def test_copy_approval_is_explicit_and_never_mistaken_for_arming(self):
        self.assertIn("not allowed",permission_summary(False,"none")[0])
        state,detail=permission_summary(True,"demo")
        self.assertIn("Demo permission",state)
        self.assertIn("website",detail)
        live,detail=permission_summary(True,"live")
        self.assertIn("Live permission",live)
        self.assertIn("switched off",detail)
        self.assertIn("Choose",permission_summary(True,"demo",False)[0])

    def test_trader_error_messages_do_not_expose_implementation_details(self):
        for code in ("IPC timeout", "(-10005)", "terminal_ipc_timeout"):
            self.assertIn("MetaTrader",trader_message(code))
            self.assertNotIn(code,trader_message(code))
        self.assertIn("MetaTrader account",trader_message("wrong_terminal"))
        self.assertIn("retry",trader_message("Broker capture error (ValueError at connect.py:345)"))
        self.assertIn("approved",trader_message("account_bound_execution_permission_missing"))


@unittest.skipUnless(sys.platform=="win32", "Actual native visual geometry runs on Windows")
class AnimatedRouteTests(unittest.TestCase):
    def setUp(self):
        self.root=tk.Tk()
        self.root.withdraw()
        self.addCleanup(self.root.destroy)

    def test_motion_finishes_and_can_be_disabled_without_background_timer(self):
        flow=TradeJourney(self.root,motion=lambda:True)
        flow.pack()
        self.root.update()
        flow.set_state("approved")
        self.assertIsNotNone(flow._job)
        deadline=time.monotonic()+2
        while flow._job is not None and time.monotonic()<deadline:
            self.root.update()
            time.sleep(.02)
        self.assertIsNone(flow._job)
        self.assertEqual(flow.state,"approved")
        flow.set_state("off")
        self.assertIsNone(flow._job)
        flow.destroy()

    def test_reduced_motion_draws_state_without_animation(self):
        flow=TradeJourney(self.root,motion=lambda:False)
        flow.pack()
        flow.set_state("approved")
        self.assertEqual(flow._progress,1)
        self.assertIsNone(flow._job)
        self.assertGreater(len(flow.find_all()),8)


if __name__=="__main__":
    unittest.main()
