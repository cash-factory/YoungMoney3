"""Safe terminal installation cloning tests: no actual MetaTrader accounts needed."""
from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path

from terminal_factory import TerminalCopyError, create_terminal

class TerminalFactoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "BrokerMT5"
        self.source.mkdir()
        self.exe = self.source / "terminal64.exe"
        self.exe.write_bytes(b"fake executable fixture")
        (self.source / "support.dll").write_bytes(b"library")
        (self.source / "terminal.ico").write_bytes(b"icon")
        for directory, filename in (
            ("config", "accounts.dat"),
            ("bases", "history.dat"),
            ("profiles", "common.ini"),
            ("logs", "terminal.log"),
            ("MQL5", "AutoTrader.ex5"),
            ("tester", "secret.dat"),
            ("cache", "broker.db"),
        ):
            target = self.source / directory
            target.mkdir()
            (target / filename).write_bytes(b"SENSITIVE")
        (self.source / "secrets.dat").write_bytes(b"passwords")
        self.managed = self.root / "managed"

    def test_copy_isolated_two_named_portable_directories_without_account_secrets(self):
        first = create_terminal(self.exe, self.managed, "Exness Demo 1")
        second = create_terminal(self.exe, self.managed, "FundedNext Demo 2")
        self.assertNotEqual(first.parent, second.parent)
        self.assertIn("exness-demo-1", first.parent.name)
        self.assertIn("fundednext-demo-2", second.parent.name)
        for path in (first, second):
            self.assertEqual(path.read_bytes(), self.exe.read_bytes())
            self.assertTrue((path.parent / "support.dll").is_file())
            self.assertFalse((path.parent / "secrets.dat").exists())
            for folder in ("config", "bases", "profiles", "logs", "MQL5", "tester", "cache"):
                self.assertFalse((path.parent / folder).exists())
            marker = json.loads((path.parent / ".ym-managed.json").read_text())
            self.assertTrue(marker["generated_blank_profile"])
        self.assertTrue((self.source / "config" / "accounts.dat").exists())

    def test_source_cannot_be_replaced_or_cloned_into_itself(self):
        with self.assertRaises(TerminalCopyError):
            create_terminal(self.exe, self.source / "nested", "Impossible")
        self.assertFalse((self.source / "nested").exists())
        with self.assertRaises(TerminalCopyError):
            create_terminal(self.source / "doesnotexist.exe", self.managed, "Not MT5")

    def test_symlinks_and_junctions_not_copied(self):
        secret = self.root / "do-not-copy.txt"
        secret.write_text("another account password")
        try:
            (self.source / "shortcut.dll").symlink_to(secret)
        except (OSError, NotImplementedError):
            self.skipTest("This Windows configuration cannot create symlinks")
        folder = create_terminal(self.exe, self.managed, "Demo").parent
        self.assertFalse((folder / "shortcut.dll").exists())
        self.assertNotIn(b"another account password", b"".join(
            item.read_bytes() for item in folder.iterdir() if item.is_file()))

    def test_cancel_does_not_leave_partial_copy(self):
        cancel = threading.Event()
        cancel.set()
        with self.assertRaises(TerminalCopyError):
            create_terminal(self.exe, self.managed, "Cancelled", cancel=cancel)
        self.assertFalse(self.managed.exists())

    def test_reject_empty_source_executable(self):
        self.exe.write_bytes(b"")
        with self.assertRaises(TerminalCopyError):
            create_terminal(self.exe, self.managed, "Empty")

if __name__ == "__main__":
    unittest.main()
