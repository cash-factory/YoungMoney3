"""YoungMoney3 Signal Desk native IPC bridge.

Line-delimited JSON over parent-owned stdio. No HTTP listening port, no API keys in
browser storage, and no credential or trade execution methods. This is a staged
bridge for the existing capture engine, not an alternative trading engine.
"""
from __future__ import annotations
import hashlib
import json
import os
import queue
import time
import re
import socket
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

STAGING = 'https://ym-fx-staging.ethical-hacker263.workers.dev'
APP_ROOT = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'YMFX'
SESSIONS = APP_ROOT / 'staging-gui' / 'preferences.json'
HEX_CODE = re.compile(r'[0-9a-fA-F]{32}\Z')
ALLOWED = frozenset({'snapshot', 'scan_terminals', 'pair_pc', 'start_monitoring',
                     'stop_monitoring', 'set_session_enabled', 'rename_session',
                     'remove_session', 'retry_session', 'open_dashboard',
                     'open_copy_studio', 'ping', 'shutdown'})


def sanitized(text: Any, limit: int = 80) -> str:
    return re.sub(r'[\x00-\x1f\x7f]', '', str(text or ''))[:limit]


class Bridge:
    def __init__(self, settings: Path = SESSIONS, *, capture=None, pairing=None, pairing_check=None):
        self.settings = Path(settings)
        self.stop = threading.Event()
        self.pause = threading.Event()
        self.worker = None
        self.state = 'unpaired'
        self.last_error = ''
        self.reports = []
        self.links: dict[str, dict] = {}
        self.session_health: dict[str, dict] = {}
        self.remote_paused_links: set[str] = set()
        self.retry_queue = queue.Queue()
        self.worker_mode = None
        self.worker_started = None
        self.queue_count = None
        self.active_worker_count = None
        self.capture = capture
        self.pairing = pairing
        self.pairing_check = pairing_check
        self._lock = threading.RLock()
        self._store = None
        self._read_store()
        self.paired = self._read_pairing()
        self.state = 'offline' if self.paired else 'unpaired'

    def _read_store(self):
        from sessions import SessionStore
        # Loading does not write session files; invalid settings must be surfaced.
        self._store = SessionStore(self.settings)

    def _read_pairing(self):
        if self.pairing_check:
            return bool(self.pairing_check())
        if sys.platform != 'win32':
            return False
        try:
            import keyring
            from keyring.backends.Windows import WinVaultKeyring
            keyring.set_keyring(WinVaultKeyring())
            name = 'YMFX MT5 ' + hashlib.sha256(STAGING.encode()).hexdigest()[:16]
            return bool(keyring.get_password(name, 'token'))
        except (ImportError, OSError, RuntimeError, ValueError):
            return False

    def _report(self, event):
        """Accept typed MT5 events without sending untrusted engine messages to WebView.

        Account-level green monitoring requires a completed capture cycle, not
        merely a paired PC or a running supervisor process.
        """
        if not isinstance(event, dict):
            return
        kind = sanitized(event.get('state'), 36)
        descriptions = {
            'running':'Capture supervisor checked in',
            'retrying':'Connector retrying after a service interruption',
            'stopped':'Capture worker stopped safely; outbox preserved',
            'error':'Connector needs attention; review local diagnostic logs',
            'paused':'Monitoring paused; recorded evidence preserved',
            'pc-online':'Paired computer confirmed online',
            'pc-reconnecting':'Computer reconnecting to YoungMoney3',
            'pc-revoked':'Device pairing revoked; capture stopped',
            'pc-identity-conflict':'Device identity conflict; capture stopped',
            'known-links':'Verified account links refreshed',
            'sync-complete':'Journal synchronization confirmed',
            'session-synced':'Broker account capture cycle completed',
            'session-error':'Broker account capture needs attention',
            'session-starting':'Broker capture process starting',
            'account-linked':'Broker login verified by the local engine',
            'account-error':'Broker login verification failed',
            'verifying':'Broker account verification in progress',
            'preparing-account':'Preparing an isolated MT5 terminal',
            'setup-error':'MT5 account setup needs attention',
            'monitoring-policy':'Monitoring policy refreshed from dashboard',
            'control-saved':'Monitoring preference saved to dashboard',
            'control-error':'Monitoring preference update failed',
            'arm-consumed':'Selected MT5 session assigned to an account',
            'paired':'Computer pairing check completed',
            'pair-success':'Computer pairing check completed',
            'worker-exit':'Capture operation ended',
            'queued':'Capture updates pending synchronization',
        }
        if kind not in descriptions:
            return
        now = datetime.now(timezone.utc).isoformat(timespec='seconds')
        with self._lock:
            if kind == 'known-links' and isinstance(event.get('links'), list):
                self.links = {str(item['slot']): {
                    'server': sanitized(item.get('server'), 72),
                    'login': sanitized(item.get('login'), 24),
                    'link': sanitized(item.get('link'), 96)}
                    for item in event['links'][:100]
                    if isinstance(item, dict) and isinstance(item.get('slot'), str)}
            elif kind == 'monitoring-policy':
                ids = event.get('paused')
                if isinstance(ids, list):
                    self.remote_paused_links = {str(v) for v in ids[:200] if isinstance(v, str)}
            if kind == 'pc-online':
                self.state = 'connected'
            elif kind in ('pc-reconnecting', 'retrying'):
                self.state = 'recovering'
            elif kind in ('pc-revoked', 'pc-identity-conflict'):
                self.state = 'attention'
                self.stop.set()
            elif kind == 'error':
                self.state = 'attention'
            elif kind in ('stopped', 'worker-exit') and self.state not in ('unpaired', 'attention'):
                self.state = 'offline'
            if kind == 'running':
                for field, target in [('queued', 'queue_count'), ('active_workers', 'active_worker_count')]:
                    count = event.get(field)
                    if type(count) is int and 0 <= count <= 1000000:
                        setattr(self, target, count)
            slot = event.get('slot')
            if isinstance(slot, str) and kind in ('session-synced', 'session-error', 'session-starting', 'verifying', 'account-error'):
                previous = self.session_health.get(slot, {})
                if kind == 'session-synced':
                    previous = {'state':'synced', 'last_sync':now, 'capture_started':self.worker_started}
                elif kind in ('session-error','account-error'):
                    previous = {**previous, 'state':'error'}
                else:
                    previous = {**previous, 'state':'starting'}
                self.session_health[slot] = previous
            if kind != 'known-links':
                # Always use a fixed, audited message. Raw MT5/HTTP exception
                # strings can contain login IDs, URL parameters, or credentials.
                self.reports.append({'time':now, 'kind':kind, 'message':descriptions[kind]})
                self.reports = self.reports[-100:]

    def snapshot(self):
        with self._lock:
            capture_active = bool(self.worker_mode == 'capture' and self.worker and self.worker.is_alive())
            rows=[]
            for entry in self._store.snapshot():
                terminal = str(entry['terminal'])
                link = self.links.get(terminal, {})
                health = self.session_health.get(terminal, {})
                present = Path(terminal).is_file()
                if not entry['enabled']:
                    status = 'paused'
                elif not present:
                    status = 'terminal-missing'
                elif not capture_active:
                    status = 'offline'
                elif link.get('link') in self.remote_paused_links:
                    status = 'paused-by-dashboard'
                elif health.get('state') == 'error':
                    status = 'needs-attention'
                elif self.state == 'recovering':
                    status = 'recovering'
                elif (self.state == 'connected' and link and
                      health.get('state') == 'synced' and
                      health.get('capture_started') == self.worker_started):
                    status = 'monitoring'
                else:
                    status = 'not-verified'
                rows.append({
                    'id':str(entry['id']), 'name':sanitized(entry['name'], 48),
                    'enabled':bool(entry['enabled']), 'terminal_present':present,
                    'server':link.get('server') or None, 'login':link.get('login') or None,
                    'status':status, 'last_sync':health.get('last_sync'),
                    'verified_link':bool(link.get('link')),
                    'copy_authorized':None,
                })
            return {'source':'local-connector', 'demo':False, 'paired':self.paired,
                    'capture_active':capture_active, 'connection_state':self.state,
                    'device':sanitized(socket.gethostname(), 64),
                    'sessions':rows, 'events':list(self.reports[-30:]),
                    'queued_updates':self.queue_count,
                    'active_capture_workers':self.active_worker_count if capture_active else 0,
                    'copying_armed':False, 'copying_armed_verified':False,
                    'copy_permission_available':False,
                    'last_error':sanitized(self.last_error, 100)}

    def _worker_main(self, pair_code=None):
        try:
            if pair_code is not None:
                if self.pairing:
                    self.pairing(pair_code, self._report)
                else:
                    import connect
                    connect.main([STAGING, '--pair', '--pair-only'], pairing_code=pair_code,
                                 stop_event=self.stop, pause_event=self.pause,
                                 report=self._report)
                self.paired = self._read_pairing()
                self.state = 'offline' if self.paired else 'unpaired'
                self._report({'state': 'paired' if self.paired else 'error',
                              'message':'Pairing verified' if self.paired else 'Pairing not verified'})
                return
            if self.capture:
                self.capture(self._report, self.stop)
            else:
                import connect
                from managed_accounts import ManagedAccounts
                manager = ManagedAccounts(self._store, self.settings.parent.parent / 'terminals')
                connect.main([STAGING, *self._store.all_terminals()], stop_event=self.stop,
                             pause_event=self.pause, report=self._report,
                             retry_queue=self.retry_queue,
                             all_slots=self._store.all_terminals,
                             active_slots=self._store.active_terminals,
                             armed_slot=self._store.armed_terminal,
                             parallel_capture=True, managed_accounts=manager)
        except BaseException as error:
            # Broker, HTTP or pairing errors may contain credentials. Expose type only.
            self.last_error = type(error).__name__[:50]
            self._report({'state':'error', 'message':'Connector needs attention. Review local logs.'})
        finally:
            self._report({'state':'worker-exit'})
            self.worker_mode = None

    def dispatch(self, method: str, params: dict | None = None):
        if method not in ALLOWED:
            raise ValueError('Unsupported desktop operation')
        if params is None: params = {}
        if not isinstance(params, dict): raise ValueError('Invalid parameters')
        if method in ('snapshot', 'ping'): return self.snapshot() if method == 'snapshot' else {'pong': True}
        if method == 'scan_terminals':
            from managed_accounts import discover_installations
            found = discover_installations()
            return {'count': len(found), 'terminals': [{'name': sanitized(p.parent.name, 70)} for p, _ in found]}
        if method == 'rename_session':
            key = params.get('id')
            name = params.get('name')
            if not isinstance(key, str) or not isinstance(name, str):
                raise ValueError('Select a local MT5 session and enter its name')
            name = name.strip()
            if not re.fullmatch(r'[\w .()&\-]{2,48}', name) or not name[0].isalnum():
                raise ValueError('Use a name of 2–48 letters, numbers or normal punctuation')
            if not any(row['id'] == key for row in self._store.snapshot()):
                raise ValueError('Session not found')
            self._store.rename(key, name)
            return {'updated':True}
        if method == 'remove_session':
            # Only a local UI shortcut is removed, never MT5 broker evidence.
            # Do not change a running supervisor's process mapping mid-cycle.
            key = params.get('id')
            if not isinstance(key, str) or params.get('confirm') != 'REMOVE':
                raise ValueError('Explicit local-session removal confirmation required')
            if self.worker and self.worker.is_alive():
                raise ValueError('Stop monitoring before removing a local session')
            if not any(row['id'] == key for row in self._store.snapshot()):
                raise ValueError('Session not found')
            self._store.remove(key)
            return {'removed':True, 'broker_evidence_preserved':True}
        if method == 'retry_session':
            key = params.get('id')
            target = next((row for row in self._store.snapshot()
                           if row['id'] == key and row['enabled']), None)
            if target is None:
                raise ValueError('Select an enabled local session')
            if not (self.worker and self.worker.is_alive() and self.worker_mode == 'capture'):
                raise ValueError('Start monitoring before retrying an account')
            slot = str(target['terminal'])
            if slot not in self.links or not Path(slot).is_file():
                raise ValueError('The account must be verified and its MT5 terminal installed')
            self.retry_queue.put_nowait(slot)
            return {'retry_queued':True, 'broker_history_recheck':True}
        if method == 'set_session_enabled':
            key = str(params.get('id', ''))
            enabled = params.get('enabled')
            if not isinstance(enabled, bool): raise ValueError('Enabled must be true or false')
            if not any(row['id'] == key for row in self._store.snapshot()):
                raise ValueError('Session not found')
            self._store.set_enabled(key, enabled)
            return {'updated': True, 'snapshot': self.snapshot()}
        if method == 'pair_pc':
            code = params.get('code')
            if not isinstance(code, str) or not HEX_CODE.fullmatch(code):
                raise ValueError('Use the 32-character pairing code')
            if self.paired: raise ValueError('This computer is already paired')
            if self.worker and self.worker.is_alive(): raise ValueError('Complete the current operation first')
            self.stop.clear()
            self.worker_mode = 'pair'
            self.worker_started = time.monotonic_ns()
            self.state = 'recovering'
            self.worker = threading.Thread(target=self._worker_main, args=(code,), daemon=False)
            self.worker.start()
            return {'accepted': True}
        if method == 'start_monitoring':
            if not self.paired: raise ValueError('Pair this computer before starting monitoring')
            if self.worker and self.worker.is_alive(): return {'already_running': True}
            self.stop.clear()
            self.pause.clear()
            self.worker_mode = 'capture'
            self.worker_started = time.monotonic_ns()
            self.session_health.clear()
            # A retry requested during an earlier worker run must not be replayed
            # unexpectedly when this broker supervisor is restarted.
            while not self.retry_queue.empty():
                try: self.retry_queue.get_nowait()
                except queue.Empty: break
            self.queue_count = None
            self.active_worker_count = None
            self.state = 'recovering'
            self.worker = threading.Thread(target=self._worker_main, daemon=False)
            self.worker.start()
            return {'accepted': True}
        if method == 'stop_monitoring':
            self.stop.set()
            self.state = 'stopping' if self.worker and self.worker.is_alive() else 'offline'
            return {'stop_requested': True, 'outbox_preserved': True}
        if method in ('open_dashboard', 'open_copy_studio'):
            import webbrowser
            target = STAGING + ('/#copy-studio' if method == 'open_copy_studio' else '/#mt5')
            return {'opened': bool(webbrowser.open(target))}
        if method == 'shutdown':
            self.stop.set()
            return {'stop_requested': True}
        raise ValueError('Unsupported desktop operation')


def serve(bridge: Bridge, input_stream=sys.stdin, output_stream=sys.stdout):
    """One JSON request per line, one reply per request; never echo raw secrets."""
    for line in input_stream:
        request = {}
        try:
            if len(line) > 8192: raise ValueError('Request too large')
            request = json.loads(line)
            if not isinstance(request, dict) or type(request.get('id')) is not int:
                raise ValueError('Invalid request')
            op = request.get('method')
            if not isinstance(op, str): raise ValueError('Invalid operation')
            data = bridge.dispatch(op, request.get('params', {}))
            reply = {'id': request['id'], 'ok': True, 'result': data}
        except (ValueError, TypeError, KeyError, OSError, RuntimeError) as ex:
            reply = {'id': request.get('id', -1) if isinstance(locals().get('request'), dict) else -1,
                     'ok': False, 'error': sanitized(str(ex), 110)}
        except BaseException:
            reply = {'id': -1, 'ok': False, 'error':'Internal bridge error'}
        output_stream.write(json.dumps(reply, separators=(',',':'), ensure_ascii=True) + '\n')
        output_stream.flush()
        if isinstance(locals().get('request'), dict) and request.get('method') == 'shutdown':
            break
    bridge.stop.set()
    if bridge.worker and bridge.worker.is_alive():
        bridge.worker.join(timeout=15)
    return 0


if __name__ == '__main__':
    # Capture engine prints do not share the JSON-RPC protocol stdout.
    # Keep a dedicated duplicated descriptor for responses before silencing
    # third-party print statements. Do not redirect globally per thread.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), 'w', encoding='utf-8', buffering=1)
    sys.stdout = open(os.devnull, 'w', encoding='utf-8')
    sys.stderr = open(os.devnull, 'w', encoding='utf-8')
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    serve(Bridge(), output_stream=protocol)