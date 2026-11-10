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
from lifecycle import reconstruct

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
    # The original MT5 numeric/time fields are never normalized in evidence.
    return {k: str(v) if k in ("order","ticket","identifier","position_id","position_by_id","magic") else v for k,v in row.items()}

def symbol_spec(symbol):
    info=mt5.symbol_info(symbol)
    if not info:
        return {"symbol":symbol,"specification_status":"unknown"}
    fields=raw(info._asdict())
    # Explicit MT5 calc modes define FX; never infer FX from symbol spelling.
    fields["is_forex"]=info.trade_calc_mode in (
        getattr(mt5,"SYMBOL_CALC_MODE_FOREX",0),
        getattr(mt5,"SYMBOL_CALC_MODE_FOREX_NO_LEVERAGE",5))
    return fields

def lifecycle_projection(link,pid,end,start,timezone_settings):
    """Replay one complete broker position on the single capture worker thread."""
    history=records(mt5.history_deals_get(position=int(pid)))
    if not history:
        return
    orders=records(mt5.history_orders_get(position=int(pid)))
    # Preserve raw immutable broker evidence, including openings before linking
    # if they belong to an active/closing lifecycle. Do not import unrelated
    # historical positions before their explicit preview approval.
    for deal in history:
        enqueue(link,"raw","deal-"+str(deal["ticket"]),raw(deal))
    for order in orders:
        enqueue(link,"raw","order-"+str(order["ticket"]),raw(order))
    symbol=next((d["symbol"] for d in history if d.get("symbol")),"")
    if not symbol:
        return
    spec=symbol_spec(symbol)
    spec_key="spec-"+hashlib.sha256(json.dumps(spec,sort_keys=True,default=str).encode()).hexdigest()[:28]
    enqueue(link,"raw",spec_key,{"position_id":str(pid),**spec})
    observed=[{"position_id":str(pid),"time_msc":row[0],"sl":row[1],"tp":row[2]}
              for row in db.execute("SELECT at_ms,sl,tp FROM position_observations WHERE link=? AND position_id=? ORDER BY at_ms",(link,str(pid)))]
    capital=[{"at_ms":row[0],"equity":row[1],"balance":row[2]}
             for row in db.execute("SELECT at_ms,equity,balance FROM capital_snapshots WHERE link=? ORDER BY at_ms",(link,))]
    settings=timezone_settings or {}
    for record in reconstruct(history,{o["ticket"]:o for o in orders},observed,spec,
                              capital_samples=capital,
                              broker_timezone=settings.get("broker_timezone"),
                              timezone_confirmed=bool(settings.get("timezone_confirmed_at")),
                              conversion_provenance=settings.get("utc_conversion_status"),
                              observed_at_ms=end):
        # A historical closed lifecycle is not implicitly imported by a live
        # scan. Preserve the existing history-review approval boundary.
        last=record.get("final_exit_at")
        if record["status"]=="closed" and last and int(datetime.fromisoformat(last).timestamp()*1000)<start:
            continue
        enqueue(link,"lifecycle","lifecycle:"+record["lifecycle_id"],record)


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
    account=terminal_account(slot,int(login),server,keyring.get_password(service,link),verify_password=False)
    end=int(time.time()*1000)
    prior_clock=db.execute("SELECT offset FROM broker_clock WHERE link=?",(link,)).fetchone()
    offset=prior_clock[0] if prior_clock else 0
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
                with db: db.execute("INSERT OR REPLACE INTO broker_clock VALUES(?,?)",(link,offset))
                break
    def normalize(rows):
        return [{k:(v-offset if k.endswith("_msc") and v else v) for k,v in row.items()} for row in rows]

    # Advance a bounded history window on every cycle while catching up.
    until=min(end,cursor+86400000)
    since=max(start,cursor-86400000)
    raw_deals=records(mt5.history_deals_get(utc(since+offset-1000),utc(until+offset+1000)))
    raw_orders=records(mt5.history_orders_get(utc(since+offset-1000),utc(until+offset+1000)))
    deals=normalize(raw_deals)
    orders=normalize(raw_orders)
    positions=records(mt5.positions_get())
    gap=bool(gap_pending or (last and end-last>60000))
    with db:
        db.execute("INSERT OR REPLACE INTO capital_snapshots(link,at_ms,equity,balance) VALUES(?,?,?,?)",
                   (link,end,str(account.equity),str(account.balance)))
        for d,original in zip(deals,raw_deals):
            if start<=d["time_msc"]<=until:
                enqueue(link,"raw","deal-"+str(d["ticket"]),raw(original))
        for order,original in zip(orders,raw_orders):
            if start<=max(order["time_done_msc"],order["time_setup_msc"])<=until:
                enqueue(link,"raw","order-"+str(order["ticket"]),raw(original))
        exits={d["position_id"] for d in deals if d["entry"] in (1,2,3) and d["type"] in (0,1) and start<=d["time_msc"]<=until}
        for pid in exits:
            position_orders={o["ticket"]:o for o in records(mt5.history_orders_get(position=pid))}
            position_deals=normalize(records(mt5.history_deals_get(position=pid)))
            for leg in closed_legs(position_deals,start,position_orders):
                previous_open=db.execute("SELECT payload FROM latest WHERE link=? AND key=?",(link,"open-"+str(pid))).fetchone()
                if previous_open:
                    previous_fields=json.loads(previous_open[0])["fields"]
                    for level in ("stop_loss","take_profit"):
                        leg["fields"][level]=leg["fields"].get(level) or previous_fields.get(level)
                enqueue(link,leg["kind"],leg["key"],leg["fields"])
        previous={row[0] for row in db.execute("SELECT key FROM latest WHERE link=? AND key LIKE 'open-%' AND json_extract(payload,'$.kind')='trade'",(link,))}
        for p in positions:
            ident=str(p["identifier"])
            key="open-"+ident
            prior_observed=db.execute("SELECT sl,tp FROM position_observations WHERE link=? AND position_id=? ORDER BY at_ms DESC LIMIT 1",(link,ident)).fetchone()
            measured=(str(p["sl"] or 0),str(p["tp"] or 0))
            if prior_observed is None or prior_observed!=measured:
                db.execute("INSERT OR IGNORE INTO position_observations(link,position_id,at_ms,sl,tp) VALUES(?,?,?,?,?)",
                           (link,ident,end,*measured))
                enqueue(link,"raw",f"stops-{ident}-{end}",{
                    "position_id":ident,"time_msc":end,"observed_at":iso(end),
                    "sl":measured[0],"tp":measured[1],"provenance":"first_observed" if prior_observed is None else "observed_change"})
            position_snapshot=raw(p)
            position_snapshot["position_id"]=ident
            snapshot_key=hashlib.sha256(json.dumps(position_snapshot,sort_keys=True,default=str).encode()).hexdigest()[:22]
            enqueue(link,"raw","position-"+ident+"-"+snapshot_key,position_snapshot)
            previous.discard(key)
            fields={"pair":p["symbol"],"direction":"long" if p["type"]==0 else "short","status":"open",
                    "entry_time":iso(p["time_msc"]-offset),"entry_price":p["price_open"],"exit_price":None,"exit_time":None,
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
        # Each lifecycle is reconstructed from fills and original orders on the
        # same MT5/SQLite worker. Separate summaries remain immutable by version.
        settings=timezone_cache.get(link,{})
        for pid in sorted({str(p["identifier"]) for p in positions}|{str(pid) for pid in exits}):
            lifecycle_projection(link,pid,end,start,settings)
        db.execute("UPDATE links SET cursor=?,last=?,gap=? WHERE link=?",(until,end,int(gap),link))
    # Acknowledged rows only. On restart, replay with unchanged broker ticket keys.
    for _ in range(5):
        page=db.execute("SELECT seq,payload FROM outbox WHERE link=? ORDER BY seq LIMIT 24",(link,)).fetchall()
        active_history=db.execute("SELECT 1 FROM history_progress WHERE link=?",(link,)).fetchone()
        if not page and not gap and not active_history and end-heartbeats.get(link,0)<15000: break
        response=post("sync",{"link":link,"events":[json.loads(row[1]) for row in page],"balance":account.balance,"equity":account.equity,"gap":gap},token)
        if isinstance(response.get("preferences"),dict):
            timezone_cache[link]=response["preferences"]
        heartbeats[link]=end
        with db:
            if page: db.execute("DELETE FROM outbox WHERE link=? AND seq<=?",(link,page[-1][0]))
            db.execute("UPDATE links SET gap=0 WHERE link=?",(link,))
        gap=False
        if len(page)<24: break

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
                for leg in closed_legs(history,0,orders):
                    if request["since"]<=int(datetime.fromisoformat(leg["fields"]["exit_time"]).timestamp()*1000)<start:
                        leg["fields"]["historical_import"]=True
                        enqueue(link,"history","history:"+request_id+":"+leg["key"],leg["fields"])
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

def main(argv=None, *, pairing_code=None, stop_event=None, pause_event=None, report=None):
    """CLI and GUI entrypoint; MT5 and SQLite run on this one worker thread."""
    global origin, slots, opener, service, token, db, heartbeats, timezone_cache
    parser=argparse.ArgumentParser()
    parser.add_argument("origin",help="HTTPS origin of your dashboard")
    parser.add_argument("slots",nargs="*",help="Full paths to dedicated portable MT5 terminal64.exe copies")
    parser.add_argument("--pair",action="store_true")
    parser.add_argument("--sync-once",action="store_true",help="Reconcile saved accounts once, then exit")
    parser.add_argument("--pair-only",action="store_true",help="Pair and return without starting capture")
    args=parser.parse_args(argv)
    origin=args.origin.rstrip("/")
    parsed=urlsplit(origin)
    if parsed.scheme!="https" or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        parser.error("Use an HTTPS dashboard origin")
    slots=[str(Path(s).resolve(strict=True)) for s in args.slots]
    if not slots and not (args.pair and args.pair_only):
        parser.error("Select a dedicated terminal64.exe before syncing")
    if len(set(slots))!=len(slots) or any(Path(s).name.lower()!="terminal64.exe" for s in slots):
        parser.error("Supply different dedicated terminal64.exe paths")
    opener=urllib.request.build_opener(NoRedirect())
    service="YMFX MT5 "+hashlib.sha256(origin.encode()).hexdigest()[:16]
    keyring.set_keyring(WinVaultKeyring())
    if args.pair:
        private=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        pub=private.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
        code=(pairing_code if pairing_code is not None else getpass.getpass("Website pairing code: ")).strip().lower()
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
        if report: report({"state":"paired","message":"PC pairing completed."})
        if args.pair_only: return 0
    token=keyring.get_password(service,"token")
    if not token: sys.exit("Pair this PC first with --pair.")
    folder=Path(os.environ["LOCALAPPDATA"])/"YMFX"/hashlib.sha256((origin+token).encode()).hexdigest()[:20]
    folder.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(folder/"capture.db")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS links(link TEXT PRIMARY KEY,slot TEXT UNIQUE,login TEXT,server TEXT,start INTEGER,cursor INTEGER,last INTEGER,verified TEXT,gap INTEGER);
        CREATE TABLE IF NOT EXISTS broker_clock(link TEXT PRIMARY KEY,offset INTEGER);
        CREATE TABLE IF NOT EXISTS position_observations(link TEXT,position_id TEXT,at_ms INTEGER,sl TEXT,tp TEXT,PRIMARY KEY(link,position_id,at_ms));
        CREATE TABLE IF NOT EXISTS capital_snapshots(link TEXT,at_ms INTEGER,equity TEXT,balance TEXT,PRIMARY KEY(link,at_ms));
        CREATE TABLE IF NOT EXISTS history_seed(link TEXT,request TEXT,PRIMARY KEY(link,request));
        CREATE TABLE IF NOT EXISTS history_progress(link TEXT PRIMARY KEY,request TEXT,cursor INTEGER);
        CREATE TABLE IF NOT EXISTS history_work(link TEXT,request TEXT,pid TEXT,done INTEGER,PRIMARY KEY(link,request,pid));
        CREATE TABLE IF NOT EXISTS latest(link TEXT,key TEXT,payload TEXT,PRIMARY KEY(link,key));
        CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY,link TEXT,payload TEXT);
        CREATE INDEX IF NOT EXISTS outbox_link ON outbox(link,seq);
    """)
    next_poll=0
    heartbeats={}
    timezone_cache={}
    failures=0
    print("Connector running. Keep this window open. Press Ctrl+C to exit.")
    if report: report({"state":"running","message":"Starting connector worker."})
    try:
        while not (stop_event and stop_event.is_set()):
            if pause_event and pause_event.is_set():
                if report: report({"state":"paused","message":"Sync paused; pending uploads preserved."})
                if stop_event: stop_event.wait(.5)
                else: time.sleep(.5)
                continue
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
                try: scan(*row)
                except Exception as exc:
                    failed=True
                    print("Sync pending:",row[0][:8],type(exc).__name__,flush=True)
                finally: mt5.shutdown()
            if args.sync_once:
                if failed: sys.exit(1)
                break
            failures=min(failures+1,5) if failed else 0
            if report:
                report({"state":"retrying" if failed else "running",
                        "queued":db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0],
                        "linked":db.execute("SELECT COUNT(*) FROM links").fetchone()[0],
                        "last_sync":datetime.now(timezone.utc).isoformat(),
                        "message":"Broker/connection error; check terminal logs." if failed else "Capture cycle complete."})
            delay=min(60,2**(failures+1))
            if stop_event: stop_event.wait(delay)
            else: time.sleep(delay)
    except KeyboardInterrupt:
        pass
    finally:
        mt5.shutdown()
        db.close()
        if report: report({"state":"stopped","message":"Capture stopped; outbox preserved."})
    return 0



if __name__=="__main__":
    main()
