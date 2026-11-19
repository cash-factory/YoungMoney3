"""Safely create isolated MT5 portable installations from existing program files.

Never clone an active terminal's broker login/cache, config, trade data,
MQL5 EAs/scripts, history, credentials or junction/symlink contents.
The original terminal is read-only; no account-specific files are copied.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import threading
import uuid
from pathlib import Path

class TerminalCopyError(ValueError):
    """Safe-to-display terminal creation error."""

# These folders may contain broker account credentials, trading strategies,
# user-generated data, log files, or other private terminal state.
EXCLUDED_DIRS = frozenset({
    "config", "bases", "profiles", "logs", "tester", "mql5",
    "history", "mailbox", "cache", "data", "files", "origin",
    "common", "backup", "backups", "webinstall",
})
EXCLUDED_SUFFIXES = frozenset({
    ".dat", ".log", ".ini", ".cfg", ".bak", ".tmp", ".key",
    ".pem", ".pfx", ".mq5", ".ex5", ".set", ".hcc", ".hst",
})
EXCLUDED_FILES = frozenset({"ym-managed.json", ".ym-managed.json"})
MAX_SOURCE_FILES = 12000
MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024

def _is_link(path: Path) -> bool:
    return path.is_symlink() or bool(getattr(path, "is_junction", lambda: False)())

def _safe_slug(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TerminalCopyError("Give the new terminal an identifying name.")
    # A UI label does not become a Windows path verbatim.
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")[:35]
    if not slug:
        raise TerminalCopyError("Use letters or numbers in the terminal name.")
    return slug

def _check_cancel(cancel: threading.Event | None):
    if cancel is not None and cancel.is_set():
        raise TerminalCopyError("Terminal creation was cancelled safely.")

def create_terminal(
    source_exe: str | Path,
    root: str | Path,
    name: str,
    *,
    progress=None,
    broker_directory: Path | None = None,
    cancel: threading.Event | None = None,
) -> Path:
    """Return an isolated terminal64.exe; never copy logged-in terminal data.

    Only a brand new subdirectory inside root is created. An incomplete copy
    stays in a .pending folder and is removed on failure/cancellation.
    """
    slug = _safe_slug(name)
    source_path = Path(source_exe).expanduser()
    if source_path.name.lower() != "terminal64.exe" or _is_link(source_path):
        raise TerminalCopyError("Select a real terminal64.exe executable, not a shortcut or link.")
    try:
        source = source_path.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise TerminalCopyError("Source terminal is missing or inaccessible.") from error
    if not source.is_file() or source.stat().st_size == 0:
        raise TerminalCopyError("Source terminal64.exe is not a readable MT5 installation.")
    folder = source.parent
    if _is_link(folder):
        raise TerminalCopyError("Source terminal directory cannot be a junction or shortcut.")

    managed = Path(root).expanduser().resolve()
    try:
        managed.relative_to(folder)
    except ValueError:
        pass
    else:
        raise TerminalCopyError("Managed terminals cannot be created inside the source installation.")

    _check_cancel(cancel)
    managed.mkdir(parents=True, exist_ok=True)
    ident = uuid.uuid4().hex[:12]
    destination = managed / f"{slug}-{ident}"
    staging = managed / f".{slug}-{ident}.pending"
    if destination.exists() or staging.exists():
        raise TerminalCopyError("Terminal destination already exists. Choose another name.")

    count, total_bytes = 0, 0
    try:
        staging.mkdir(mode=0o700)
        for current, dirs, files in os.walk(folder, followlinks=False):
            _check_cancel(cancel)
            current_path = Path(current)
            relative = current_path.relative_to(folder)
            dirs[:] = [d for d in dirs
                       if d.casefold() not in EXCLUDED_DIRS
                       and not _is_link(current_path / d)]
            target_dir = staging / relative
            target_dir.mkdir(parents=True, exist_ok=True)
            for filename in files:
                _check_cancel(cancel)
                origin = current_path / filename
                if (_is_link(origin) or not origin.is_file()
                    or filename.casefold() in EXCLUDED_FILES
                    or origin.suffix.casefold() in EXCLUDED_SUFFIXES):
                    continue
                size = origin.stat().st_size
                count += 1
                total_bytes += size
                if count > MAX_SOURCE_FILES or total_bytes > MAX_SOURCE_BYTES:
                    raise TerminalCopyError("MT5 installation exceeds the safe copy limit.")
                target = target_dir / filename
                shutil.copyfile(origin, target, follow_symlinks=False)
                if progress and (count == 1 or count % 20 == 0):
                    progress({"files": count, "bytes": total_bytes})
        if not (staging / "terminal64.exe").is_file():
            raise TerminalCopyError("The source does not contain required terminal files.")
        if broker_directory is not None:
            directory = Path(broker_directory)
            if (directory.name.casefold() != "servers.dat" or directory.parent.name.casefold() != "config"
                    or _is_link(directory) or _is_link(directory.parent) or not directory.is_file()
                    or directory.stat().st_size > 32 * 1024 * 1024):
                raise TerminalCopyError("The broker server directory changed. Try Add account again.")
            (staging / "config").mkdir(exist_ok=True)
            shutil.copyfile(directory, staging / "config" / "servers.dat", follow_symlinks=False)
        marker = {
            "schema": 1,
            "kind": "youngmoney3-portable-mt5",
            "name": name.strip()[:48],
            "generated_blank_profile": True,
        }
        (staging / ".ym-managed.json").write_text(
            json.dumps(marker, indent=2), encoding="utf-8")
        _check_cancel(cancel)
        staging.rename(destination)
    except Exception as error:
        shutil.rmtree(staging, ignore_errors=True)
        if isinstance(error, TerminalCopyError):
            raise
        raise TerminalCopyError("Could not create the terminal. Check permissions and free disk space.") from error
    return destination / "terminal64.exe"
