"""MT5 desktop presence/reconnection contract tests; no terminal or broker credentials needed."""
import io
import json
import threading
import unittest
import urllib.error

from presence import DevicePresence


class Installations:
    def __init__(self, found=True):
        self.found = found

    def sources(self):
        return ["C:/Program Files/MetaTrader 5/terminal64.exe"] if self.found else []


def http_error(status, payload=None):
    data=json.dumps(payload or {}).encode()
    return urllib.error.HTTPError("https://staging.invalid",status,"test",{},io.BytesIO(data))


class PresenceRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.stop=threading.Event()
        self.events=[]
        self.sent=[]
        self.setup=Installations()

    def make(self,request):
        def collect(payload):
            self.sent.append(payload)
            return request(payload)
        return DevicePresence(collect,self.setup,self.events.append,self.stop,
                              installation=lambda:"fixed-device-installation")

    def test_valid_checkin_uses_stable_identity_and_keeps_pause_policy(self):
        monitor=self.make(lambda _:{"device":"pc-1","name":"Desk PC","paused":["link-a"]})
        self.assertTrue(monitor.check())
        self.assertEqual(self.sent[0]["setup"],"ready")
        self.assertEqual(self.sent[0]["installationId"],"fixed-device-installation")
        self.assertEqual(monitor.snapshot()["paused"],["link-a"])
        self.assertEqual(self.events[-1]["state"],"pc-online")
        self.assertFalse(self.stop.is_set())

    def test_offline_does_not_revoke_pairing_or_wipe_last_confirmed_controls(self):
        available=[True]
        def request(_):
            if not available[0]:
                raise OSError("offline")
            return {"device":"pc-1","paused":["link-a"]}
        monitor=self.make(request)
        self.assertTrue(monitor.check())
        available[0]=False
        self.assertFalse(monitor.check())
        self.assertEqual(self.events[-1]["state"],"pc-reconnecting")
        self.assertEqual(monitor.snapshot()["paused"],["link-a"])
        self.assertFalse(self.stop.is_set())

    def test_old_worker_is_not_confused_with_revocation(self):
        monitor=self.make(lambda _:(_ for _ in ()).throw(http_error(404)))
        self.assertFalse(monitor.check())
        self.assertEqual(self.events[-1]["state"],"pc-service-incompatible")
        self.assertFalse(self.stop.is_set())

    def test_explicit_revocation_stops_capture(self):
        monitor=self.make(lambda _:(_ for _ in ()).throw(http_error(403,{"code":"device_revoked"})))
        self.assertFalse(monitor.check())
        self.assertEqual(self.events[-1]["state"],"pc-revoked")
        self.assertTrue(self.stop.is_set())

    def test_network_401_without_revocation_code_remains_retryable(self):
        monitor=self.make(lambda _:(_ for _ in ()).throw(http_error(401,{"code":"temporary_auth"})))
        self.assertFalse(monitor.check())
        self.assertEqual(self.events[-1]["state"],"pc-reconnecting")
        self.assertFalse(self.stop.is_set())

    def test_duplicate_installation_conflict_never_silently_reassigns_identity(self):
        monitor=self.make(lambda _:(_ for _ in ()).throw(http_error(409,{"code":"pc_identity_mismatch"})))
        self.assertFalse(monitor.check())
        self.assertEqual(self.events[-1]["state"],"pc-identity-conflict")
        self.assertFalse(self.stop.is_set())

    def test_malformed_server_response_is_not_success(self):
        monitor=self.make(lambda _:{"device":"pc-1","paused":"yes"})
        self.assertFalse(monitor.check())
        self.assertEqual(self.events[-1]["state"],"pc-service-incompatible")

    def test_offline_then_recovery_reports_online_without_repairing(self):
        count=[0]
        def request(_):
            count[0]+=1
            if count[0]<3:
                raise urllib.error.URLError("offline")
            return {"device":"pc-1","paused":[]}
        monitor=self.make(request)
        self.assertFalse(monitor.check())
        self.assertFalse(monitor.check())
        self.assertTrue(monitor.check())
        self.assertEqual(self.events[-1]["state"],"pc-online")
        self.assertEqual(count[0],3)
        self.assertFalse(self.stop.is_set())


if __name__=="__main__":
    unittest.main()
