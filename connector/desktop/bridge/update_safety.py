"""Read-only, fail-closed updater preflight across saved Windows capture databases.

Never modify a database here. The native updater must not rely on an old
in-memory upload count, and must reject an unreadable store or outstanding
legacy copier approval even though Signal Desk itself is capture-only.
"""
from __future__ import annotations
import sqlite3
from contextlib import closing
from pathlib import Path


def inspect_idle_stores(root: Path, *, limit: int = 64) -> dict:
    root = Path(root)
    if not root.exists():
        return {'verified': True, 'queued': 0, 'copy_permission': False, 'copy_tasks': 0}
    try:
        databases = sorted(root.glob('*/capture.db'))
        if len(databases) > limit:
            raise ValueError('Too many local capture databases')
        queued = 0
        copy_permission = False
        copy_tasks = 0
        for path in databases:
            if not path.is_file():
                raise ValueError('Capture database is inaccessible')
            # Use URI read-only mode. No default writable sqlite connection,
            # implicit schema creation, or checkpoint mutation is permitted.
            with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro',
                                         uri=True, timeout=1)) as db:
                db.execute('PRAGMA query_only=ON')
                queued += int(db.execute('SELECT COUNT(*) FROM outbox').fetchone()[0])
                tables = {row[0] for row in db.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'")}
                if 'copy_local_permissions' in tables:
                    copy_permission = copy_permission or db.execute(
                        'SELECT 1 FROM copy_local_permissions WHERE approved=1 LIMIT 1'
                    ).fetchone() is not None
                if 'copy_local_tasks' in tables:
                    copy_tasks += int(db.execute(
                        "SELECT COUNT(*) FROM copy_local_tasks "
                        "WHERE status IN ('queued','dispatched','unknown','ack_pending','reserved')"
                    ).fetchone()[0])
        return {'verified': True, 'queued': queued,
                'copy_permission': copy_permission, 'copy_tasks': copy_tasks}
    except (OSError, sqlite3.Error, ValueError):
        # Unreadable or incomplete local state is unknown, never safe/empty.
        return {'verified': False, 'queued': None,
                'copy_permission': None, 'copy_tasks': None}
