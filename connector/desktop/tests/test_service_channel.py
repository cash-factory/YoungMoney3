"""The packaged channel is fixed at build time; the OS environment cannot redirect accounts."""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'bridge'))
from service_channel import CHANNEL, ORIGINS, SERVICE_ORIGIN, SESSION_NAMESPACE, select_channel
from account_discovery import ORIGIN as DISCOVERY_ORIGIN
from desktop_bridge import SESSIONS


class ChannelSafetyTests(unittest.TestCase):
    def test_native_capture_and_discovery_use_identical_pinned_staging(self):
        self.assertEqual(CHANNEL,'staging')
        self.assertEqual(SERVICE_ORIGIN,ORIGINS['staging'])
        self.assertEqual(DISCOVERY_ORIGIN,SERVICE_ORIGIN)
        self.assertEqual(SESSION_NAMESPACE,'staging-gui')
        self.assertEqual(SESSIONS.parent.name,SESSION_NAMESPACE)
        self.assertNotEqual(ORIGINS['staging'],ORIGINS['production'])
        self.assertTrue(all(x.startswith('https://') for x in ORIGINS.values()))

    def test_runtime_cannot_switch_to_production_or_untrusted_host(self):
        for value in ('production','unknown','https://attacker.invalid',''):
            with self.subTest(request=value):
                with self.assertRaisesRegex(RuntimeError,'pinned'):
                    select_channel(value)
        with patch.dict(os.environ,{'YMFX_CONNECTOR_CHANNEL':'production'}):
            with self.assertRaisesRegex(RuntimeError,'pinned'):
                select_channel()
        self.assertEqual(select_channel('staging')[1],SERVICE_ORIGIN)


if __name__ == '__main__':
    unittest.main()
