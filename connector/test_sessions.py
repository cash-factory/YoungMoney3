"""Safe multi-session profile unit tests: no MT5 account or Windows secrets needed."""
import json
import tempfile
import threading
import unittest
from pathlib import Path

from sessions import SessionError, SessionStore


class SessionStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.settings = self.folder / "preferences.json"
        self.a = self.folder / "Demo1" / "terminal64.exe"
        self.b = self.folder / "Demo2" / "terminal64.exe"
        for path in (self.a, self.b):
            path.parent.mkdir()
            path.touch()

    def test_two_accounts_one_app_independent_pause_and_restart(self):
        store = SessionStore(self.settings)
        first = store.add(str(self.a), "Exness demo")
        second = store.add(str(self.b), "Weltrade demo")
        self.assertEqual(len(store.active_terminals()), 2)
        store.set_enabled(first["id"], False)
        self.assertEqual(store.active_terminals(), [str(self.b)])
        store.arm(second["id"])
        self.assertEqual(store.armed_terminal(), str(self.b))
        self.assertEqual(json.loads(self.settings.read_text())["version"], 1)
        reloaded = SessionStore(self.settings)
        self.assertEqual([s["name"] for s in reloaded.snapshot()], ["Exness demo", "Weltrade demo"])
        self.assertEqual(reloaded.active_terminals(), [str(self.b)])
        self.assertIsNone(reloaded.armed_terminal(), "Never resume an implicit account claim after restart.")

    def test_legacy_terminal_list_migrates_without_deleting_credentials(self):
        self.settings.write_text(json.dumps({"terminals": [str(self.a), str(self.b)]}))
        legacy = SessionStore(self.settings)
        self.assertEqual(len(legacy.snapshot()), 2)
        self.assertEqual(legacy.snapshot()[0]["name"], "Session 1")
        legacy.rename(legacy.snapshot()[0]["id"], "Broker A")
        self.assertEqual(SessionStore(self.settings).snapshot()[0]["name"], "Broker A")
        self.assertNotIn("token", self.settings.read_text())
        self.assertNotIn("password", self.settings.read_text())

    def test_duplicate_terminal_rejected_and_invalid_file_rejected(self):
        store = SessionStore(self.settings)
        store.add(str(self.a))
        with self.assertRaises(SessionError):
            store.add(str(self.a))
        with self.assertRaises(SessionError):
            store.add(str(self.folder / "missing" / "terminal64.exe"))
        with self.assertRaises(SessionError):
            store.add(str(self.b.parent / "other.exe"))

    def test_atomic_settings_preserved_if_json_corrupt(self):
        self.settings.write_text("{invalid data", encoding="utf-8")
        with self.assertRaises(SessionError):
            SessionStore(self.settings)
        self.assertEqual(self.settings.read_text(), "{invalid data")

    def test_pausing_clears_armed_and_removing_only_changes_preferences(self):
        store = SessionStore(self.settings)
        first = store.add(str(self.a))
        store.arm(first["id"])
        store.set_enabled(first["id"], False)
        self.assertIsNone(store.armed_terminal())
        store.set_enabled(first["id"], True)
        store.arm(first["id"])
        store.remove(first["id"])
        self.assertIsNone(store.armed_terminal())
        self.assertTrue(self.a.exists(), "Removing a session must not delete the terminal.")

    def test_thread_safe_state_reads_during_gui_changes(self):
        store = SessionStore(self.settings)
        first = store.add(str(self.a))
        errors = []

        def reader():
            try:
                for _ in range(300):
                    store.snapshot()
                    store.active_terminals()
                    store.armed_terminal()
            except Exception as error:
                errors.append(error)

        worker = threading.Thread(target=reader)
        worker.start()
        for i in range(20):
            store.set_enabled(first["id"], bool(i % 2))
        worker.join()
        self.assertFalse(errors)


if __name__ == "__main__":
    unittest.main()
