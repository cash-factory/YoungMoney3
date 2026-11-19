import io
import queue
import sqlite3
import sys
import json
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from managed_accounts import ManagedAccounts, find_installations
from concurrent_capture import run_supervisor
from presence import DevicePresence
from sessions import SessionStore
from terminal_factory import TerminalCopyError


class ManagedSetupTests(unittest.TestCase):
    def test_shared_broker_two_accounts_and_retry_after_rejected_password(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            programs = root / "programs"
            generic = programs / "MetaTrader 5"
            custom = root / "Custom" / "Weltrade"
            for program in (generic, custom):
                program.mkdir(parents=True)
                (program / "terminal64.exe").write_bytes(program.name.encode())
            profile = root / "profile"
            config = profile / "config"
            config.mkdir(parents=True)
            (profile / "origin.txt").write_bytes(str(custom).encode("utf-16"))
            (config / "servers.dat").write_bytes(b"server directory")
            (config / "accounts.dat").write_bytes(b"private")
            installs = find_installations([programs], [profile])
            self.assertEqual(len(installs), 2)
            store = SessionStore(root / "sessions.json")
            setup = ManagedAccounts(store, root / "managed", lambda: installs)
            stop = threading.Event()
            a = Path(setup.prepare("Weltrade-Demo", [], stop))
            self.assertEqual(a.read_bytes(), b"Weltrade")
            self.assertEqual((a.parent / "config" / "servers.dat").read_bytes(), b"server directory")
            self.assertFalse((a.parent / "config" / "accounts.dat").exists())
            self.assertEqual(str(a), setup.prepare("Weltrade-Demo", [], stop))
            b = Path(setup.prepare("Weltrade-Demo", [str(a)], stop))
            self.assertNotEqual(a, b)
            self.assertEqual(len(store.snapshot()), 2)

    def test_missing_install_is_actionable_without_creating_a_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = SessionStore(Path(tmp) / "prefs.json")
            setup = ManagedAccounts(store, Path(tmp) / "managed", lambda: [])
            with self.assertRaisesRegex(TerminalCopyError, "Install MetaTrader"):
                setup.prepare("Broker", [], threading.Event())
            self.assertEqual(store.snapshot(), [])


class SupervisorSetupTests(unittest.TestCase):
    def test_empty_pc_keeps_checking_in_while_creating_first_account(self):
        with tempfile.TemporaryDirectory() as tmp, sqlite3.connect(":memory:") as db:
            db.executescript("CREATE TABLE links(link,slot); CREATE TABLE outbox(seq);")
            root = Path(tmp)
            source = root / "Broker" / "terminal64.exe"
            source.parent.mkdir()
            source.write_bytes(b"program")
            store = SessionStore(root / "prefs.json")
            setup = ManagedAccounts(store, root / "managed", lambda:[(source,None)])
            copying, checked_in_during_copy, stop = threading.Event(), threading.Event(), threading.Event()
            def post(action, payload, token):
                if action == "presence":
                    if copying.is_set():
                        checked_in_during_copy.set()
                    return {"device":"pc", "pending":{"id":"new","server":"Broker-Demo"}, "paused":[]}
                self.assertEqual((action, payload), ("poll",{"request":"new"}))
                return {"job":{"id":"new"}}
            prepare = setup.prepare
            def prepare_while_online(*args):
                copying.set()
                if not checked_in_during_copy.wait(3):
                    stop.set()
                    raise AssertionError("PC did not check in during provisioning")
                return prepare(*args)
            observed = []
            def verify(job, slot_override, report):
                observed.append((job["id"], slot_override))
                stop.set()
            service = SimpleNamespace(post=post, verify=verify, slots=[])
            with patch.dict(sys.modules, {"connect":service}), patch.object(DevicePresence, "interval", .02), \
                    patch.object(setup, "prepare", side_effect=prepare_while_online):
                run_supervisor("https://example.test", db, root/"capture.db", [], "fixture", lambda event:None,
                               stop, store.armed_terminal, store.active_terminals, store.all_terminals, queue.Queue(), setup)
            self.assertTrue(checked_in_during_copy.is_set())
            self.assertEqual(observed, [("new",store.active_terminals()[0])])
            self.assertNotEqual(observed[0][1], str(source))


class PresenceTests(unittest.TestCase):
    def test_idle_network_loss_then_recovery_keeps_pairing(self):
        reply = {"device":"pc1", "paused":[], "pending":None}
        request = Mock(side_effect=[reply, URLError("offline"), reply])
        stop = threading.Event()
        posted = []
        service = DevicePresence(request, Mock(sources=lambda:[]), posted.append, stop)
        self.assertTrue(service.check())
        self.assertFalse(service.check())
        self.assertTrue(service.check())
        self.assertFalse(stop.is_set())
        self.assertEqual([r["state"] for r in posted], ["pc-online","pc-reconnecting","pc-online"])
        self.assertEqual(request.call_args.args[0]["setup"], "install")

    def test_older_staging_api_is_explained_without_revoking_pairing(self):
        missing = HTTPError("https://example.test", 404, "Not found", {}, io.BytesIO(b""))
        reply = {"device": "pc1", "paused": [], "pending": None}
        request = Mock(side_effect=[missing, {"error": "wrong API"}, reply])
        stop = threading.Event()
        posted = []
        service = DevicePresence(request, Mock(sources=lambda: []), posted.append, stop)
        self.assertFalse(service.check())
        self.assertFalse(service.check())
        self.assertTrue(service.check())
        self.assertFalse(stop.is_set())
        self.assertEqual([r["state"] for r in posted],
                         ["pc-service-incompatible", "pc-online"])

    def test_transient_install_discovery_error_does_not_kill_presence(self):
        source = Mock()
        source.sources.side_effect = [PermissionError("MT5 being updated"), []]
        request = Mock(return_value={"device": "pc1", "paused": []})
        stop = threading.Event()
        posted = []
        service = DevicePresence(request, source, posted.append, stop)
        self.assertFalse(service.check())
        self.assertTrue(service.check())
        self.assertFalse(stop.is_set())
        self.assertEqual([r["state"] for r in posted], ["pc-reconnecting", "pc-online"])

    def test_only_explicit_revocation_requests_repair(self):
        def denied(body):
            return HTTPError("https://example.test",403,"Forbidden",{},io.BytesIO(body))
        request = Mock(side_effect=[denied(b"upstream temporarily unavailable"),
                                    denied(json.dumps({"code":"device_revoked"}).encode())])
        stop = threading.Event()
        posted = []
        service = DevicePresence(request, Mock(sources=lambda:[True]), posted.append, stop)
        service.check()
        self.assertFalse(stop.is_set())
        service.check()
        self.assertTrue(stop.is_set())
        self.assertEqual([r["state"] for r in posted], ["pc-reconnecting","pc-revoked"])
