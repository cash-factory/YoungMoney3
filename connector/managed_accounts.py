"""Find installed MT5 programs and prepare isolated accounts without a file picker."""
from __future__ import annotations

import os
import re
import queue
import threading
import time
from pathlib import Path

from terminal_factory import TerminalCopyError, create_terminal, _is_link
from sessions import path_key

INSTALL_PAGE = "https://www.metatrader5.com/en/download"


def _children(folder):
    try:
        return [entry for entry in folder.iterdir() if entry.is_dir() and not _is_link(entry)]
    except OSError:
        return []


def _origin(profile):
    marker = profile / "origin.txt"
    try:
        if _is_link(marker) or not marker.is_file() or marker.stat().st_size > 8192:
            return None
        raw = marker.read_bytes()
        encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-16-le" if b"\0" in raw else "utf-8-sig"
        value = raw.decode(encoding).strip("\x00\r\n ")
        return Path(value) if value and Path(value).is_absolute() else None
    except (OSError, UnicodeError, ValueError):
        return None


def _registered_folders():
    if os.name != "nt":
        return []
    import winreg
    locations = []
    key = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
            try:
                with winreg.OpenKey(hive, key, 0, winreg.KEY_READ | view) as parent:
                    for i in range(winreg.QueryInfoKey(parent)[0]):
                        try:
                            with winreg.OpenKey(parent, winreg.EnumKey(parent, i)) as app:
                                value, _ = winreg.QueryValueEx(app, "InstallLocation")
                                if isinstance(value, str) and value:
                                    locations.append(Path(os.path.expandvars(value.strip('"'))))
                        except OSError:
                            continue
            except OSError:
                continue
    return locations


def discover_installations():
    roots = [Path(v) for k in ("ProgramW6432", "ProgramFiles", "ProgramFiles(x86)") if (v := os.getenv(k))]
    local = os.getenv("LOCALAPPDATA")
    if local:
        roots.append(Path(local) / "Programs")
    roaming = os.getenv("APPDATA")
    profiles = _children(Path(roaming) / "MetaQuotes" / "Terminal") if roaming else []
    return find_installations(roots, profiles, _registered_folders())


def find_installations(roots, profiles, registered=()):
    # MetaTrader's per-user origin markers also cover custom installation paths.
    installs = {}
    def include(folder, profile=None):
        if not folder or not folder.is_absolute() or folder.drive.startswith(chr(92)) or _is_link(folder):
            return
        exe = folder / "terminal64.exe"
        try:
            if not exe.is_file() or _is_link(exe) or not exe.stat().st_size:
                return
            config = (profile or folder) / "config"
            servers = config / "servers.dat"
            usable = not _is_link(config) and not _is_link(servers) and servers.is_file()
            key = path_key(str(exe.resolve()))
            if key not in installs or usable:
                installs[key] = (exe.resolve(), servers if usable else None)
        except (OSError, ValueError):
            pass
    for root in roots:
        for folder in _children(root):
            include(folder)
    for folder in registered:
        include(folder)
    for profile in sorted(profiles):
        include(_origin(profile), profile)
    return list(installs.values())


class ManagedAccounts:
    def __init__(self, store, root, discover=discover_installations):
        self.store, self.root, self.discover = store, Path(root), discover
        self.controls = queue.Queue()
        self._sources = []
        self._next_check = 0
        self._lock = threading.Lock()

    def sources(self):
        with self._lock:
            if time.monotonic() >= self._next_check:
                self._sources = self.discover()
                # Existing user-configured portable installs also work after an upgrade.
                known = {path_key(str(exe)) for exe, _ in self._sources}
                for path in self.store.all_terminals():
                    if path_key(path) not in known:
                        self._sources.append((Path(path), None))
                self._next_check = time.monotonic() + (60 if self._sources else 8)
            return list(self._sources)

    def prepare(self, server, used, stop):
        used = {path_key(path) for path in used}
        armed = self.store.armed_terminal()
        if armed and path_key(armed) not in used:
            return armed
        sources = self.sources()
        if not sources:
            raise TerminalCopyError("Install MetaTrader 5 on this PC to add an account.")
        def broker_match(item):
            label = re.sub(r"[^a-z0-9]", "", item[0].parent.name.lower())
            words = re.findall(r"[a-z]{3,}", server.lower())
            return (sum(len(w) for w in words if w not in ("demo", "real", "live", "server") and w in label), bool(item[1]))
        # An interrupted signup or rejected password can reuse a clean slot from that broker.
        slug = server.strip()[:40] or "MT5"
        for session in self.store.snapshot():
            exe = Path(session["terminal"])
            if (session["enabled"] and path_key(str(exe)) not in used and session["name"] == slug
                    and path_key(str(exe.parent.parent)) == path_key(str(self.root))
                    and (exe.parent / ".ym-managed.json").is_file() and exe.is_file()):
                return str(exe)
        last_source_issue = None
        for source, directory in sorted(sources, key=broker_match, reverse=True):
            if stop.is_set():
                raise TerminalCopyError("Terminal creation was cancelled safely.", code="cancelled")
            try:
                target = create_terminal(source, self.root, slug,
                                         broker_directory=directory, cancel=stop)
            except TerminalCopyError as error:
                if not error.retry_source:
                    raise
                last_source_issue = error
                continue
            return self.store.add(str(target), slug)["terminal"]
        if last_source_issue is not None:
            raise last_source_issue
        raise TerminalCopyError("No usable MT5 installation was found.",
                                code="no_installation")
