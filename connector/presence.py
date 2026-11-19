"""Keep a paired PC visible even while MT5 is idle, starting, or retrying."""
import json
import threading
import urllib.error


class DevicePresence:
    interval = 12

    def __init__(self, request, setup, report, stop):
        self.request, self.setup, self.report, self.stop = request, setup, report, stop
        self._lock = threading.Lock()
        self._latest = None
        self._state = None
        self.thread = threading.Thread(target=self.run, name="YMFX-paired-PC", daemon=True)

    def snapshot(self):
        with self._lock:
            return self._latest

    def emit(self, state, **details):
        signature = (state, details.get("setup"), details.get("device"))
        if self.report and self._state != signature:
            self.report({"state": state, **details})
        self._state = signature

    def check(self):
        try:
            setup = "ready" if self.setup.sources() else "install"
            reply = self.request({"setup": setup, "version": "0.4.1-rc2"})
            if (not isinstance(reply, dict) or not reply.get("device")
                    or not isinstance(reply.get("paused"), list)):
                self.emit("pc-service-incompatible")
                return False
            with self._lock:
                self._latest = reply
            self.emit("pc-online", device=reply["device"], setup=setup)
            return True
        except urllib.error.HTTPError as error:
            if error.code in (404, 405):
                # A new desktop binary against an older Worker must not look
                # like a revoked pairing or an unexplained broker disconnect.
                self.emit("pc-service-incompatible")
                return False
            if error.code in (401, 403):
                try:
                    revoked = json.loads(error.read(512)).get("code") == "device_revoked"
                except (ValueError, OSError):
                    revoked = False
                if revoked:
                    self.emit("pc-revoked")
                    self.stop.set()
                    return False
        except (OSError, ValueError, TypeError, AttributeError):
            # Discovery can race an MT5 install/remove; retry without
            # dropping the saved pairing or stopping this thread.
            pass
        self.emit("pc-reconnecting")
        return False

    def run(self):
        delay = 3
        while not self.stop.is_set():
            ok = self.check()
            self.stop.wait(self.interval if ok else delay)
            delay = 3 if ok else min(delay * 2, 20)
