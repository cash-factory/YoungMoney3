"""Read-only, Windows-owned MT5 account discovery for Signal Desk.

Device authentication never leaves the Python service. Discovery probes each
isolated terminal in a *separate* process; no passwords, orders, or broker
execution requests are accepted by this module.
"""
from __future__ import annotations

import hashlib
import math
import json
import multiprocessing
import os
import queue
import sqlite3
import urllib.request
from pathlib import Path

from service_channel import SERVICE_ORIGIN as ORIGIN


class DiscoveryError(ValueError):
    pass


def request_device(action: str, payload: dict):
    """Authenticated POST; credentials remain in Windows Credential Manager."""
    from keyring.backends.Windows import WinVaultKeyring
    import keyring
    keyring.set_keyring(WinVaultKeyring())
    service = 'YMFX MT5 ' + hashlib.sha256(ORIGIN.encode()).hexdigest()[:16]
    token = keyring.get_password(service, 'token')
    if not token:
        raise DiscoveryError('Pair this computer with YoungMoney3 first')
    from pc_identity import installation_id
    body = dict(payload)
    body['installationId'] = installation_id(ORIGIN)
    req = urllib.request.Request(ORIGIN + '/api/mt5/device/' + action,
        json.dumps(body,separators=(',',':')).encode('utf-8'),
        {'Content-Type':'application/json','Authorization':'Bearer '+token},method='POST')
    from connect import NoRedirect
    with urllib.request.build_opener(NoRedirect()).open(req,timeout=20) as response:
        return json.load(response)


def _probe_worker(path: str, results):
    """Child process: attach to exactly one local terminal, read account_info."""
    try:
        import MetaTrader5 as mt5
        exe = Path(path).resolve(strict=True)
        if exe.name.lower()!='terminal64.exe' or not (exe.parent/'.ym-managed.json').is_file():
            results.put({'status':'unmanaged'}); return
        if not mt5.initialize(str(exe),portable=True,timeout=14000):
            results.put({'status':'not-connected'}); return
        info=mt5.account_info()
        term=mt5.terminal_info()
        if (not info or not term or not term.connected or
                Path(term.data_path).resolve()!=exe.parent):
            results.put({'status':'not-connected'}); return
        login=int(info.login)
        if login<=0 or login>2**63-1 or not info.server:
            results.put({'status':'not-connected'});return
        if int(info.trade_mode) not in (0,1,2) or not math.isfinite(float(info.balance)):
            results.put({'status':'not-connected'});return
        results.put({'status':'verified','login':str(login),'server':str(info.server)[:128],
                     'account_name':str(info.name or '')[:96],
                     'company':str(info.company or '')[:128],
                     'currency':str(info.currency or '')[:12],
                     'mode':int(info.trade_mode),
                     'balance':float(info.balance),
                     'trade_access':bool(info.trade_allowed)})
    except (OSError,RuntimeError,TypeError,ValueError,AttributeError):
        results.put({'status':'not-connected'})
    finally:
        try: mt5.shutdown()
        except (NameError,RuntimeError,AttributeError):pass


def probe_terminal(path: str, timeout: int = 22) -> dict:
    """Bound MT5 IPC hangs. One unresponsive terminal cannot freeze the UI."""
    ctx=multiprocessing.get_context('spawn')
    result=ctx.Queue(maxsize=1)
    proc=ctx.Process(target=_probe_worker,args=(str(path),result),daemon=True)
    try:
        proc.start()
        try:return result.get(timeout=timeout)
        except queue.Empty:return {'status':'timeout'}
    finally:
        if proc.is_alive():proc.terminate()
        proc.join(timeout=4)
        result.close()


def adopted_link_database(token: str, app_root: Path) -> Path:
    """Use the capture engine's established token-scoped SQLite location."""
    name=hashlib.sha256((ORIGIN+token).encode()).hexdigest()[:20]
    return app_root/name/'capture.db'


def persist_manual_link(database: Path, link: str, slot: str, broker: dict):
    """Idempotent local link receipt, without storing or fabricating a password."""
    database.parent.mkdir(parents=True,exist_ok=True)
    receipt={'link':link,'ok':True,'login':broker['login'],'server':broker['server'],
             'company':broker['company'],'currency':broker['currency'],
             'balance':broker['balance'],'mode':broker['mode'],
             'trade_access':broker['trade_access']}
    import time
    now=int(time.time()*1000)
    with sqlite3.connect(database,timeout=30) as db:
        db.execute('PRAGMA busy_timeout=30000')
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE IF NOT EXISTS links(link TEXT PRIMARY KEY, slot TEXT UNIQUE, login TEXT, server TEXT, start INTEGER, cursor INTEGER, last INTEGER, verified TEXT, gap INTEGER)')
        existing=db.execute('SELECT link,login,server FROM links WHERE slot=?',(slot,)).fetchone()
        if existing and (existing[0]!=link or existing[1]!=broker['login'] or existing[2].casefold()!=broker['server'].casefold()):
            raise DiscoveryError('This MT5 terminal is already assigned to another broker account')
        with db:
            db.execute('INSERT OR IGNORE INTO links VALUES(?,?,?,?,?,?,?,?,?)',
                       (link,slot,broker['login'],broker['server'],now,now,0,json.dumps(receipt,separators=(',',':')),0))
            db.execute('UPDATE links SET verified=? WHERE link=?',(json.dumps(receipt,separators=(',',':')),link))
    return receipt


def clear_receipt(database: Path, link: str):
    with sqlite3.connect(database,timeout=30) as db:
        with db:db.execute('UPDATE links SET verified=NULL WHERE link=?',(link,))