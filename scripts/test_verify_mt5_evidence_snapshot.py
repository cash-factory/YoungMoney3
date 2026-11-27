"""Offline post-restore D1 MT5 integrity fingerprints, without broker or Cloudflare."""
import importlib.util
import json
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).with_name('verify-mt5-evidence-snapshot.py')
SPEC=importlib.util.spec_from_file_location('verify_mt5_evidence_snapshot',SCRIPT)
assert SPEC and SPEC.loader
MODULE=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class EvidenceSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.source=self.root/'original.sqlite'
        with sqlite3.connect(self.source) as db:
            for table in MODULE.EVIDENCE_TABLES:
                db.execute('CREATE TABLE "'+table+'" (id TEXT PRIMARY KEY,payload TEXT)')
            db.execute("INSERT INTO mt5_raw_evidence VALUES(?,?)",
                       ('id-111','{\"broker\":\"SECRET TEST ACCOUNT\",\"fill\":88}'))
            db.execute("INSERT INTO mt5_position_versions VALUES(?,?)",
                       ('position-1','{\"originalRisk\":\"3.00\"}'))
        self.copy=self.root/'restored.sqlite'
        shutil.copy2(self.source,self.copy)

    def test_matching_synthetic_snapshot_fingerprints_without_exposing_payloads(self):
        baseline=MODULE.inspect(self.source)
        restored=MODULE.inspect(self.copy)
        MODULE.compare_reports(baseline,restored)
        self.assertEqual(baseline['tables']['mt5_raw_evidence']['rows'],1)
        self.assertEqual(baseline['tables']['mt5_position_versions']['rows'],1)
        self.assertNotIn('SECRET TEST ACCOUNT',json.dumps(baseline))
        self.assertNotIn('originalRisk',json.dumps(baseline))
        self.assertEqual(len(baseline['tables']),len(MODULE.EVIDENCE_TABLES))

    def test_modified_immutable_broker_fill_fails_restore_comparison(self):
        baseline=MODULE.inspect(self.source)
        with sqlite3.connect(self.copy) as db:
            db.execute("UPDATE mt5_raw_evidence SET payload=? WHERE id='id-111'",
                       ('{\"fill\":99}',))
        with self.assertRaisesRegex(MODULE.EvidenceAuditError,'differs'):
            MODULE.compare_reports(baseline,MODULE.inspect(self.copy))

    def test_missing_immutable_evidence_trigger_fails_schema_comparison(self):
        with sqlite3.connect(self.source) as db:
            db.execute("""CREATE TRIGGER evidence_lock BEFORE UPDATE ON mt5_raw_evidence
                        BEGIN SELECT RAISE(ABORT,'Immutable broker evidence'); END""")
        shutil.copy2(self.source,self.copy)
        original=MODULE.inspect(self.source)
        MODULE.compare_reports(original,MODULE.inspect(self.copy))
        with sqlite3.connect(self.copy) as db:
            db.execute('DROP TRIGGER evidence_lock')
        with self.assertRaisesRegex(MODULE.EvidenceAuditError,'triggers differ'):
            MODULE.compare_reports(original,MODULE.inspect(self.copy))

    def test_missing_broker_table_fails_closed(self):
        with sqlite3.connect(self.copy) as db:
            db.execute('DROP TABLE mt5_evidence_conflicts')
        with self.assertRaisesRegex(MODULE.EvidenceAuditError,'missing'):
            MODULE.inspect(self.copy)

    def test_unknown_file_never_creates_database(self):
        absent=self.root/'not-a-database.sqlite'
        with self.assertRaisesRegex(MODULE.EvidenceAuditError,'must exist'):
            MODULE.inspect(absent)
        self.assertFalse(absent.exists())


if __name__=='__main__':
    unittest.main()
