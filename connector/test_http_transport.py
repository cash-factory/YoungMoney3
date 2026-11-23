"""Capture HTTP diagnostics preserve action, status and request privacy."""
import io
import json
import unittest
import urllib.error
from unittest.mock import Mock, patch

import connect
from concurrent_capture import safe_capture_error


class TransportDiagnosticsTests(unittest.TestCase):
    def test_post_tags_action_and_raises_original_http_status_without_logging_secrets(self):
        origin = "https://staging.invalid"
        api_failure = urllib.error.HTTPError(
            origin+"/api/mt5/device/sync", 400, "Bad Request", {},
            io.BytesIO(b'{"error":"Invalid broker cash scan checkpoint."}'))
        fake_opener = Mock()
        fake_opener.open.side_effect = api_failure
        with patch.object(connect, "opener", fake_opener, create=True), \
             patch.object(connect, "origin", origin, create=True):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                connect.post("sync", {"link": "hidden-link", "events": []},
                             token="private-token-must-not-leak")
        self.assertIs(caught.exception, api_failure)
        self.assertEqual(caught.exception.code, 400)
        self.assertEqual(caught.exception.capture_action, "sync")
        summary = safe_capture_error(caught.exception)
        self.assertIn("Capture API sync returned HTTP 400", summary)
        self.assertIn("cash_checkpoint_rejected", summary)
        for value in ("hidden-link", "private-token-must-not-leak", origin):
            self.assertNotIn(value, summary)

    def test_successful_post_remains_unchanged(self):
        class Reply:
            def __enter__(self):
                return io.BytesIO(json.dumps({"ok": True}).encode())
            def __exit__(self, *args):
                return False
        fake_opener = Mock()
        fake_opener.open.return_value = Reply()
        with patch.object(connect, "opener", fake_opener, create=True), \
             patch.object(connect, "origin", "https://staging.invalid", create=True):
            outcome = connect.post("sync", {"events": []}, "secret")
        self.assertEqual(outcome, {"ok": True})


if __name__ == "__main__":
    unittest.main()
