"""Fail-closed offline updater audit tests; synthetic SQLite only."""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'bridge'))
from update_safety import inspect_idle_stores


class IdleUpdateSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.dbpath=self.root/'0123456789abcdef0123'/'capture.db'
        self.dbpath.parent.mkdir()
        with sqlite3.connect(self.dbpath) as db:
            db.executescript("""
                CREATE TABLE outbox(seq INTEGER PRIMARY KEY,link TEXT,payload TEXT);
                CREATE TABLE copy_local_permissions(link TEXT,approved INTEGER);
                CREATE TABLE copy_local_tasks(task_id TEXT,status TEXT);
            """)

    def test_empty_and_active_evidence_are_distinguished(self):
        self.assertEqual(inspect_idle_stores(self.root),
            {'verified':True,'queued':0,'copy_permission':False,'copy_tasks':0})
        with sqlite3.connect(self.dbpath) as db:
            db.execute("INSERT INTO outbox VALUES(1,'account','{}')")
            db.execute("INSERT INTO copy_local_permissions VALUES('account',1)")
            db.execute("INSERT INTO copy_local_tasks VALUES('task','ack_pending')")
        audit=inspect_idle_stores(self.root)
        self.assertTrue(audit['verified'])
        self.assertEqual(audit['queued'],1)
        self.assertTrue(audit['copy_permission'])
        self.assertEqual(audit['copy_tasks'],1)

    def test_unreadable_or_invalid_sqlite_is_not_considered_idle(self):
        self.dbpath.write_bytes(b'not sqlite')
        audit=inspect_idle_stores(self.root)
        self.assertFalse(audit['verified'])
        self.assertIsNone(audit['queued'])

    def test_missing_outbox_table_is_unknown_and_never_zero(self):
        with sqlite3.connect(self.dbpath) as db:
            db.execute('DROP TABLE outbox')
        self.assertFalse(inspect_idle_stores(self.root)['verified'])

    def test_too_many_databases_fails_closed(self):
        for i in range(3):
            path=self.root/('extra'+str(i))/'capture.db'
            path.parent.mkdir()
            path.write_bytes(b'dummy')
        self.assertFalse(inspect_idle_stores(self.root,limit=2)['verified'])

    def test_fresh_profile_without_broker_database_can_update_without_writes(self):
        with tempfile.TemporaryDirectory() as empty:
            self.assertEqual(inspect_idle_stores(Path(empty))['queued'],0)
        self.assertTrue(self.dbpath.is_file())


if __name__ == '__main__':
    unittest.main()
