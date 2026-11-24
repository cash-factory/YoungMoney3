"""Presentation regressions: no MT5 calls, pairing request or account settings writes."""
import importlib.util
import os
import faulthandler
import _tkinter
import sys
import tempfile
import time
import tkinter as tk
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from studio_ui import action_rows, blend, AnimatedButton, restart_wait_seconds

# Give the Windows review an actionable Python stack instead of silently
# running until the CI job timeout if a native layout event loop stalls.
if os.environ.get("GITHUB_ACTIONS") == "true":
    faulthandler.dump_traceback_later(35, repeat=True)



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
        # The optional bootstrap theme owns a global Tk style singleton.
        # Repeated test-root destruction cannot exercise that singleton safely;
        # the separate frozen-app and screenshot tests exercise the real theme.
        with patch.dict(os.environ, {"YMFX_TK_UNIT_TEST": "1"}):
            self.app = module.ConnectorApp(self.root)
        self.app.motion_var.set(False)
        if os.environ.get("GITHUB_ACTIONS") == "true":
            from collections import Counter
            counts=Counter()
            names=Counter()
            def count_layout_event(event):
                counts[str(event.widget.winfo_class())]+=1
                names[str(event.widget)]+=1
                total=sum(counts.values())
                if total in (250,1000,5000,15000):
                    print("Tk layout activity",total,counts.most_common(8),flush=True)
                    if total>=1000:
                        print("Tk hotspot widgets",names.most_common(15),flush=True)
            self.root.bind_all("<Configure>",count_layout_event,add="+")
            self.root.after(7000,lambda:print(
                "Tk layout snapshot",sum(counts.values()),counts.most_common(10),
                flush=True))
        self.root.deiconify()
        self._settle()

    def _settle(self):
        # Tk.update() has no event budget: a newly introduced self-scheduling
        # layout callback can keep it inside the native event loop forever.
        # Drain real events until quiescent, but *fail* if the UI keeps
        # generating work instead of silently passing a frozen desktop.
        for _ in range(2000):
            if not self.root.tk.dooneevent(_tkinter.DONT_WAIT):
                return
        self.fail("The desktop kept scheduling new UI events instead of settling.")

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
                self.assertEqual(last.winfo_manager(),"grid")
                self.assertIn("row",last.grid_info(),
                              "Quick setup action must be directly clickable in its stable grid")
                self.app.show_page("sessions")
                self._settle()
                self.assert_actions_fit(self.app.session_tools)
                self.assertFalse(self.app.account_detail.winfo_manager(),
                                 "No account should show trade controls before selection")
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

    def test_first_time_trader_sees_real_actions_before_explanations(self):
        self.app.show_page("overview")
        self.assertEqual(self.app.hero_pc_button.cget("text"),"Connect this computer")
        self.app.show_page("sessions")
        self._settle()
        self.assertTrue(self.app.empty_accounts.winfo_manager())
        self.assertFalse(self.app.session_table.get_children())
        self.assertFalse(self.app.account_detail.winfo_manager())
        self.app.show_page("copy")
        self._settle()
        self.assertFalse(self.app.copy_explanation.winfo_manager())
        self.assertTrue(self.app.copy_add_account_button.winfo_manager())
        canvas=self.app._page_canvases["copy"]
        self.assertLessEqual(
            self.app.copy_account_combo.winfo_rooty()+self.app.copy_account_combo.winfo_height(),
            canvas.winfo_rooty()+canvas.winfo_height()+1,
            "The account choice must be visible before the trader scrolls.")
        self.app._toggle_copy_explanation()
        self.assertTrue(self.app.copy_explanation.winfo_manager())
        self.assertEqual(self.app.copy_explain_button.cget("text"),"Hide explanation")
        self.app._toggle_copy_explanation()
        self.assertFalse(self.app.copy_explanation.winfo_manager())
        self.assertIsNone(self.app.worker)
        self.assertFalse(self.settings.exists())

    def test_account_card_expands_only_when_trader_selects_it(self):
        terminal=Path(self.temp.name)/"terminal64.exe"
        terminal.write_bytes(b"review fixture only")
        record={"id":"demo-account-1","name":"Demo account", "terminal":str(terminal),
                "enabled":True}
        with patch.object(self.app.store,"snapshot",return_value=[record]):
            self.app.refresh_sessions()
            self._settle()
            self.assertFalse(self.app.empty_accounts.winfo_manager())
            self.assertFalse(self.app.account_detail.winfo_manager())
            self.assertTrue(self.app.session_table.exists(record["id"]))
            self.app._select_account(record["id"])
            self._settle()
            self.assertTrue(self.app.account_detail.winfo_manager())
            self.assertIn("Demo account",self.app.selected_details_var.get())
            self.app.account_search_var.set("unrelated broker")
            self._settle()
            self.assertTrue(self.app.no_matching_accounts.winfo_manager())
            self.assertFalse(self.app.account_detail.winfo_manager())
            self.app.account_search_var.set("demo")
            self._settle()
            self.assertFalse(self.app.no_matching_accounts.winfo_manager())
            self.assertTrue(self.app.account_detail.winfo_manager())
            self.assert_actions_fit(self.app.session_actions)
            self.assert_actions_fit(self.app.copy_controls)
            self.app._hide_account_detail()
            self._settle()
            self.assertFalse(self.app.account_detail.winfo_manager())
        self.assertFalse(self.settings.exists())

    def test_help_answers_are_optional_instead_of_always_visible(self):
        self.app.show_page("help")
        self._settle()
        header,answer=self.app.help_items[0]
        self.assertFalse(answer.winfo_manager())
        header.invoke()
        self._settle()
        self.assertTrue(answer.winfo_manager())
        header.invoke()
        self._settle()
        self.assertFalse(answer.winfo_manager())

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
