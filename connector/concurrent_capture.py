"""Concurrent read-only MT5 account capture.

One dedicated Windows process / MT5 IPC connection per broker account.
No password or device token travels through process arguments or event queues:
each worker reads its own keys from Windows Credential Manager. Existing
per-device SQLite evidence and outbox remain in their original file with WAL
and per-link writes, so replays use the same immutable broker event keys.
"""
from __future__ import annotations

import hashlib
import multiprocessing
import queue
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

class CaptureSupervisorError(RuntimeError):
    pass


def wanted_link_rows(rows, active_slots):
    """Plan active processes from durable broker links and currently enabled slots."""
    allowed = set(active_slots)
    return {str(row[0]): row for row in rows if row[1] in allowed}


def _put(out, event):
    try:
        out.put_nowait(event)
    except (queue.Full, OSError, ValueError):
        # Event loss never drops trade evidence; local SQLite is authoritative.
        pass


def capture_account(origin, database_path, slot, link, stop_event, event_queue, wake_event=None):
    """Spawned process. MT5's native module is strictly process-local."""
    # Import inside child after multiprocessing.freeze_support dispatch.
    import connect
    from keyring.backends.Windows import WinVaultKeyring

    connect.origin = origin
    connect.slots = [slot]
    connect.opener = urllib.request.build_opener(connect.NoRedirect())
    connect.service = "YMFX MT5 " + hashlib.sha256(origin.encode()).hexdigest()[:16]
    connect.keyring.set_keyring(WinVaultKeyring())
    connect.token = connect.keyring.get_password(connect.service, "token")
    if not connect.token:
        _put(event_queue, {"state": "session-error", "slot": slot,
                           "message": "PC pairing is missing. Pair this Windows user in staging."})
        return
    connect.db = sqlite3.connect(database_path, timeout=30)
    connect.db.execute("PRAGMA busy_timeout=30000")
    connect.db.execute("PRAGMA journal_mode=WAL")
    connect.heartbeats = {}
    connect.timezone_cache = {}
    failures = 0
    try:
        while not stop_event.is_set():
            record = connect.db.execute(
                "SELECT * FROM links WHERE link=? AND slot=?", (link, slot)
            ).fetchone()
            if not record:
                # Account was revoked or verification rejected.
                _put(event_queue, {"state": "session-unlinked", "slot": slot,
                                   "message": "Broker account is no longer linked."})
                break
            try:
                outcome = connect.scan(*record)
                if outcome is False:
                    _put(event_queue, {"state": "session-unlinked", "slot": slot,
                                       "message": "Broker verification was rejected by staging."})
                    break
                failures = 0
                pending = connect.db.execute(
                    "SELECT COUNT(*) FROM outbox WHERE link=?", (link,)
                ).fetchone()[0]
                synced_at, awaiting = connect.sync_receipts.get(link, (None, None))
                _put(event_queue, {
                    "synced_at": synced_at, "awaiting": awaiting,
                    "state": "session-synced", "slot": slot, "link": link,
                    "login": record[2], "server": record[3], "pending": pending,
                    "message": "Account capture completed; next scan scheduled.",
                })
            except Exception as error:
                if failures == 0:
                    try:
                        connect.post("capture-issue", {"link": link}, connect.token)
                    except Exception:
                        pass  # Offline devices retain their last server receipt.
                failures = min(5, failures + 1)
                _put(event_queue, {
                    "state": "session-error", "slot": slot, "link": link,
                    "message": "Broker capture error (" + type(error).__name__ +
                               "). Retrying without deleting evidence.",
                })
            finally:
                connect.mt5.shutdown()
            deadline = time.monotonic() + min(45, 2 ** failures + 2)
            while not stop_event.is_set() and time.monotonic() < deadline:
                if wake_event is not None and wake_event.is_set():
                    wake_event.clear()
                    connect.heartbeats.pop(link, None)
                    break
                stop_event.wait(0.25)
    finally:
        try:
            connect.mt5.shutdown()
        finally:
            connect.db.close()
        _put(event_queue, {"state": "session-worker-exited", "slot": slot,
                           "message": "Account process stopped; evidence preserved."})


def _smoke_child(slot_name, out):
    # Multiprocessing proof without MT5, network, credentials or local files.
    import os
    _put(out, {"slot": slot_name, "pid": os.getpid()})


def run_parallel_smoke():
    """Frozen Windows smoke: two *different* process IDs for two accounts."""
    ctx = multiprocessing.get_context("spawn")
    out = ctx.Queue()
    processes = [ctx.Process(target=_smoke_child, args=(name, out))
                 for name in ("demo-one", "demo-two")]
    try:
        for proc in processes:
            proc.start()
        evidence = [out.get(timeout=30) for _ in processes]
        for proc in processes:
            proc.join(timeout=15)
            if proc.exitcode != 0:
                raise CaptureSupervisorError("Isolated account worker failed startup.")
        if len({item["pid"] for item in evidence}) != 2 or {
            item["slot"] for item in evidence
        } != {"demo-one", "demo-two"}:
            raise CaptureSupervisorError("MT5 workers did not start independently.")
        return {"parallel_spawn": "ok", "distinct_processes": 2,
                "broker_capture_started": False}
    finally:
        for proc in processes:
            if proc.is_alive():
                proc.terminate()
                proc.join(timeout=5)
        out.close()


def run_supervisor(origin, db, database_path, slots, token, report,
                   stop_event, armed_slot, active_slots, all_slots, retry_queue=None, managed_accounts=None):
    """Runs in the GUI's non-Tk coordinator thread; worker processes own MT5."""
    import connect

    db.execute("PRAGMA busy_timeout=30000")
    # Enable safe concurrent readers/writers, retaining the same capture.db file.
    db.execute("PRAGMA journal_mode=WAL")
    ctx = multiprocessing.get_context("spawn")
    events = ctx.Queue(maxsize=256)
    children = {}  # broker link id -> (process, stop event, terminal path)
    retry_after = {}
    wake_events = {}
    seen_requests = {}
    next_retry_poll = 0.0
    presence = None
    handled_request = None
    previous_paused = None
    if managed_accounts is not None:
        from presence import DevicePresence
        from pc_identity import installation_id
        presence = DevicePresence(lambda payload: connect.post("presence", payload, token),
                                  managed_accounts, report, stop_event,
                                  installation=lambda: installation_id(origin))
        presence.thread.start()
    previous_links = None
    next_poll = 0.0
    last_report = 0.0
    if report:
        report({"state": "running", "message": "Parallel capture supervisor started."})
    try:
        while not (stop_event and stop_event.is_set()):
            now = time.monotonic()
            connect.slots = list(all_slots()) if all_slots else list(slots)
            rows = db.execute("SELECT * FROM links ORDER BY link").fetchall()
            linked = [(row[0], row[1], row[2], row[3]) for row in rows]
            if linked != previous_links and report:
                report({
                    "state": "known-links",
                    "links": [{"link": r[0], "slot": r[1], "login": r[2], "server": r[3]}
                              for r in linked],
                })
                previous_links = linked
            enabled = set(active_slots()) if active_slots else set(connect.slots)
            selected = wanted_link_rows(rows, enabled)
            commands = presence.snapshot() if presence else None
            if presence:
                try:
                    account_id, paused_request = managed_accounts.controls.get_nowait()
                except queue.Empty:
                    pass
                else:
                    try:
                        connect.post("set-monitoring", {"link":account_id, "paused":paused_request}, token)
                        if report:
                            report({"state":"control-saved", "message":"Monitoring change saved to your dashboard."})
                    except Exception:
                        if report:
                            report({"state":"control-error", "message":"Could not change monitoring. Check the PC connection and retry."})
                paused = set(commands["paused"]) if commands else set()
                if commands and paused != previous_paused and report:
                    report({"state": "monitoring-policy", "paused": list(paused)})
                    previous_paused = paused
                selected = {key: row for key, row in selected.items()
                            if commands and not commands.get("capturePaused") and key not in paused}
            for link, (process, halt, slot) in list(children.items()):
                if link not in selected or selected[link][1] != slot:
                    halt.set()  # Gracefully stop after current MT5 call.
                if not process.is_alive():
                    process.join(timeout=0.1)
                    del children[link]
                    wake_events.pop(link, None)
                    if link in selected and not halt.is_set():
                        retry_after[link] = now + 10
                        if report:
                            report({"state": "session-error", "slot": slot,
                                    "message": "Account process exited; retrying in 10 seconds."})
                    else:
                        retry_after.pop(link, None)

            for link, row in selected.items():
                if link in children or now < retry_after.get(link, 0):
                    continue
                halt = ctx.Event()
                wake_events[link] = ctx.Event()
                proc = ctx.Process(target=capture_account,
                                   args=(origin, str(database_path), row[1], link, halt, events, wake_events[link]),
                                   name="YMFX-MT5-" + hashlib.sha256(link.encode()).hexdigest()[:9],
                                   daemon=True)
                proc.start()
                children[link] = (proc, halt, row[1])
                if report:
                    report({"state": "session-starting", "slot": row[1],
                            "message": "Starting isolated MT5 account capture process."})

            requested = set()
            if retry_queue is not None:
                while True:
                    try:
                        selected_slot = retry_queue.get_nowait()
                    except queue.Empty:
                        break
                    requested.update(link for link, row in selected.items() if row[1] == selected_slot)
            if commands:
                for request in commands.get("retries", []):
                    link_id = request["id"]
                    if link_id not in selected and seen_requests.get(link_id) != request["retry_requested_at"]:
                        slot = next((r[1] for r in rows if r[0] == link_id), None)
                        session = next((s for s in managed_accounts.store.snapshot() if s["terminal"] == slot), None)
                        if session and not session["enabled"]:
                            managed_accounts.store.set_enabled(session["id"], True)
                    if link_id in selected and seen_requests.get(link_id) != request["retry_requested_at"]:
                        requested.add(link_id)
                        seen_requests[link_id] = request["retry_requested_at"]
            if not presence and selected and now >= next_retry_poll:
                next_retry_poll = now + 12
                try:
                    pending = connect.post("retries", {}, token).get("rows", [])
                    for request in pending:
                        link_id = request["id"]
                        if link_id in selected and seen_requests.get(link_id) != request["retry_requested_at"]:
                            requested.add(link_id)
                            seen_requests[link_id] = request["retry_requested_at"]
                except Exception:
                    pass  # Each account still performs its own broker retry.
            for link_id in requested:
                retry_after.pop(link_id, None)
                if link_id in wake_events:
                    wake_events[link_id].set()

            # Accept website requests only when a free, explicitly armed
            # terminal exists. Otherwise requests remain waiting on staging.
            candidate = armed_slot() if armed_slot else None
            used = {row[1] for row in rows}
            pending = commands.get("pending") if commands else None
            if presence and pending and handled_request != pending["id"] and now >= next_poll:
                from terminal_factory import TerminalCopyError
                try:
                    if report:
                        report({"state": "preparing-account", "message": "Preparing MetaTrader for your account."})
                    candidate = managed_accounts.prepare(pending.get("server") or "MT5", used, stop_event)
                    if stop_event.is_set():
                        break
                    connect.slots = list(all_slots())
                    job = connect.post("poll", {"request": pending["id"]}, token).get("job")
                    if job:
                        if report:
                            report({"state": "verifying", "slot": candidate, "message": "Your broker is checking the login."})
                        connect.verify(job, slot_override=candidate, report=report)
                    handled_request = pending["id"]
                except (TerminalCopyError, OSError) as error:
                    if isinstance(error, TerminalCopyError):
                        # Do not retry the same broken copy every five seconds
                        # when its staging error acknowledgement is unreachable.
                        # Only a NEW Add account request allows another attempt.
                        handled_request = pending["id"]
                        if not stop_event.is_set():
                            try:
                                connect.post("setup-issue", {
                                    "link": pending["id"], "reason": error.code
                                }, token)
                            except OSError:
                                pass
                    if report:
                        report({"state": "setup-error", "message": str(error) if isinstance(error, TerminalCopyError)
                                else "The network is unavailable. Reconnecting to the dashboard."})
                except Exception:
                    if report:
                        report({"state": "setup-error", "message": "Setup was interrupted. Check this request in the dashboard."})
                next_poll = time.monotonic() + 5
            elif not presence and candidate and candidate in enabled and candidate in connect.slots and candidate not in used:
                if now >= next_poll:
                    try:
                        job = connect.post("poll", {}, token)["job"]
                        if job:
                            if report:
                                report({"state": "verifying", "slot": candidate,
                                        "message": "Staging requested account verification."})
                            connect.verify(job, slot_override=candidate, report=report)
                        next_poll = now + 5
                    except Exception as error:
                        next_poll = now + 10
                        if report:
                            report({"state": "retrying",
                                    "message": "Account pairing service unavailable (" +
                                               type(error).__name__ + ")."})
            elif not presence:
                next_poll = now

            # Only report safe, typed events. No account passwords or pairing
            # secrets pass over the multiprocessing queue.
            for _ in range(70):
                try:
                    event = events.get_nowait()
                except queue.Empty:
                    break
                if report:
                    report(event)
            if report and now - last_report >= 8:
                report({"state": "running", "linked": len(rows),
                        "active_workers": sum(proc.is_alive() and not halt.is_set()
                                              for proc, halt, _ in children.values()),
                        "queued": db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0],
                        "last_sync": datetime.now(timezone.utc).isoformat(),
                        "message": "Independent account processes capture concurrently."})
                last_report = now
            if stop_event:
                stop_event.wait(0.5)
            else:
                time.sleep(0.5)
    finally:
        for proc, halt, _ in children.values():
            halt.set()
        for proc, _halt, _slot in children.values():
            proc.join(timeout=8)
            if proc.is_alive():
                # A broker IPC timeout is uninterruptible. Termination may
                # roll back the current SQLite transaction; the next run
                # retries from the same durable cursor and broker ticket IDs.
                proc.terminate()
                proc.join(timeout=5)
        events.close()
        if presence:
            stop_event.set()
            presence.thread.join(timeout=22)
        if report:
            report({"state": "stopped", "message": "All account processes stopped."})
