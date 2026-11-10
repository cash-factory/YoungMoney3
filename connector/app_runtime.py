"""Local configuration and process control for the Windows connector desktop app."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
from urllib.parse import urlsplit

APP_VERSION = "0.2.0-staging"
DEFAULT_ORIGIN = "https://ym-fx-staging.ethical-hacker263.workers.dev"


def canonical_origin(value: str) -> str:
    parsed = urlsplit(value.strip().rstrip("/"))
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.path or parsed.query or parsed.fragment):
        raise ValueError("Enter the HTTPS dashboard address without a page path.")
    return parsed.geturl().rstrip("/")


def app_folder() -> Path:
    folder = Path(os.environ["LOCALAPPDATA"]) / "YMFX"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def load_settings() -> dict:
    path = app_folder() / "desktop-settings.json"
    try:
        settings = json.loads(path.read_text(encoding="utf-8"))
        return {"origin": canonical_origin(settings["origin"]),
                "terminals": [str(Path(p)) for p in settings.get("terminals", [])]}
    except (OSError, ValueError, KeyError, TypeError):
        return {"origin": DEFAULT_ORIGIN, "terminals": []}


def save_settings(origin: str, terminals: list[str]) -> None:
    path = app_folder() / "desktop-settings.json"
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({"version": APP_VERSION, "origin": canonical_origin(origin),
                                     "terminals": terminals}, indent=2), encoding="utf-8")
    temporary.replace(path)


def discover_terminals() -> list[str]:
    found = set()
    roots = [Path(os.environ.get("PROGRAMFILES", "C:/Program Files")),
             Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)"))]
    for root in roots:
        if not root.exists():
            continue
        for entry in root.glob("*/terminal64.exe"):
            found.add(str(entry))
    for entry in (app_folder() / "terminals").glob("*/terminal64.exe"):
        found.add(str(entry))
    return sorted(found, key=str.casefold)


def terminal_path(value: str) -> str:
    path = Path(value).resolve(strict=True)
    if path.name.lower() != "terminal64.exe" or not path.is_file():
        raise ValueError("Select MetaTrader 5's terminal64.exe.")
    return str(path)


def create_terminal(source: str, origin: str, occupied: list[str]) -> str:
    source_path = Path(terminal_path(source))
    scope = hashlib.sha256(canonical_origin(origin).encode()).hexdigest()[:16]
    root = app_folder() / "terminals" / scope
    root.mkdir(parents=True, exist_ok=True)
    index = 1
    while (root / f"Account-{index}").exists():
        index += 1
    folder = root / f"Account-{index}"
    folder.mkdir()
    destination = folder / "terminal64.exe"
    shutil.copy2(source_path, destination)
    if str(destination) in occupied:
        raise ValueError("This terminal is already configured.")
    return str(destination)


def service_name(origin: str) -> str:
    return "YMFX MT5 " + hashlib.sha256(canonical_origin(origin).encode()).hexdigest()[:16]


def read_capture_status(origin: str) -> dict:
    """Read health metadata using the same per-origin identity as the CLI."""
    import keyring
    from keyring.backends.Windows import WinVaultKeyring
    keyring.set_keyring(WinVaultKeyring())
    token = keyring.get_password(service_name(origin), "token")
    if not token:
        return {"paired": False, "accounts": 0, "queued": 0, "last_sync": None, "terminals": []}
    scope = hashlib.sha256((canonical_origin(origin) + token).encode()).hexdigest()[:20]
    path = app_folder() / scope / "capture.db"
    result = {"paired": True, "accounts": 0, "queued": 0, "last_sync": None, "terminals": []}
    if not path.exists():
        return result
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=1) as database:
        result["terminals"] = [row[0] for row in database.execute("SELECT slot FROM links ORDER BY start")]
        result["accounts"] = database.execute("SELECT count(*) FROM links").fetchone()[0]
        result["queued"] = database.execute("SELECT count(*) FROM outbox").fetchone()[0]
        result["last_sync"] = database.execute("SELECT max(last) FROM links").fetchone()[0]
    return result


class InstanceLock:
    """Keep a single desktop engine per dashboard origin and Windows user."""
    def __init__(self, origin: str):
        import msvcrt
        key = hashlib.sha256(canonical_origin(origin).encode()).hexdigest()[:16]
        self.signal = app_folder() / ("activate-" + key)
        self.file = (app_folder() / ("desktop-" + key + ".lock")).open("a+b")
        self.file.seek(0)
        if not self.file.read(1):
            self.file.write(b"0")
            self.file.flush()
        self.file.seek(0)
        try:
            msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            self.signal.touch()
            self.file.close()
            raise RuntimeError("The connector is already open for this dashboard.")

    def close(self) -> None:
        import msvcrt
        self.file.seek(0)
        msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
        self.file.close()


class EngineProcess:
    def __init__(self):
        self.process = None
        self.stop_file = None
        self.log_file = None
        self.log_position = 0
        self.log_handle = None

    @property
    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def start(self, origin: str, terminals: list[str], pair_code: str = "") -> None:
        if self.running:
            raise ValueError("Pause the connector before changing its setup.")
        if not terminals:
            raise ValueError("Add a dedicated MT5 terminal before starting.")
        origin = canonical_origin(origin)
        paths = [terminal_path(path) for path in terminals]
        if len(set(paths)) != len(paths):
            raise ValueError("Each account needs a different dedicated terminal.")
        scope = hashlib.sha256(origin.encode()).hexdigest()[:16]
        self.stop_file = app_folder() / ("stop-" + scope)
        self.stop_file.unlink(missing_ok=True)
        self.log_file = app_folder() / ("engine-" + scope + ".log")
        self.log_position = 0
        args = [origin, *paths, "--stop-file", str(self.stop_file)]
        if pair_code:
            code = pair_code.strip().lower()
            if len(code) != 32 or any(c not in "0123456789abcdef" for c in code):
                raise ValueError("Paste the complete 32-character pairing code from the website.")
            args += ["--pair", "--pair-code-stdin"]
        if getattr(sys, "frozen", False):
            command = [sys.executable, "--engine", *args]
        else:
            command = [sys.executable, str(Path(__file__).with_name("desktop.py")), "--engine", *args]
        environment = dict(os.environ)
        environment["YMFX_ENGINE_LOG"] = str(self.log_file)
        environment["PYTHONUNBUFFERED"] = "1"
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        env=environment, creationflags=subprocess.CREATE_NO_WINDOW)
        if pair_code:
            self.process.stdin.write((code + "\n").encode())
            self.process.stdin.flush()
        self.process.stdin.close()

    def pause(self) -> None:
        if self.running and self.stop_file:
            self.stop_file.touch()

    def messages(self) -> list[str]:
        if not self.log_file or not self.log_file.exists():
            return []
        with self.log_file.open("r", encoding="utf-8", errors="replace") as stream:
            stream.seek(self.log_position)
            lines = stream.read().splitlines()
            self.log_position = stream.tell()
        return lines[-30:]
