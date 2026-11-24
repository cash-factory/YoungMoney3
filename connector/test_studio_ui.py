"""Presentation regressions: no MT5 calls, pairing request or account settings writes."""
import importlib.util
import sys
import tempfile
import time
import tkinter as tk
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from studio_ui import action_rows, blend, AnimatedButton, restart_wait_seconds


class ActionLayoutTests(unittest.TestCase):
    def test_quick_setup_wraps_complete_labels_in_narrow_content(self):
        requested = [154, 172, 190]
        rows = action_rows(430, requested, minimum=164)
        self.assertEqual(rows, [[0, 1], [2]])
        for row in rows:
            self.assertLessEqual(sum(max(164, requested[i]) for i in row) + 8 * (len(row) - 1), 430)
        self.assertEqual(action_rows(800, requested, minimum=164), [[0, 1, 2]])

    def test_unexpected_service_restart_has_bounded_backoff(self):
        self.assertEqual(restart_wait_seconds(0, 0), 3)
        self.assertEqual(restart_wait_seconds(3, 2), 6)
        self.assertEqual(restart_wait_seconds(60, 2), 60)
        self.assertEqual(restart_wait_seconds(48, 100), 3)

    def test_dpi_scaled_labels_drive_wrapping_instead_of_fixed_button_width(self):
        self.assertEqual(action_rows(500, [260, 270, 280]), [[0], [1], [2]])
        self.assertEqual(blend("#000000", "#ffffff", .5), "#808080")
        self.assertEqual(blend("#112233", "#ffffff", -5), "#112233")


@unittest.skipUnless(sys.platform == "win32", "Actual Tk geometry is verified on Windows")
class ConnectorPresentationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # Import the actual UI with a broker boundary that cannot make requests.
        boundary = SimpleNamespace(keyring=SimpleNamespace(set_keyring=lambda _value: None,
                                                           get_password=lambda *_args: None),
                                   WinVaultKeyring=lambda: None,
                                   main=lambda *_args, **_kwargs: self.fail("UI test attempted capture"))
        spec = importlib.util.spec_from_file_location("connector_ui_fixture", Path(__file__).with_name("connector_gui.py"))
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"connect": boundary}):
            spec.loader.exec_module(module)
        module.SETTINGS = Path(self.temp.name) / "preferences.json"
        self.staging_url = module.STAGING_URL
        self.browser = module.webbrowser
        self.settings = module.SETTINGS
        try:
            self.root = tk.Tk()
        except tk.TclError as error:
            self.skipTest(str(error))
        self.root.withdraw()
        self.root.attributes("-alpha", 0)
        self.addCleanup(self.root.destroy)
        self.app = module.ConnectorApp(self.root)
        self.app.motion_var.set(False)
        self.root.deiconify()
        self._settle()

    def _settle(self):
        for _ in range(5):
            self.root.update_idletasks()
            self.root.update()

    def assert_actions_fit(self, group):
        left, right = group.winfo_rootx(), group.winfo_rootx() + group.winfo_width()
        for button in group.buttons:
            self.assertGreaterEqual(button.winfo_x(), 0)
            self.assertGreaterEqual(button.winfo_width(), button.winfo_reqwidth(), button.cget("text"))
            self.assertGreaterEqual(button.winfo_rootx(), left)
            self.assertLessEqual(button.winfo_rootx() + button.winfo_width(), right + 1)
            self.assertGreaterEqual(button.winfo_height(), 40)

    def test_resizing_keeps_quick_setup_pairing_and_session_actions_readable(self):
        for width, height in [(720, 560), (780, 600), (1024, 768), (1440, 900)]:
            with self.subTest(size=(width, height)):
                self.root.geometry(f"{width}x{height}")
                self.app.show_page("overview")
                self._settle()
                self.assert_actions_fit(self.app.quick_setup_actions)
                footer = self.app.sidebar_footer
                self.assertLessEqual(footer.winfo_rooty() + footer.winfo_height(),
                                     self.root.winfo_rooty() + self.root.winfo_height() + 1)
                self.app._page_canvases["overview"].yview_moveto(1)
                self._settle()
                last = self.app.quick_setup_actions.buttons[-1]
                canvas = self.app._page_canvases["overview"]
                self.assertLessEqual(last.winfo_rooty() + last.winfo_height(), canvas.winfo_rooty() + canvas.winfo_height() + 1)
                # The transparent test window is deliberately excluded from
                # Windows pointer hit-testing. Tk's actual child stacking order
                # still proves the row windows cannot cover native buttons.
                siblings = self.app.quick_setup_actions.winfo_children()
                row = last.pack_info()["in"]
                self.assertGreater(siblings.index(last), siblings.index(row),
                                   "Quick setup action must remain above its row frame")
                self.app.show_page("sessions")
                self._settle()
                self.assert_actions_fit(self.app.session_tools)
                self.assert_actions_fit(self.app.session_actions)
                self.app.show_page("copy")
                self._settle()
                self.assert_actions_fit(self.app.copy_action_buttons)
                self.assert_actions_fit(self.app.copy_web_actions)
                self.assertIn("copy", self.app.pages)
                self.app.show_page("pair")
                self._settle()
                self.assert_actions_fit(self.app.code_actions)
                self.assertGreaterEqual(self.app.code_input.winfo_width(), 300)
        self.assertIsNone(self.app.worker)
        self.assertFalse(self.settings.exists(), "Presentation inspection must not write preferences")

    def test_pair_confirmation_starts_pc_service_without_any_configured_terminals(self):
        self.assertEqual(self.app.store.all_terminals(), [])
        with patch.object(self.app, "_start_worker") as start:
            self.app._event({"state":"paired"})
            self.app._event({"state":"worker-exit","mode":"pair"})
            self.app.poll()
            start.assert_called_once_with([self.staging_url])
        self.app._event({"state":"pc-online","device":"fixture","setup":"ready"})
        with patch.object(self.browser, "open") as navigate:
            self.app.add_account()
            self.assertIn("?addAccount=fixture#mt5",navigate.call_args.args[0])

    def test_capture_exit_retries_except_manual_stop_or_revocation(self):
        self.app.paired = True
        self.app.busy_since = time.monotonic() - 1
        self.app._event({"state": "worker-exit", "mode": "capture"})
        self.assertIsNotNone(self.app.restart_due)
        with patch.object(self.app, "start") as start:
            self.app.restart_due = time.monotonic() - 1
            self.app.poll()
            start.assert_called_once()
        self.app.busy_since = time.monotonic() - 1
        self.app._event({"state": "worker-exit", "mode": "capture"})
        self.app.stop()
        self.assertIsNone(self.app.restart_due)
        self.app._event({"state": "worker-exit", "mode": "capture"})
        self.assertIsNone(self.app.restart_due)
        self.app.stop_event.clear()
        self.app._event({"state": "pc-revoked"})
        self.app._event({"state": "worker-exit", "mode": "capture"})
        self.assertIsNone(self.app.restart_due)
        self.app.stop_event.set()
        self.app._event({"state": "pc-identity-conflict"})
        self.app._event({"state": "worker-exit", "mode": "capture"})
        self.assertEqual(self.app.pc_state, "pc-identity-conflict")
        self.assertIn("Duplicate PC identity", self.app.status_var.get(),
                      "The identity-conflict explanation must survive a safe worker shutdown.")
        self.assertIsNone(self.app.restart_due)

    def test_trader_guide_shows_real_pages_and_can_skip(self):
        self.app.show_page("help")
        self.app._tour_start()
        self.assertEqual(self.app.current_page, "overview")
        self.assertEqual(self.app.tour_index, 0)
        self.assertTrue(self.app.tour_strip.winfo_manager())
        self.app._tour_next()
        self.assertEqual(self.app.current_page, "pair")
        self.app._tour_next()
        self.assertEqual(self.app.current_page, "sessions")
        self.app._tour_next()
        self.assertEqual(self.app.current_page, "copy")
        self.app._tour_back()
        self.assertEqual(self.app.current_page, "sessions")
        self.app._tour_end()
        self.assertEqual(self.app.tour_index, -1)
        self.assertFalse(self.app.tour_strip.winfo_manager())
        self.assertIsNone(self.app.worker)
        self.assertFalse(self.settings.exists())

    def test_quick_setup_navigation_and_motion_toggle_do_not_start_capture(self):
        self.app.quick_setup_actions.buttons[0].invoke()
        self._settle()
        self.assertEqual(self.app.current_page, "pair")
        self.app.show_page("copy")
        self._settle()
        self.assertEqual(self.app.current_page, "copy")
        self.assertEqual(self.app.copy_account_choice.get(), "")
        self.app._load_copy_permission()
        self.assertIn("Choose",self.app.copy_permission_var.get())
        self.app.motion_var.set(False)
        self.app._refresh_motion()
        for art in self.app.header_art.values():
            self.assertIsNone(art._job)
        button = self.app.quick_setup_actions.buttons[0]
        self.assertIsInstance(button, AnimatedButton)
        button._transition("#554455")
        self.assertIsNone(button._job, "Reduced motion must apply the final state without an animation timer")
        self.assertEqual(button.cget("bg"), "#554455")
        self.app.motion_var.set(True)
        button._transition("#665566")
        self.assertIsNotNone(button._job, "Enabled motion should schedule bounded hover frames")
        deadline = time.monotonic() + 1
        while button._job is not None and time.monotonic() < deadline:
            self.root.update()
            time.sleep(.01)
        self.assertIsNone(button._job, "Hover transition must finish instead of animating forever")
        self.assertEqual(button.cget("bg"), "#665566")
        self.app.code_var.set("a" * 32)
        self.assertEqual(str(self.app.pair_button.cget("state")), "normal")
        self.app.code_var.set("")
        self.assertEqual(str(self.app.pair_button.cget("state")), "disabled")
        self.assertIsNone(self.app.worker)
        self.assertFalse(self.settings.exists())


if __name__ == "__main__":
    unittest.main()
