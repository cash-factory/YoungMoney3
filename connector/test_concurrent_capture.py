"""Concurrent MT5 capture control tests without broker accounts or credentials."""
import sys
import unittest

from concurrent_capture import run_parallel_smoke, wanted_link_rows, safe_capture_error


def row(link, slot):
    return (link, slot, "111", "Demo", 0, 0, 0, None, 0)


class ParallelCaptureTests(unittest.TestCase):
    def test_each_link_owns_only_its_enabled_portable_terminal(self):
        rows = [row("one", "C:/MT5/A/terminal64.exe"),
                row("two", "C:/MT5/B/terminal64.exe")]
        enabled = wanted_link_rows(rows, ["C:/MT5/A/terminal64.exe"])
        self.assertEqual(set(enabled), {"one"})
        self.assertEqual(enabled["one"][1], "C:/MT5/A/terminal64.exe")
        self.assertEqual(set(wanted_link_rows(rows, [r[1] for r in rows])),
                         {"one", "two"})
        self.assertEqual(wanted_link_rows(rows, []), {})

    def test_error_summary_identifies_connector_line_without_leaking_values(self):
        from cash_history import backfill
        def synthetic_cash_failure():
            raise AttributeError("Sensitive broker password 12345 should never be logged")
        try:
            synthetic_cash_failure()
        except AttributeError as error:
            summary = safe_capture_error(error)
        self.assertIn("Broker capture error (AttributeError", summary)
        self.assertNotIn("Sensitive", summary)
        self.assertNotIn("password", summary)
        self.assertNotIn("12345", summary)
        self.assertNotIn("C:\\\\", summary)
        self.assertEqual(len(summary) < 120, True)

    @unittest.skipUnless(sys.platform == "win32",
                         "Multiprocessing integration is tested on Windows CI")
    def test_two_independent_windows_processes_start_without_mt5_or_secrets(self):
        report = run_parallel_smoke()
        self.assertEqual(report["parallel_spawn"], "ok")
        self.assertEqual(report["distinct_processes"], 2)
        self.assertFalse(report["broker_capture_started"])


if __name__ == "__main__":
    unittest.main()
