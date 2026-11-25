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
                     'stop_monitoring', 'set_session_enabled', 'open_dashboard',
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
        if not isinstance(event, dict):
            return
        kind = sanitized(event.get('state'), 36)
        allowed_states = {'running', 'retrying', 'stopped', 'error', 'paused',
                          'pc-online', 'pc-reconnecting', 'pc-revoked',
                          'pc-identity-conflict', 'known-links', 'sync-complete',
                          'paired', 'pair-success', 'worker-exit', 'queued'}
        if kind not in allowed_states:
            return
        with self._lock:
            if kind == 'known-links' and isinstance(event.get('links'), list):
                self.links = {str(item['slot']): {
                    'server': sanitized(item.get('server'), 72),
                    'login': sanitized(item.get('login'), 24)}
                    for item in event['links'][:100]
                    if isinstance(item, dict) and 'slot' in item}
            elif kind == 'pc-online':
                self.state = 'connected'
            elif kind in ('pc-reconnecting', 'retrying'):
                self.state = 'recovering'
            elif kind in ('pc-revoked', 'pc-identity-conflict'):
                self.state = 'attention'
                self.stop.set()  # capture must not continue under unsafe identity
            elif kind == 'error':
                self.state = 'attention'
            elif kind in ('stopped', 'worker-exit') and self.state not in ('unpaired','attention'):
                self.state = 'offline'
            if kind != 'known-links':
                self.reports.append({
                    'time': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                    'kind': kind,
                    'message': sanitized(event.get('message') or kind.replace('-', ' ').title(), 120)
                })
                self.reports = self.reports[-100:]

    def snapshot(self):
        with self._lock:
            connected = bool(self.worker and self.worker.is_alive())
            rows = []
            for entry in self._store.snapshot():
                terminal = str(entry['terminal'])
                link = self.links.get(terminal, {})
                rows.append({
                    'id': str(entry['id']), 'name': sanitized(entry['name'], 48),
                    'enabled': bool(entry['enabled']),
                    'terminal_present': Path(terminal).is_file(),
                    'server': link.get('server') or None,
                    'login': link.get('login') or None,
                    # status reflects observed evidence; not guessed from saved pairing
                    'status': ('monitoring' if connected and self.state == 'connected'
                               and entry['enabled'] and link else
                               'recovering' if connected and self.state == 'recovering' else
                               'not-verified'),
                    'copy_authorized': None
                })
            return {'source': 'local-connector', 'demo': False, 'paired': self.paired,
                    'capture_active': connected, 'connection_state': self.state,
                    'device': sanitized(socket.gethostname(), 64),
                    'sessions': rows, 'events': list(self.reports[-30:]),
                    'copying_armed': False, 'copying_armed_verified': False,
                    'copy_permission_available': False,
                    'last_error': sanitized(self.last_error, 100)}

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
                             retry_queue=queue.Queue(),
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
            self.state = 'recovering'
            self.worker = threading.Thread(target=self._worker_main, args=(code,), daemon=False)
            self.worker.start()
            return {'accepted': True}
        if method == 'start_monitoring':
            if not self.paired: raise ValueError('Pair this computer before starting monitoring')
            if self.worker and self.worker.is_alive(): return {'already_running': True}
            self.stop.clear()
            self.pause.clear()
            self.state = 'recovering'
            self.worker = threading.Thread(target=self._worker_main, daemon=False)
            self.worker.start()
            return {'accepted': True}
        if method == 'stop_monitoring':
            self.stop.set()
            self.state = 'offline'
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