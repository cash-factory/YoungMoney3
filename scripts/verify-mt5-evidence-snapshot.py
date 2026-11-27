#!/usr/bin/env python3
"""Read-only evidence fingerprint for an isolated, restored D1 SQLite snapshot.

This is a post-restore verification tool, NOT a backup or restoration service.
It never prints account numbers, trade content, keys or payloads. Comparison
must be made to a trusted baseline from the same logical backup point.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path

EVIDENCE_TABLES = (
    "users", "workspace_records", "mt5_devices", "mt5_links", "mt5_events",
    "mt5_raw_evidence", "mt5_evidence_corrections", "mt5_position_versions",
    "mt5_evidence_conflicts", "mt5_conflict_classifications",
    "mt5_recovery_status", "mt5_cash_movements", "mt5_cash_reviews",
    "mt5_cash_review_events", "trade_audit",
)
MANIFEST_VERSION = 1


class EvidenceAuditError(ValueError):
    pass


def _stable(value):
    if isinstance(value, bytes):
        return {"sqlite_blob_base64": base64.b64encode(value).decode("ascii")}
    if value is None or isinstance(value, (str, int, float)):
        return value
    raise EvidenceAuditError("SQLite value has an unsupported type")


def inspect(path: Path) -> dict:
    path = Path(path).resolve()
    if not path.is_file():
        raise EvidenceAuditError("A local SQLite snapshot must exist")
    # Do not create a database if its path is wrong. Never issue writes.
    with closing(sqlite3.connect(path.as_uri()+"?mode=ro",uri=True,timeout=3)) as db:
        db.execute("PRAGMA query_only=ON")
        tables = {row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        missing = sorted(set(EVIDENCE_TABLES)-tables)
        if missing:
            raise EvidenceAuditError("Required snapshot tables missing: "+", ".join(missing))
        if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise EvidenceAuditError("SQLite snapshot failed its integrity check")
        violations = db.execute("PRAGMA foreign_key_check").fetchmany(1)
        if violations:
            raise EvidenceAuditError("Restored snapshot has broken foreign key references")
        report={}
        for table in EVIDENCE_TABLES:
            columns=[entry[1] for entry in db.execute('PRAGMA table_info("'+table+'")')]
            if not columns:
                raise EvidenceAuditError("Evidence schema is missing fields")
            # Include names and all values, sorted deterministically so a
            # restored database with different physical rowids hashes equally.
            quoted=", ".join('"'+c.replace('"','""')+'"' for c in columns)
            digest=hashlib.sha256()
            digest.update(json.dumps(columns,separators=(",",":")).encode())
            count=0
            for row in db.execute('SELECT '+quoted+' FROM "'+table+'" ORDER BY '+quoted):
                item=json.dumps([_stable(v) for v in row],sort_keys=True,
                                ensure_ascii=True,separators=(",",":"),
                                allow_nan=False).encode("utf-8")
                digest.update(len(item).to_bytes(8,"big"))
                digest.update(item)
                count+=1
            report[table]={"rows":count,"sha256":digest.hexdigest()}
        return {"format":"ymfx-restored-d1-evidence-fingerprint",
                "version":MANIFEST_VERSION,"tables":report}


def compare_reports(expected: dict, actual: dict) -> None:
    if expected.get("format") != actual.get("format") or expected.get("version") != actual.get("version"):
        raise EvidenceAuditError("Snapshot manifest format is not compatible")
    if expected.get("tables") != actual.get("tables"):
        raise EvidenceAuditError("Restored D1 evidence differs from the trusted baseline")


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sqlite",type=Path,help="Isolated restored SQLite snapshot (never live D1)")
    exclusive=parser.add_mutually_exclusive_group(required=True)
    exclusive.add_argument("--manifest",type=Path,help="Write a new private trusted baseline manifest")
    exclusive.add_argument("--compare",type=Path,help="Compare restored data against prior baseline")
    args=parser.parse_args(argv)
    report=inspect(args.sqlite)
    if args.compare:
        expected=json.loads(args.compare.read_text(encoding="utf-8"))
        compare_reports(expected,report)
        print("PASS: all required evidence table counts and hashes match the trusted baseline.")
    else:
        # Exclusive file creation prevents overwriting prior audit evidence.
        with args.manifest.open("x",encoding="utf-8") as handle:
            json.dump(report,handle,indent=2)
        print("Created read-only evidence fingerprint manifest. Protect it with the backup.")
    return 0


if __name__=="__main__":
    try:
        raise SystemExit(main())
    except (EvidenceAuditError,sqlite3.Error,OSError,ValueError) as error:
        raise SystemExit("FAIL: "+str(error))
