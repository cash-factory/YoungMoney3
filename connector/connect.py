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
from spec_evidence import first_position_spec

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

sync_receipts = {}


def post(action, data, token=None):
    headers = {"Content-Type":"application/json", "User-Agent":"YoungMoney3-MT5-Connector/1.0 (Python; Windows)"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(origin+"/api/mt5/device/"+action, json.dumps(data).encode(), headers)
    try:
        with opener.open(req, timeout=20) as reply:
            return json.load(reply)
    except urllib.error.HTTPError as error:
        # The caller sees only a trusted action identifier and HTTP status.
        # Never log the response URL, request body, authorization header or
        # arbitrary server response text (which may contain sensitive data).
        error.capture_action = action
        raise

def rename_paired_pc(url, name):
    """Rename only the PC belonging to the existing Windows vault token.

    The desktop UI must never load or cache broker credentials, and must
    never depend on the long-running MT5 worker's mutable module globals.
    """
    service_name="YMFX MT5 "+hashlib.sha256(url.rstrip("/").encode()).hexdigest()[:16]
    keyring.set_keyring(WinVaultKeyring())
    saved=keyring.get_password(service_name,"token")
    if not saved:
        raise RuntimeError("Pair this PC before renaming it.")
    request=urllib.request.Request(url.rstrip("/")+"/api/mt5/device/rename",
        json.dumps({"name":name}).encode(),
        {"Content-Type":"application/json","Authorization":"Bearer "+saved},
        method="POST")
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as reply:
        return json.load(reply)


def utc(ms):
    return datetime.fromtimestamp(ms/1000, timezone.utc)

def records(result):
    if result is None:
        raise RuntimeError("MT5 data unavailable")
    return [v._asdict() for v in result]

def raw(row):
    """Preserve MT5's original fields from either API named tuples or dicts.

    MetaTrader5.history_deals_get() returns TradeDeal named tuples in real
    installations. The cash-history backfill passes them directly here.
    Requiring .items() caused a repeating AttributeError that blocked the
    entire broker scan while PC presence stayed online.
    """
    if not isinstance(row, dict):
        convert = getattr(row, "_asdict", None)
        if not callable(convert):
            raise TypeError("Unsupported MT5 record; expected a dict or named tuple.")
        row = convert()
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
    spec=first_position_spec(db,link,pid,end,lambda: symbol_spec(symbol),enqueue)
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


def _terminal_start_issue(code):
    """IPC errors are not proof that the account password was rejected."""
    return "terminal_ipc_timeout" if code in (-10003, -10005) else "terminal_start"


def terminal_account(slot, login, server, password, verify_password):
    """Attach to the assigned portable profile, then authenticate separately.

    A blank managed terminal can fail its first IPC handshake. Try launching
    exactly that executable, then retry the unauthenticated attach. Only as a
    compatibility fallback on a marked, isolated terminal may initialize()
    receive account credentials. Do not send a password to a terminal whose
    data_path fails the identity check on the ordinary path.
    """
    import subprocess

    mt5.shutdown()
    target = Path(slot).resolve().parent
    managed = (target / ".ym-managed.json").is_file()

    def attach():
        try:
            return mt5.initialize(slot, portable=True, timeout=60000)
        except TimeoutError as error:
            raise LoginFailure("terminal_ipc_timeout", -10005) from error

    if not attach():
        code = mt5.last_error()[0]
        if not managed or code not in (-10003, -10005):
            raise LoginFailure(_terminal_start_issue(code), code)
        # A fresh portable clone can still be extracting its broker configuration
        # or waiting for the first GUI startup. Never launch a different MT5.
        mt5.shutdown()
        try:
            subprocess.Popen([slot, "/portable"], cwd=str(target))
        except OSError as error:
            raise LoginFailure("terminal_start", code) from error
        if not attach():
            code = mt5.last_error()[0]
            if code not in (-10003, -10005):
                raise LoginFailure(_terminal_start_issue(code), code)
            # Some MT5 builds do not expose IPC from a completely empty profile
            # until an account is supplied at startup. This is a last resort,
            # limited to a marked managed instance, not the default login path.
            mt5.shutdown()
            try:
                ready = mt5.initialize(slot, portable=True, timeout=60000,
                                       login=login, password=password, server=server)
            except TimeoutError as error:
                raise LoginFailure("terminal_ipc_timeout", -10005) from error
            if not ready:
                code = mt5.last_error()[0]
                raise LoginFailure("broker_rejected" if code == -6 else
                                   _terminal_start_issue(code), code)

    terminal = mt5.terminal_info()
    if not terminal:
        raise LoginFailure("terminal_start")
    if Path(terminal.data_path).resolve() != target:
        raise LoginFailure("wrong_terminal")

    info = mt5.account_info()
    # A monitoring worker may reuse the already authenticated session only
    # after checking both identity fields and its actual broker connection.
    same_account = (info is not None and info.login == login
                    and info.server.casefold() == server.casefold())
    if verify_password or not same_account or not terminal.connected:
        try:
            logged_in = mt5.login(login, password=password, server=server, timeout=60000)
        except TimeoutError as error:
            raise LoginFailure("broker_login_timeout", -10005) from error
        if not logged_in:
            code = mt5.last_error()[0]
            if code == -6:
                raise LoginFailure("broker_rejected", code)
            if code in (-10003, -10005):
                raise LoginFailure("broker_login_timeout", code)
            raise LoginFailure("broker_login", code)

    terminal = mt5.terminal_info()
    info = mt5.account_info()
    if not terminal or Path(terminal.data_path).resolve() != target:
        raise LoginFailure("wrong_terminal")
    if not info or not terminal.connected:
        raise LoginFailure("disconnected")
    if info.login != login or info.server.casefold() != server.casefold():
        raise LoginFailure("identity_mismatch")
    # Standard and investor credentials are both capture-only in this program.
    return info


def verify(job, slot_override=None, report=None):
    from binascii import Error as Base64Error
    key=serialization.load_der_private_key(base64.b64decode(keyring.get_password(service,"private-a")+keyring.get_password(service,"private-b")),None)
    settings=None
    try:
        env=job["envelope"]
        aes=key.decrypt(base64.b64decode(env["wrapped"],validate=True),padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None))
        settings=json.loads(AESGCM(aes).decrypt(base64.b64decode(env["iv"]),base64.b64decode(env["data"]),None))
        login, server = int(settings["login"]),settings["server"]
        used={r[0] for r in db.execute("SELECT slot FROM links")}
        slot = slot_override if slot_override is not None else next((s for s in slots if s not in used), None)
        if slot is None or slot not in slots or slot in used:
            raise LoginFailure("no_slot")
        info=terminal_account(slot,login,server,settings["password"],verify_password=True)
        server=info.server
    except (ValueError,TypeError,KeyError,Base64Error,LoginFailure) as error:
        reason = error.reason if isinstance(error, LoginFailure) else "invalid_job"
        code = error.api_code if isinstance(error, LoginFailure) else None
        print("MT5 verification failed:", reason, code if code is not None else "", flush=True)
        if report:
            report({"state": "account-error", "slot": slot_override, "message":
                    "Account connection failed: " + reason + (f" (MT5 {code})" if code is not None else "")})
        try:
            post("verified",{"link":job["id"],"ok":False,"reason":reason,"api_code":code},token)
        except (OSError, ValueError):
            # No secrets are kept in this failed request on the PC. The
            # claimed server job expires if acknowledgement is unavailable.
            if report:
                report({"state": "account-error", "slot": slot_override,
                        "message": "Login failed locally; staging acknowledgement is pending."})
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
    # Acknowledge immediately, instead of reporting a successful broker login
    # and waiting for the next capture child to finish starting. If HTTPS
    # fails, the stored verification receipt is replayed by scan().
    acknowledged = False
    try:
        post("verified", msg, token)
    except (OSError, ValueError):
        pass
    else:
        with db:
            db.execute("UPDATE links SET verified=NULL WHERE link=?", (job["id"],))
        acknowledged = True
    if report:
        report({"state": "account-linked", "slot": slot, "link": job["id"],
                "login": str(login), "server": server, "company": info.company,
                "acknowledged": acknowledged,
                "message": "Staging accepted the broker login; journal sync is next."
                if acknowledged else "Broker login verified locally; awaiting staging acknowledgement."})

def scan(link,slot,login,server,start,cursor,last,verified,gap_pending):
    if verified:
        try:
            post("verified",json.loads(verified),token)
        except urllib.error.HTTPError as error:
            if error.code!=409: raise
            with db: db.execute("DELETE FROM links WHERE link=?",(link,))
            keyring.delete_password(service,link)
            return False
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
            # The position_observations entry above is the ONLY stop-event
            # writer for this poll. Do not overwrite that immutable evidence
            # using a second payload with the same event key.
            enqueue(link,"trade",key,fields)
        for key in previous:
            enqueue(link,"retire",key,{})
        # Each lifecycle is reconstructed from fills and original orders on the
        # same MT5/SQLite worker. Separate summaries remain immutable by version.
        settings=timezone_cache.get(link,{})
        for pid in sorted({str(p["identifier"]) for p in positions}|{str(pid) for pid in exits}):
            lifecycle_projection(link,pid,end,start,settings)
        db.execute("UPDATE links SET cursor=?,last=?,gap=? WHERE link=?",(until,end,int(gap),link))
    # Independently collect earlier cash movements without waiting for a
    # user-triggered trade-history import. The checkpoint survives restarts.
    # A failed broker query must not block live trade capture.
    try:
        from cash_history import backfill
        cash_scan=backfill(db,link,start,offset,mt5,enqueue,raw)
    except (RuntimeError, OSError, ValueError, OverflowError):
        cash_scan=None
    # Acknowledged rows only. On restart, replay with unchanged broker ticket keys.
    for _ in range(5):
        page=db.execute("SELECT seq,payload FROM outbox WHERE link=? ORDER BY seq LIMIT 24",(link,)).fetchall()
        active_history=db.execute("SELECT 1 FROM history_progress WHERE link=?",(link,)).fetchone()
        if not page and not gap and not active_history and end-heartbeats.get(link,0)<15000: break
        payload={"link":link,"events":[json.loads(row[1]) for row in page],
                 "balance":account.balance,"equity":account.equity,"gap":gap}
        # A scan checkpoint is acknowledged only with its last outbox page,
        # after all earlier cash deal evidence is in-flight or acknowledged.
        if cash_scan is not None and len(page)<24:
            payload["cashScan"]=cash_scan
        response=post("sync",payload,token)
        if isinstance(response.get("preferences"),dict):
            timezone_cache[link]=response["preferences"]
        if response.get("synced_at"):
            sync_receipts[link] = (response["synced_at"], response.get("pending_reviews"))
        heartbeats[link]=end
        with db:
            if page: db.execute("DELETE FROM outbox WHERE link=? AND seq<=?",(link,page[-1][0]))
            db.execute("UPDATE links SET gap=0 WHERE link=?",(link,))
        gap=False
        if len(page)<24: break

    request=response.get("history") if "response" in locals() else None
    if request and request["status"]=="resolving":
        from history_range import discover_deposit, clear_discovery
        request_id = str(request["id"])
        complete, deposit = discover_deposit(db, link, request_id, start, offset,
                                             request["mode"], mt5)
        if complete:
            payload = {"link": link, "request": request_id, "found": deposit is not None}
            if deposit:
                payload.update(deposit)
            post("history-anchor", payload, token)
            clear_discovery(db, link, request_id)
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
            # Long and all-history requests move in larger bounded windows.
            # Progress is durable even if the connector exits mid-import.
            window_days = 90 if request.get("mode") in ("all","since_first_deposit","since_last_deposit") else 14
            stop=min(start,cursor+window_days*86400000)
            raw_deals=records(mt5.history_deals_get(utc(max(0,cursor+offset-1000)),utc(max(0,stop+offset+1000))))
            raw_orders=records(mt5.history_orders_get(utc(max(0,cursor+offset-1000)),utc(max(0,stop+offset+1000))))
            deals=normalize(raw_deals)
            orders=normalize(raw_orders)
            with db:
                for d,original in zip(deals,raw_deals):
                    if cursor<=d["time_msc"]<stop:
                        enqueue(link,"raw","deal-"+str(d["ticket"]),raw(original))
                for order,original in zip(orders,raw_orders):
                    at=max(order.get("time_done_msc",0),order.get("time_setup_msc",0))-offset
                    if cursor<=at<stop:
                        enqueue(link,"raw","order-"+str(order["ticket"]),raw(original))
            pids={d["position_id"] for d in deals if d["type"] in (0,1) and d["entry"] in (1,2,3)
                  and cursor<=d["time_msc"]<stop}
            with db:
                db.executemany("INSERT OR IGNORE INTO history_work VALUES(?,?,?,0)",
                               [(link,request_id,str(pid)) for pid in pids])
                db.execute("UPDATE history_progress SET cursor=? WHERE link=? AND request=?",
                           (stop,link,request_id))
            cursor=stop
            post("history-progress", {"link":link,"request":request_id,
                                      "scanned_until":cursor}, token)
        work=db.execute("SELECT pid FROM history_work WHERE link=? AND request=? AND done=0 LIMIT 5",
                        (link,request_id)).fetchall()
        for (pid,) in work:
            historical_deals=records(mt5.history_deals_get(position=int(pid)))
            historical_orders=records(mt5.history_orders_get(position=int(pid)))
            history=normalize(historical_deals)
            orders={o["ticket"]:o for o in historical_orders}
            with db:
                # Preserve broker source events, including context predating the
                # requested lookback. Only approved closed fills enter journal.
                for item in historical_deals:
                    enqueue(link,"raw","deal-"+str(item["ticket"]),raw(item))
                for item in historical_orders:
                    enqueue(link,"raw","order-"+str(item["ticket"]),raw(item))
                for leg in closed_legs(history,0,orders):
                    entry_at=int(datetime.fromisoformat(leg["fields"]["entry_time"]).timestamp()*1000)
                    exit_at=int(datetime.fromisoformat(leg["fields"]["exit_time"]).timestamp()*1000)
                    deposit_mode=request.get("mode") in ("since_first_deposit","since_last_deposit")
                    if request["since"]<=exit_at<start and (not deposit_mode or entry_at>=request["since"]):
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
    elif request and request.get("status") not in ("requested","resolving"):
        # A declined/imported request must not continue scanning on this PC.
        with db:
            db.execute("DELETE FROM history_progress WHERE link=?",(link,))
            db.execute("DELETE FROM history_anchor_scan WHERE link=?",(link,))
    return True

def main(argv=None, *, pairing_code=None, stop_event=None, pause_event=None,
         report=None, active_slots=None, armed_slot=None, all_slots=None,
         parallel_capture=False, retry_queue=None, managed_accounts=None):
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
    if not slots and not (args.pair and args.pair_only) and not (parallel_capture and managed_accounts):
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
    db=sqlite3.connect(folder/"capture.db",timeout=30)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS links(link TEXT PRIMARY KEY,slot TEXT UNIQUE,login TEXT,server TEXT,start INTEGER,cursor INTEGER,last INTEGER,verified TEXT,gap INTEGER);
        CREATE TABLE IF NOT EXISTS broker_clock(link TEXT PRIMARY KEY,offset INTEGER);
        CREATE TABLE IF NOT EXISTS position_observations(link TEXT,position_id TEXT,at_ms INTEGER,sl TEXT,tp TEXT,PRIMARY KEY(link,position_id,at_ms));
        CREATE TABLE IF NOT EXISTS position_specs(link TEXT,position_id TEXT,payload TEXT,observed_at_ms INTEGER,PRIMARY KEY(link,position_id));
        CREATE TABLE IF NOT EXISTS capital_snapshots(link TEXT,at_ms INTEGER,equity TEXT,balance TEXT,PRIMARY KEY(link,at_ms));
        CREATE TABLE IF NOT EXISTS history_seed(link TEXT,request TEXT,PRIMARY KEY(link,request));
        CREATE TABLE IF NOT EXISTS history_progress(link TEXT PRIMARY KEY,request TEXT,cursor INTEGER);
        CREATE TABLE IF NOT EXISTS cash_history_scan(link TEXT PRIMARY KEY,cursor INTEGER,complete INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS history_anchor_scan(link TEXT PRIMARY KEY,request TEXT,cursor INTEGER,candidate_at INTEGER,candidate_ticket TEXT,candidate_amount REAL);
        CREATE TABLE IF NOT EXISTS history_work(link TEXT,request TEXT,pid TEXT,done INTEGER,PRIMARY KEY(link,request,pid));
        CREATE TABLE IF NOT EXISTS latest(link TEXT,key TEXT,payload TEXT,PRIMARY KEY(link,key));
        CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY,link TEXT,payload TEXT);
        CREATE INDEX IF NOT EXISTS outbox_link ON outbox(link,seq);
    """)
    if parallel_capture and not args.sync_once and not args.pair:
        from concurrent_capture import run_supervisor
        try:
            return run_supervisor(origin, db, folder/"capture.db", slots, token, report,
                                  stop_event, armed_slot, active_slots, all_slots, retry_queue, managed_accounts)
        finally:
            db.close()
    next_poll=0
    heartbeats={}
    timezone_cache={}
    failures=0
    print("Connector running. Keep this window open. Press Ctrl+C to exit.")
    linked_snapshot = db.execute("SELECT link,slot,login,server FROM links ORDER BY link").fetchall()
    if report:
        report({"state":"running","message":"Starting connector worker."})
        report({"state":"known-links", "links":[{"link": row[0], "slot": row[1],
                                                "login": row[2], "server": row[3]}
                                               for row in linked_snapshot]})
    try:
        while not (stop_event and stop_event.is_set()):
            # GUI session profiles may be added while another account is syncing.
            # Only the single capture thread updates the MT5 slot inventory.
            if all_slots is not None:
                slots = list(all_slots())
            if pause_event and pause_event.is_set():
                if report: report({"state":"paused","message":"Sync paused; pending uploads preserved."})
                if stop_event: stop_event.wait(.5)
                else: time.sleep(.5)
                continue
            failed=False
            try:
                if not args.sync_once and time.monotonic()>=next_poll:
                    # Only the selected, explicitly armed unassigned terminal
                    # may consume a website account-verification request.
                    candidate = armed_slot() if armed_slot else None
                    used = {row[0] for row in db.execute("SELECT slot FROM links").fetchall()}
                    if armed_slot is None or (candidate in slots and candidate not in used):
                        job=post("poll",{},token)["job"]
                        if job:
                            if report: report({"state":"verifying","slot":candidate,"message":"Website account request received; connecting to the selected MT5 terminal."})
                            verify(job, slot_override=candidate, report=report)
                            if report and candidate and candidate in {
                                row[0] for row in db.execute("SELECT slot FROM links").fetchall()
                            }:
                                report({"state":"arm-consumed","slot":candidate,
                                        "message":"Selected session assigned to the broker account."})
                    next_poll=time.monotonic()+5 if armed_slot else time.monotonic()+20
            except Exception as exc:
                failed=True
                print("Pairing service unavailable:",type(exc).__name__,flush=True)
            for row in db.execute("SELECT * FROM links").fetchall():
                if active_slots is not None and row[1] not in active_slots():
                    continue
                try:
                    accepted = scan(*row)
                    if report and accepted is not False:
                        report({"state":"session-synced", "slot": row[1],
                                "link": row[0], "login": row[2], "server": row[3],
                                "message":"Broker capture cycle complete; queued updates uploaded."})
                except Exception as exc:
                    failed=True
                    print("Sync pending:",row[0][:8],type(exc).__name__,flush=True)
                    if report:
                        report({"state":"session-error", "slot": row[1],
                                "link": row[0], "message":
                                "Could not sync this account (" + type(exc).__name__ +
                                "). Check terminal, broker connection and activity log."})
                finally: mt5.shutdown()
            # A staging rejection (for example a real-account release gate)
            # may revoke a pending local broker link. Keep the GUI's linked
            # state aligned with the durable SQLite assignments.
            current_links = db.execute("SELECT link,slot,login,server FROM links ORDER BY link").fetchall()
            if report and current_links != linked_snapshot:
                report({"state":"known-links", "links":[{"link": row[0], "slot": row[1],
                                                        "login": row[2], "server": row[3]}
                                                       for row in current_links]})
            linked_snapshot = current_links
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
