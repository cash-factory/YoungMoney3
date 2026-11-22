"""Broker account verification must bind ONLY to the session armed in the GUI."""
import base64
import json
import os
import sqlite3
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import connect


class ArmedVerificationTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.execute(
            "CREATE TABLE links(link TEXT PRIMARY KEY,slot TEXT UNIQUE,login TEXT,server TEXT,"
            "start INTEGER,cursor INTEGER,last INTEGER,verified TEXT,gap INTEGER)"
        )
        self.one = "C:/MT5/Demo1/terminal64.exe"
        self.two = "C:/MT5/Demo2/terminal64.exe"
        self.stack.enter_context(patch.object(connect, "db", self.db, create=True))
        self.stack.enter_context(patch.object(connect, "slots", [self.one, self.two], create=True))
        self.stack.enter_context(patch.object(connect, "service", "YMFX-test", create=True))
        self.stack.enter_context(patch.object(connect, "token", "fake", create=True))
        self.mt5 = self.stack.enter_context(patch.object(connect, "mt5"))
        self.terminal = self.stack.enter_context(patch.object(connect, "terminal_account"))
        self.terminal.return_value = SimpleNamespace(company="Demo Broker", currency="USD",
            balance=100.0, trade_mode=0, trade_allowed=False, login=222, server="Demo")
        self.posts = []
        self.stack.enter_context(patch.object(connect, "post",
            side_effect=lambda action, data, token: self.posts.append((action, data))))
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        encoded = base64.b64encode(key.private_bytes(
            serialization.Encoding.DER, serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption())).decode()
        credentials = {"private-a": encoded[:850], "private-b": encoded[850:]}
        self.stack.enter_context(patch.object(connect.keyring, "get_password",
            side_effect=lambda service, field: credentials[field]))
        self.saved = self.stack.enter_context(patch.object(connect.keyring, "set_password"))
        aes = AESGCM.generate_key(bit_length=128)
        iv = os.urandom(12)
        data = AESGCM(aes).encrypt(iv, json.dumps({
            "login": 222, "server": "Demo", "password": "hidden"}).encode(), None)
        wrapped = key.public_key().encrypt(aes,
            padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
                         algorithm=hashes.SHA256(), label=None))
        self.job = {"id": "link-1", "envelope": {
            "wrapped": base64.b64encode(wrapped).decode(),
            "iv": base64.b64encode(iv).decode(),
            "data": base64.b64encode(data).decode()}}
        self.events = []

    def test_arm_second_terminal_instead_of_first_free(self):
        connect.verify(self.job, slot_override=self.two, report=self.events.append)
        row = self.db.execute("SELECT slot, login, server FROM links").fetchone()
        self.assertEqual(row, (self.two, "222", "Demo"))
        self.terminal.assert_called_once_with(self.two, 222, "Demo", "hidden",
                                              verify_password=True)
        self.assertEqual(self.events[-1]["state"], "account-linked")
        self.assertEqual(self.events[-1]["slot"], self.two)
        self.assertTrue(self.events[-1]["acknowledged"])
        self.assertIsNone(self.db.execute("SELECT verified FROM links WHERE link='link-1'").fetchone()[0])
        self.assertNotIn("hidden", json.dumps(self.events))

    def test_acknowledgement_network_loss_preserves_retry_receipt(self):
        with patch.object(connect, "post", side_effect=OSError("offline")):
            connect.verify(self.job, slot_override=self.two, report=self.events.append)
        row = self.db.execute("SELECT verified FROM links WHERE link='link-1'").fetchone()
        self.assertIsNotNone(row)
        self.assertIsNotNone(row[0])
        self.assertEqual(self.events[-1]["state"], "account-linked")
        self.assertFalse(self.events[-1]["acknowledged"])
        self.assertNotIn("hidden", json.dumps(self.events))


    def test_already_linked_slot_fails_closed_without_using_other_slot(self):
        self.db.execute("INSERT INTO links VALUES(?,?,?,?,?,?,?,?,?)",
                        ("existing", self.two, "111", "Demo", 0, 0, 0, None, 0))
        connect.verify(self.job, slot_override=self.two, report=self.events.append)
        self.terminal.assert_not_called()
        self.assertEqual(self.posts[-1][0], "verified")
        self.assertEqual(self.posts[-1][1]["reason"], "no_slot")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM links").fetchone()[0], 1)

    def test_unknown_armed_slot_is_not_silently_reassigned(self):
        connect.verify(self.job, slot_override="C:/Unknown/terminal64.exe",
                       report=self.events.append)
        self.terminal.assert_not_called()
        self.assertEqual(self.posts[-1][1]["reason"], "no_slot")
        self.assertFalse(self.db.execute("SELECT 1 FROM links WHERE link='link-1'").fetchone())


if __name__ == "__main__":
    unittest.main()
