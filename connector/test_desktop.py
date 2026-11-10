import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app_runtime import EngineProcess, canonical_origin, load_settings, save_settings


class DesktopRuntimeTests(unittest.TestCase):
    def test_origin_cannot_include_credentials_or_a_page(self):
        for value in ("http://example.test", "https://user:secret@example.test", "https://example.test/path"):
            with self.assertRaises(ValueError):
                canonical_origin(value)
        self.assertEqual(canonical_origin("https://staging.example.test/"), "https://staging.example.test")

    def test_settings_are_scoped_local_preferences_without_credentials(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"LOCALAPPDATA": temporary}):
            save_settings("https://staging.example.test", [str(Path("C:/dedicated/terminal64.exe"))])
            stored = load_settings()
            self.assertEqual(stored["terminals"], [str(Path("C:/dedicated/terminal64.exe"))])
            self.assertEqual(set(stored), {"origin", "terminals"})

    @unittest.skipUnless(os.name == "nt", "Windows process flags")
    def test_pairing_code_uses_stdin_and_stop_file_requests_graceful_exit(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"LOCALAPPDATA": temporary}):
            terminal = Path(temporary) / "terminal64.exe"
            terminal.touch()
            with patch("app_runtime.subprocess.Popen") as launch:
                launch.return_value.poll.return_value = None
                engine = EngineProcess()
                code = "0123456789abcdef" * 2
                engine.start("https://staging.example.test", [str(terminal)], code)
                args = launch.call_args.args[0]
                self.assertNotIn(code, args)
                self.assertIn("--pair-code-stdin", args)
                launch.return_value.stdin.write.assert_called_once_with((code + "\n").encode())
                engine.pause()
                self.assertTrue(engine.stop_file.exists())

