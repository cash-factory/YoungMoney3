"""Read-only Windows MT5 connector. Start from its own directory."""
import argparse
import base64
import getpass
import hashlib
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import MetaTrader5 as mt5
import keyring
from keyring.backends.Windows import WinVaultKeyring
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from ledger import closed_legs, iso, position_lifecycles
from metrics import ensure_capture_schema, capture_entry_risks, stored_risks, observe_stops, instrument_snapshot, add_current_exposure

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

def post(action, data, token=None):
    headers = {"Content-Type":"application/json", "User-Agent":"YoungMoney3-MT5-Connector/1.0 (Python; Windows)"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(origin+"/api/mt5/device/"+action, json.dumps(data).encode(), headers)
    with opener.open(req, timeout=20) as reply:
        return json.load(reply)

def utc(ms):
    return datetime.fromtimestamp(ms/1000, timezone.utc)

def records(result):
    if result is None:
        raise RuntimeError("MT5 data unavailable")
    return [v._asdict() for v in result]

def raw(row):
    # Preserve unsigned 64-bit ticket numbers through JavaScript JSON.
    return {k: str(v) if k in ("order","ticket","identifier","position_id","position_by_id","magic") else v for k,v in row.items()}

def enqueue(link, kind, key, fields):
    payload=json.dumps({"kind":kind,"key":key,"fields":fields}, sort_keys=True)
    prior=db.execute("SELECT payload FROM latest WHERE link=? AND key=?",(link,key)).fetchone()
    if prior and prior[0]==payload:
        return
    db.execute("INSERT OR REPLACE INTO latest VALUES(?,?,?)",(link,key,payload))
    db.execute("INSERT INTO outbox(link,payload) VALUES(?,?)",(link,payload))

class LoginFailure(Exception):
    def __init__(self, reason, api_code=None):
        super().__init__(reason)
        self.reason = reason
        self.api_code = api_code


def terminal_account(slot, login, server, password, verify_password):
    """Attach to this portable terminal; authenticate with its broker server directory."""
    # MT5 can wait for a broker session before completing its Python IPC handshake.
    # Supply the requested identity during startup, including on an empty terminal profile.
    mt5.shutdown()
    if not mt5.initialize(slot, portable=True, timeout=60000,
                          login=login, password=password, server=server):
        code = mt5.last_error()[0]
        raise LoginFailure("broker_rejected" if code == -6 else "terminal_start", code)
    terminal = mt5.terminal_info()
    if not terminal or Path(terminal.data_path).resolve() != Path(slot).resolve().parent:
        raise LoginFailure("wrong_terminal")
    info = mt5.account_info()
    terminal = mt5.terminal_info()
    if not info or not terminal or not terminal.connected:
        raise LoginFailure("disconnected")
    if info.login != login or info.server.casefold() != server.casefold():
        raise LoginFailure("identity_mismatch")
    # Standard broker credentials are permitted for observation only.
    # Trading permissions in the local MT5 terminal remain outside this app.
    return info


def verify(job):
    from binascii import Error as Base64Error
    key=serialization.load_der_private_key(base64.b64decode(keyring.get_password(service,"private-a")+keyring.get_password(service,"private-b")),None)
    settings=None
    try:
        env=job["envelope"]
        aes=key.decrypt(base64.b64decode(env["wrapped"],validate=True),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
        settings=json.loads(AESGCM(aes).decrypt(base64.b64decode(env["iv"]),base64.b64decode(env["data"]),None))
        login, server = int(settings["login"]),settings["server"]
        used={r[0] for r in db.execute("SELECT slot FROM links")}
        slot=next((s for s in slots if s not in used),None)
        if slot is None:
            raise LoginFailure("no_slot")
        info=terminal_account(slot,login,server,settings["password"],verify_password=True)
        server=info.server
    except (ValueError,TypeError,KeyError,Base64Error,LoginFailure) as error:
        reason = error.reason if isinstance(error, LoginFailure) else "invalid_job"
        code = error.api_code if isinstance(error, LoginFailure) else None
        print("MT5 verification failed:", reason, code if code is not None else "", flush=True)
        post("verified",{"link":job["id"],"ok":False,"reason":reason,"api_code":code},token)
        return
    finally:
        mt5.shutdown()
    start=int(time.time()*1000)
    # Persist link details before acknowledgement so an ambiguous network failure can be retried.
    msg={"link":job["id"],"ok":True,"login":str(login),"server":server,"company":info.company,
         "currency":info.currency,"balance":info.balance,"mode":info.trade_mode,
         "trade_access":bool(info.trade_allowed)}
    keyring.set_password(service,job["id"],settings["password"])
    with db:
        db.execute("INSERT INTO links VALUES(?,?,?,?,?,?,?,?,?)",(job["id"],slot,str(login),server,start,start,0,json.dumps(msg),0))

def scan(link,slot,login,server,start,cursor,last,verified,gap_pending):
    if verified:
        try:
            post("verified",json.loads(verified),token)
        except urllib.error.HTTPError as error:
            if error.code!=409: raise
            with db: db.execute("DELETE FROM links WHERE link=?",(link,))
            keyring.delete_password(service,link)
            return
        with db: db.execute("UPDATE links SET verified=NULL WHERE link=?",(link,))
    ensure_capture_schema(db)
    account=terminal_account(slot,int(login),server,keyring.get_password(service,link),verify_password=False)
    end=int(time.time()*1000)
    prior_clock=db.execute("SELECT offset FROM broker_clock WHERE link=?",(link,)).fetchone()
    offset=prior_clock[0] if prior_clock else 0
    clock_known=prior_clock is not None
    candidates=records(mt5.positions_get())
    symbols=[p["symbol"] for p in candidates]
    if not symbols:
        recent=records(mt5.history_deals_get(utc(end-86400000),utc(end+86400000)))
        symbols=list(dict.fromkeys(d["symbol"] for d in recent if d["symbol"]))[-10:]
    # A quote from a closed market can be hours old. Never treat its age as a
    # broker timezone offset. Only use fresh, advancing quotes to update this
    # account's inferred clock offset; otherwise preserve the last known value.
    for symbol in symbols[:8]:
        earlier=mt5.symbol_info_tick(symbol)
        if not earlier:
            continue
        time.sleep(0.08)
        tick=mt5.symbol_info_tick(symbol)
        if tick and tick.time_msc>earlier.time_msc:
            observed=int(time.time()*1000)
            delta=tick.time_msc-observed
            rounded=round(delta/900000)*900000
            if abs(delta-rounded)<30000 and abs(rounded)<=14*3600000:
                offset=rounded
                clock_known=True
                with db: db.execute("INSERT OR REPLACE INTO broker_clock VALUES(?,?)",(link,offset))
                break
    def normalize(rows):
        return [{**{k:(v-offset if k.endswith("_msc") and v else v) for k,v in row.items()},
                 "broker_time_msc": row.get("time_msc"), "broker_offset_ms": offset} for row in rows]

    # Advance a bounded history window on every cycle while catching up.
    until=min(end,cursor+86400000)
    since=max(start,cursor-86400000)
    deals=normalize(records(mt5.history_deals_get(utc(since+offset-1000),utc(until+offset+1000))))
    orders=normalize(records(mt5.history_orders_get(utc(since+offset-1000),utc(until+offset+1000))))
    positions=records(mt5.positions_get())
    gap=bool(gap_pending or (last and end-last>60000))
    with db:
        for d in deals:
            if start<=d["time_msc"]<=until:
                enqueue(link,"raw","deal-"+str(d["ticket"]),raw(d))
        for order in orders:
            if start<=max(order["time_done_msc"],order["time_setup_msc"])<=until:
                enqueue(link,"raw","order-"+str(order["ticket"]),raw(order))
        current_positions={str(p["identifier"]): p for p in positions}
        for position in positions:
            observe_stops(db,link,position,end)
        affected={d["position_id"] for d in deals if d["type"] in (0,1) and start<=d["time_msc"]<=until}
        affected.update(int(pid) for pid in current_positions)
        for pid in affected:
            position_orders={o["ticket"]:o for o in records(mt5.history_orders_get(position=pid))}
            position_deals=normalize(records(mt5.history_deals_get(position=pid)))
            symbol=next((d["symbol"] for d in position_deals if d.get("symbol")),None)
            if not symbol:
                continue
            def symbol_lookup(name):
                value=mt5.symbol_info(name)
                return value._asdict() if value else None
            capture_entry_risks(db,link,position_deals,position_orders,current_positions,end,start,
                                symbol_lookup,mt5.order_calc_profit,getattr(account,"currency",None),account.balance)
            observations=[json.loads(row[0]) for row in db.execute(
                "SELECT payload FROM execution_stops WHERE link=? AND position=? ORDER BY observed",(link,str(pid)))]
            for lifecycle in position_lifecycles(position_deals,position_orders,stored_risks(db,link),
                                                instrument_snapshot(symbol_lookup(symbol)),observations,
                                                current_positions.get(str(pid)),
                                                "inferred_offset" if clock_known else "unknown"):
                add_current_exposure(lifecycle,current_positions.get(str(pid)),mt5.order_calc_profit)
                fields=lifecycle["fields"]
                metrics=fields["execution_metrics"]
                if int(datetime.fromisoformat(fields["entry_time"]).timestamp()*1000)<start:
                    metrics["position_open_at_link"]=True
                    if any(int(datetime.fromisoformat(fill["time"]).timestamp()*1000)<start for fill in metrics["exits"]):
                        metrics["completeness"].append("prelink_partial_history")
                if fields["status"]=='open' or int(datetime.fromisoformat(fields["exit_time"]).timestamp()*1000)>=start:
                    enqueue(link,'lifecycle',lifecycle['key'],fields)
        # The Worker retires legacy open/close rows atomically when accepting a lifecycle.
        db.execute("UPDATE links SET cursor=?,last=?,gap=? WHERE link=?",(until,end,int(gap),link))
    # Acknowledged rows only. On restart, replay with unchanged broker ticket keys.
    for _ in range(5):
        page=db.execute("SELECT seq,payload FROM outbox WHERE link=? ORDER BY seq LIMIT 4",(link,)).fetchall()
        active_history=db.execute("SELECT 1 FROM history_progress WHERE link=?",(link,)).fetchone()
        if not page and not gap and not active_history and end-heartbeats.get(link,0)<15000: break
        response=post("sync",{"link":link,"events":[json.loads(row[1]) for row in page],"balance":account.balance,"equity":account.equity,"gap":gap},token)
        heartbeats[link]=end
        print("YM3_STATUS "+json.dumps({"state":"synced", "last_sync":int(time.time()*1000),
                                      "account_suffix":str(login)[-4:]}),flush=True)
        with db:
            if page: db.execute("DELETE FROM outbox WHERE link=? AND seq<=?",(link,page[-1][0]))
            db.execute("UPDATE links SET gap=0 WHERE link=?",(link,))
        gap=False
        if len(page)<4: break

    request=response.get("history") if "response" in locals() else None
    if request and request["status"]=="requested":
        request_id=str(request["id"])
        progress=db.execute("SELECT cursor FROM history_progress WHERE link=? AND request=?",(link,request_id)).fetchone()
        if progress is None:
            # New request supersedes a completed or cancelled lookback.
            with db:
                db.execute("DELETE FROM history_progress WHERE link=?",(link,))
                db.execute("INSERT INTO history_progress VALUES(?,?,?)",(link,request_id,int(request["since"])))
            progress=(int(request["since"]),)
        cursor=progress[0]
        if cursor < start:
            # Bound each request to a small UTC window; persist cursor to resume
            # after a shutdown, HTTP error or disconnected broker.
            stop=min(start,cursor+7*86400000)
            deals=normalize(records(mt5.history_deals_get(utc(cursor+offset-1000),utc(stop+offset+1000))))
            pids={d["position_id"] for d in deals if d["type"] in (0,1) and d["entry"] in (1,2,3)
                  and cursor<=d["time_msc"]<stop}
            with db:
                db.executemany("INSERT OR IGNORE INTO history_work VALUES(?,?,?,0)",
                               [(link,request_id,str(pid)) for pid in pids])
                db.execute("UPDATE history_progress SET cursor=? WHERE link=? AND request=?",
                           (stop,link,request_id))
            cursor=stop
        work=db.execute("SELECT pid FROM history_work WHERE link=? AND request=? AND done=0 LIMIT 5",
                        (link,request_id)).fetchall()
        for (pid,) in work:
            history=normalize(records(mt5.history_deals_get(position=int(pid))))
            orders={o["ticket"]:o for o in records(mt5.history_orders_get(position=int(pid)))}
            with db:
                symbol=next((d["symbol"] for d in history if d.get("symbol")),None)
                def history_symbol(name):
                    value=mt5.symbol_info(name)
                    return value._asdict() if value else None
                capture_entry_risks(db,link,history,orders,{},end,start,history_symbol,
                                    mt5.order_calc_profit,getattr(account,"currency",None),None)
                observations=[json.loads(row[0]) for row in db.execute(
                    "SELECT payload FROM execution_stops WHERE link=? AND position=? ORDER BY observed",(link,str(pid)))]
                for lifecycle in position_lifecycles(history,orders,stored_risks(db,link),
                                                    instrument_snapshot(history_symbol(symbol)) if symbol else None,
                                                    observations,time_quality="historical_offset_unconfirmed"):
                    if lifecycle["fields"]["status"]!='closed':
                        continue
                    closed_ms=int(datetime.fromisoformat(lifecycle["fields"]["exit_time"]).timestamp()*1000)
                    if request["since"]<=closed_ms<start:
                        lifecycle["fields"]["historical_import"]=True
                        enqueue(link,"history","history:"+request_id+":"+lifecycle["key"],lifecycle["fields"])
                db.execute("UPDATE history_work SET done=1 WHERE link=? AND request=? AND pid=?",
                           (link,request_id,pid))
        pending=db.execute("SELECT 1 FROM history_work WHERE link=? AND request=? AND done=0",
                           (link,request_id)).fetchone()
        unsent=db.execute("SELECT 1 FROM outbox WHERE link=?",(link,)).fetchone()
        if cursor>=start and not pending and not unsent:
            complete=post("sync",{"link":link,"events":[],"history_done":request_id},token)
            if complete.get("history",{}).get("status")!="requested":
                with db: db.execute("DELETE FROM history_progress WHERE link=? AND request=?",(link,request_id))
    elif request and request.get("status")!="requested":
        # A declined/imported request must not continue scanning on this PC.
        with db: db.execute("DELETE FROM history_progress WHERE link=?",(link,))

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("origin",help="HTTPS origin of your dashboard")
    parser.add_argument("slots",nargs="+",help="Full paths to dedicated portable MT5 terminal64.exe copies")
    parser.add_argument("--pair",action="store_true")
    parser.add_argument("--pair-code-stdin",action="store_true",help=argparse.SUPPRESS)
    parser.add_argument("--stop-file",help=argparse.SUPPRESS)
    parser.add_argument("--sync-once",action="store_true",help="Reconcile saved accounts once, then exit")
    args=parser.parse_args()
    origin=args.origin.rstrip("/")
    parsed=urlsplit(origin)
    if parsed.scheme!="https" or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        parser.error("Use an HTTPS dashboard origin")
    slots=[str(Path(s).resolve(strict=True)) for s in args.slots]
    if len(set(slots))!=len(slots) or any(Path(s).name.lower()!="terminal64.exe" for s in slots):
        parser.error("Supply different dedicated terminal64.exe paths")
    opener=urllib.request.build_opener(NoRedirect())
    service="YMFX MT5 "+hashlib.sha256(origin.encode()).hexdigest()[:16]
    keyring.set_keyring(WinVaultKeyring())
    if args.pair:
        private=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        pub=private.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
        code=(sys.stdin.readline() if args.pair_code_stdin else getpass.getpass("Website pairing code: ")).strip().lower()
        if len(code)!=32 or any(c not in "0123456789abcdef" for c in code):
            sys.exit("Copy the full 32-character code from Account settings > Pair a PC.")
        try:
            result=post("claim",{"code":code,"publicKey":base64.b64encode(pub).decode()})
        except urllib.error.HTTPError as error:
            message=error.read(1024)
            if b"1010" in message:
                sys.exit("Cloudflare rejected the connector before the pairing request reached the dashboard (1010).")
            if error.code==403 and b"Pairing code expired or already used." in message:
                sys.exit("Pairing code did not match an active code. Click Pair a PC and copy the new code within five minutes.")
            sys.exit(f"Dashboard pairing failed (HTTP {error.code}).")
        # Store DER in base64 to fit Windows Credential Manager's blob size.
        encoded=base64.b64encode(private.private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())).decode()
        keyring.set_password(service,"private-a",encoded[:850])
        keyring.set_password(service,"private-b",encoded[850:])
        keyring.set_password(service,"token",result["token"])
    token=keyring.get_password(service,"token")
    if not token: sys.exit("Pair this PC first with --pair.")
    folder=Path(os.environ["LOCALAPPDATA"])/"YMFX"/hashlib.sha256((origin+token).encode()).hexdigest()[:20]
    folder.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(folder/"capture.db")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS links(link TEXT PRIMARY KEY,slot TEXT UNIQUE,login TEXT,server TEXT,start INTEGER,cursor INTEGER,last INTEGER,verified TEXT,gap INTEGER);
        CREATE TABLE IF NOT EXISTS broker_clock(link TEXT PRIMARY KEY,offset INTEGER);
        CREATE TABLE IF NOT EXISTS history_seed(link TEXT,request TEXT,PRIMARY KEY(link,request));
        CREATE TABLE IF NOT EXISTS history_progress(link TEXT PRIMARY KEY,request TEXT,cursor INTEGER);
        CREATE TABLE IF NOT EXISTS history_work(link TEXT,request TEXT,pid TEXT,done INTEGER,PRIMARY KEY(link,request,pid));
        CREATE TABLE IF NOT EXISTS latest(link TEXT,key TEXT,payload TEXT,PRIMARY KEY(link,key));
        CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY,link TEXT,payload TEXT);
        CREATE INDEX IF NOT EXISTS outbox_link ON outbox(link,seq);
    """)
    ensure_capture_schema(db)
    next_poll=0
    heartbeats={}
    failures=0
    print("Connector running. Keep this window open. Press Ctrl+C to exit.")
    try:
        while True:
            if args.stop_file and Path(args.stop_file).exists(): break
            failed=False
            try:
                if not args.sync_once and time.monotonic()>=next_poll:
                    job=post("poll",{},token)["job"]
                    if job: verify(job)
                    next_poll=time.monotonic()+20
            except Exception as exc:
                failed=True
                print("Pairing service unavailable:",type(exc).__name__,flush=True)
            for row in db.execute("SELECT * FROM links").fetchall():
                if args.stop_file and Path(args.stop_file).exists(): break
                try: scan(*row)
                except Exception as exc:
                    failed=True
                    print("Sync pending:",row[0][:8],type(exc).__name__,flush=True)
                finally: mt5.shutdown()
            if args.sync_once:
                if failed: sys.exit(1)
                break
            failures=min(failures+1,5) if failed else 0
            pause_until=time.monotonic()+min(60,2**(failures+1))
            while time.monotonic()<pause_until:
                if args.stop_file and Path(args.stop_file).exists(): break
                time.sleep(0.25)
    except KeyboardInterrupt:
        mt5.shutdown()

