"""Local display/session profiles for the Windows connector.

No account passwords, pairing codes, tokens or broker evidence may be written
here. Capture evidence and credential storage remain owned by connect.py.
"""
from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path


class SessionError(ValueError):
    """Safe, user-facing session configuration failure."""


def terminal_path(value: str, *, require_file: bool = True) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SessionError("Choose a portable terminal64.exe file.")
    path = Path(value.strip()).expanduser()
    if path.name.casefold() != "terminal64.exe":
        raise SessionError("Choose an MT5 terminal64.exe, not another executable.")
    resolved = path.resolve()
    if require_file and not resolved.is_file():
        raise SessionError("This terminal64.exe is missing. Browse to its new location.")
    return str(resolved)


def path_key(path: str) -> str:
    # Windows path comparisons are case-insensitive. Normalize on Linux CI too.
    return os.path.normcase(str(Path(path).resolve())).casefold()


class SessionStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._sessions: list[dict] = []
        self._armed: str | None = None
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except (OSError, ValueError, UnicodeError) as error:
            raise SessionError("Unable to read saved sessions. No settings were overwritten.") from error
        if not isinstance(data, dict):
            raise SessionError("Invalid session settings. No settings were overwritten.")
        if isinstance(data.get("sessions"), list):
            raw = data["sessions"]
        elif isinstance(data.get("terminals"), list):
            # Upgrade the previously released staging GUI without touching
            # Credential Manager, broker links, or local capture SQLite.
            raw = [
                {"id": uuid.uuid4().hex[:12], "name": f"Session {i + 1}",
                 "terminal": value, "enabled": True}
                for i, value in enumerate(data["terminals"])
            ]
        else:
            raise SessionError("Unrecognized session settings. No settings were overwritten.")
        seen: set[str] = set()
        identifiers: set[str] = set()
        for index, item in enumerate(raw):
            if not isinstance(item, dict):
                raise SessionError("Invalid saved session record.")
            try:
                path = terminal_path(item["terminal"], require_file=False)
            except (KeyError, SessionError) as error:
                raise SessionError(f"Invalid terminal in saved session {index + 1}.") from error
            key = path_key(path)
            if key in seen:
                # Legacy settings may accidentally contain duplicate paths; a
                # single terminal must never be assigned to two sessions.
                continue
            ident = str(item.get("id", "")) or uuid.uuid4().hex[:12]
            if ident in identifiers:
                raise SessionError("Duplicate saved session identifiers.")
            name = str(item.get("name", "")).strip()[:48] or f"Session {index + 1}"
            if not isinstance(item.get("enabled", True), bool):
                raise SessionError("Invalid enabled state in saved session.")
            self._sessions.append({
                "id": ident, "name": name, "terminal": path,
                "enabled": item.get("enabled", True)
            })
            identifiers.add(ident)
            seen.add(key)

    def _save(self) -> None:
        """Atomic JSON replace; only non-secret display preferences."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({"version": 1, "sessions": self._sessions}, indent=2)
        temporary = self.path.with_name(self.path.name + "." + uuid.uuid4().hex + ".tmp")
        try:
            with temporary.open("x", encoding="utf-8") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass

    def snapshot(self) -> list[dict]:
        with self._lock:
            return [dict(session) for session in self._sessions]

    def _select(self, session_id: str) -> dict:
        for session in self._sessions:
            if session["id"] == session_id:
                return session
        raise SessionError("Choose an existing session.")

    def add(self, path: str, name: str = "") -> dict:
        resolved = terminal_path(path)
        with self._lock:
            if any(path_key(s["terminal"]) == path_key(resolved) for s in self._sessions):
                raise SessionError("This terminal already has a session. Each account needs its own portable MT5 directory.")
            name = name.strip()[:48] if isinstance(name, str) else ""
            session = {
                "id": uuid.uuid4().hex[:12], "name": name or f"Session {len(self._sessions) + 1}",
                "terminal": resolved, "enabled": True
            }
            self._sessions.append(session)
            try:
                self._save()
            except Exception:
                self._sessions.pop()
                raise
            return dict(session)

    def rename(self, session_id: str, name: str) -> None:
        if not isinstance(name, str) or not name.strip():
            raise SessionError("Enter a session name.")
        with self._lock:
            session = self._select(session_id)
            previous = session["name"]
            session["name"] = name.strip()[:48]
            try:
                self._save()
            except Exception:
                session["name"] = previous
                raise

    def set_enabled(self, session_id: str, enabled: bool) -> None:
        with self._lock:
            session = self._select(session_id)
            previous = session["enabled"]
            session["enabled"] = bool(enabled)
            if not enabled and self._armed == session_id:
                self._armed = None
            try:
                self._save()
            except Exception:
                session["enabled"] = previous
                raise

    def set_all_enabled(self, enabled: bool) -> None:
        with self._lock:
            old = [s["enabled"] for s in self._sessions]
            for session in self._sessions:
                session["enabled"] = bool(enabled)
            if not enabled:
                self._armed = None
            try:
                self._save()
            except Exception:
                for s, state in zip(self._sessions, old):
                    s["enabled"] = state
                raise

    def remove(self, session_id: str) -> None:
        """Only remove the UI profile: never delete link, outbox or credentials."""
        with self._lock:
            session = self._select(session_id)
            position = self._sessions.index(session)
            self._sessions.pop(position)
            try:
                self._save()
            except Exception:
                self._sessions.insert(position, session)
                raise
            if self._armed == session_id:
                self._armed = None

    def active_terminals(self) -> list[str]:
        with self._lock:
            return [s["terminal"] for s in self._sessions
                    if s["enabled"] and Path(s["terminal"]).is_file()]

    def all_terminals(self) -> list[str]:
        with self._lock:
            return [s["terminal"] for s in self._sessions if Path(s["terminal"]).is_file()]

    def arm(self, session_id: str) -> None:
        with self._lock:
            session = self._select(session_id)
            if not session["enabled"]:
                raise SessionError("Start this session before connecting an account.")
            terminal_path(session["terminal"])
            self._armed = session_id

    def armed_terminal(self) -> str | None:
        with self._lock:
            if not self._armed:
                return None
            session = next((s for s in self._sessions if s["id"] == self._armed), None)
            if session and session["enabled"] and Path(session["terminal"]).is_file():
                return session["terminal"]
            return None

    def clear_arm(self, terminal: str | None = None) -> None:
        with self._lock:
            if terminal is None or self.armed_terminal() == terminal:
                self._armed = None
