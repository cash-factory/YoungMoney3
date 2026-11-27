"""Concurrent MT5 capture control tests without broker accounts or credentials."""
import sys
import unittest
import io
import urllib.error

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

    def test_eight_independent_account_workers_have_no_three_account_cap(self):
        # Planning-only test: real MT5 processes require separate Windows acceptance.
        rows=[row(f'link-{index}',f'C:/MT5/Account{index}/terminal64.exe')
              for index in range(8)]
        enabled=wanted_link_rows(rows,[item[1] for item in rows])
        self.assertEqual(len(enabled),8)
        self.assertEqual(set(enabled),{item[0] for item in rows})
        self.assertEqual(len({item[1] for item in enabled.values()}),8)
        for paused_index in (1,6):
            remaining=[item[1] for i,item in enumerate(rows) if i!=paused_index]
            selected=wanted_link_rows(rows,remaining)
            self.assertEqual(len(selected),7)
            self.assertNotIn(f'link-{paused_index}',selected)

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

    def test_http_evidence_conflict_reports_code_and_endpoint_without_secret_leak(self):
        secret = "CLIENT-SECRET-EXPOSE-ME-NOT"
        error = urllib.error.HTTPError(
            "https://fake.invalid/api/mt5/device/sync?token=" + secret,
            409, "reason includes " + secret, {},
            io.BytesIO(b'{"error":"Broker evidence changed for an existing ticket. Import halted; an audited correction is required."}'))
        error.capture_action = "sync"
        summary = safe_capture_error(error)
        self.assertEqual(
            summary,
            "Capture API sync returned HTTP 409 (immutable_broker_evidence_conflict).")
        self.assertNotIn(secret, summary)
        self.assertNotIn("https:", summary)
        self.assertNotIn("reason includes", summary)

    def test_http_pause_and_release_gate_receive_distinct_safe_categories(self):
        for http, action, message, expected in (
            (403, "sync", "Real-account capture is paused by the release gate.",
             "real_account_release_gate"),
            (403, "sync", "MT5 capture is paused by the administrator.",
             "administrator_capture_pause"),
            (423, "sync", "Monitoring is paused for this account.",
             "monitoring_paused"),
            (400, "sync", "Invalid broker cash scan checkpoint.",
             "cash_checkpoint_rejected"),
            (404, "sync", "Unknown link.", "link_not_found"),
        ):
            with self.subTest(http=http, category=expected):
                import json
                error = urllib.error.HTTPError(
                    "https://fake.invalid", http, "private",
                    {}, io.BytesIO(json.dumps({"error": message}).encode()))
                error.capture_action = action
                summary = safe_capture_error(error)
                self.assertIn("HTTP " + str(http), summary)
                self.assertIn(expected, summary)
                self.assertNotIn(message, summary)

    def test_non_json_and_unknown_http_response_do_not_leak_raw_text(self):
        for body, status in ((b"<html>password and account 1234</html>", 502),
                             (b'{"error":"Unknown secret broker trade 1234"}', 400)):
            error = urllib.error.HTTPError(
                "https://fake.invalid", status, "password 1234", {},
                io.BytesIO(body))
            error.capture_action = "untrusted/bad/path"
            summary = safe_capture_error(error)
            self.assertIn("unknown-action", summary)
            self.assertIn("HTTP " + str(status), summary)
            self.assertNotIn("password", summary)
            self.assertNotIn("1234", summary)
            self.assertNotIn("Unknown secret", summary)
            self.assertLess(len(summary), 170)

    @unittest.skipUnless(sys.platform == "win32",
                         "Multiprocessing integration is tested on Windows CI")
    def test_two_independent_windows_processes_start_without_mt5_or_secrets(self):
        report = run_parallel_smoke()
        self.assertEqual(report["parallel_spawn"], "ok")
        self.assertEqual(report["distinct_processes"], 2)
        self.assertFalse(report["broker_capture_started"])


if __name__ == "__main__":
    unittest.main()
