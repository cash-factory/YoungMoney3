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
from ledger import closed_legs, iso

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
    if not mt5.initialize(slot, portable=True, timeout=30000):
        raise LoginFailure("terminal_start", mt5.last_error()[0])
    terminal = mt5.terminal_info()
    if not terminal or Path(terminal.data_path).resolve() != Path(slot).resolve().parent:
        raise LoginFailure("wrong_terminal")
    info = mt5.account_info()
    matches = info and info.login == login and info.server.casefold() == server.casefold()
    if verify_password or not terminal.connected or not matches or info.trade_allowed:
        if not mt5.login(login, password=password, server=server, timeout=30000):
            code = mt5.last_error()[0]
            raise LoginFailure("broker_rejected" if code == -6 else "broker_login", code)
    info = mt5.account_info()
    terminal = mt5.terminal_info()
    if not info or not terminal or not terminal.connected:
        raise LoginFailure("disconnected")
    if info.login != login or info.server.casefold() != server.casefold():
        raise LoginFailure("identity_mismatch")
    if info.trade_allowed:
        raise LoginFailure("trading_access")
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
         "currency":info.currency,"balance":info.balance,"mode":info.trade_mode}
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
    account=terminal_account(slot,int(login),server,keyring.get_password(service,link),verify_password=False)
    end=int(time.time()*1000)
    # Advance a bounded history window on every cycle while catching up.
    until=min(end,cursor+86400000)
    since=max(start,cursor-300000)
    deals=records(mt5.history_deals_get(utc(since-1000),utc(until+1000)))
    orders=records(mt5.history_orders_get(utc(since-1000),utc(until+1000)))
    positions=records(mt5.positions_get())
    gap=bool(gap_pending or (last and end-last>60000))
    with db:
        for d in deals:
            if start<=d["time_msc"]<=until:
                enqueue(link,"raw","deal-"+str(d["ticket"]),raw(d))
        for order in orders:
            if start<=max(order["time_done_msc"],order["time_setup_msc"])<=until:
                enqueue(link,"raw","order-"+str(order["ticket"]),raw(order))
        exits={d["position_id"] for d in deals if d["entry"] in (1,2,3) and d["type"] in (0,1) and start<=d["time_msc"]<=until}
        for pid in exits:
            position_orders={o["ticket"]:o for o in records(mt5.history_orders_get(position=pid))}
            position_deals=records(mt5.history_deals_get(position=pid))
            for leg in closed_legs(position_deals,start,position_orders):
                enqueue(link,leg["kind"],leg["key"],leg["fields"])
        previous={row[0] for row in db.execute("SELECT key FROM latest WHERE link=? AND key LIKE 'open-%' AND json_extract(payload,'$.kind')='trade'",(link,))}
        for p in positions:
            ident=str(p["identifier"])
            key="open-"+ident
            previous.discard(key)
            fields={"pair":p["symbol"],"direction":"long" if p["type"]==0 else "short","status":"open",
                    "entry_time":iso(p["time_msc"]),"entry_price":p["price_open"],"exit_price":None,"exit_time":None,
                    "pnl":0,"lot_size":p["volume"],"stop_loss":p["sl"] or None,"take_profit":p["tp"] or None,
                    "broker_details":{"position_id":ident,"ticket":str(p["ticket"]),"initial_risk_known":False}}
            prior=db.execute("SELECT payload FROM latest WHERE link=? AND key=?",(link,key)).fetchone()
            if prior:
                old=json.loads(prior[0])["fields"]
                if (old.get("stop_loss"),old.get("take_profit"))!=(fields["stop_loss"],fields["take_profit"]):
                    enqueue(link,"raw",f"stops-{ident}-{end}",{"observed_at":iso(end),"sl":p["sl"],"tp":p["tp"]})
            enqueue(link,"trade",key,fields)
        for key in previous:
            enqueue(link,"retire",key,{})
        db.execute("UPDATE links SET cursor=?,last=?,gap=? WHERE link=?",(until,end,int(gap),link))
    # Acknowledged rows only. On restart, replay with unchanged broker ticket keys.
    for _ in range(5):
        page=db.execute("SELECT seq,payload FROM outbox WHERE link=? ORDER BY seq LIMIT 24",(link,)).fetchall()
        if not page and not gap and end-heartbeats.get(link,0)<60000: break
        post("sync",{"link":link,"events":[json.loads(row[1]) for row in page],"balance":account.balance,"equity":account.equity,"gap":gap},token)
        heartbeats[link]=end
        with db:
            if page: db.execute("DELETE FROM outbox WHERE link=? AND seq<=?",(link,page[-1][0]))
            db.execute("UPDATE links SET gap=0 WHERE link=?",(link,))
        gap=False
        if len(page)<24: break

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("origin",help="HTTPS origin of your dashboard")
    parser.add_argument("slots",nargs="+",help="Full paths to dedicated portable MT5 terminal64.exe copies")
    parser.add_argument("--pair",action="store_true")
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
        code=getpass.getpass("Website pairing code: ").strip().lower()
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
        CREATE TABLE IF NOT EXISTS latest(link TEXT,key TEXT,payload TEXT,PRIMARY KEY(link,key));
        CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY,link TEXT,payload TEXT);
        CREATE INDEX IF NOT EXISTS outbox_link ON outbox(link,seq);
    """)
    next_poll=0
    heartbeats={}
    failures=0
    print("Connector running. Keep this window open. Press Ctrl+C to exit.")
    try:
        while True:
            failed=False
            try:
                if time.monotonic()>=next_poll:
                    job=post("poll",{},token)["job"]
                    if job: verify(job)
                    next_poll=time.monotonic()+20
            except Exception as exc:
                failed=True
                print("Pairing service unavailable:",type(exc).__name__,flush=True)
            for row in db.execute("SELECT * FROM links").fetchall():
                try: scan(*row)
                except Exception as exc:
                    failed=True
                    print("Sync pending:",row[0][:8],type(exc).__name__,flush=True)
                finally: mt5.shutdown()
            failures=min(failures+1,5) if failed else 0
            time.sleep(min(60,2**(failures+1)))
    except KeyboardInterrupt:
        mt5.shutdown()
