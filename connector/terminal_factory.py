"""Safely create isolated MT5 portable installations from existing program files.

Never clone an active terminal's broker login/cache, config, trade data,
MQL5 EAs/scripts, history, credentials or junction/symlink contents.
The original terminal is read-only; no account-specific files are copied.
"""
from __future__ import annotations

import errno
import json
import os
import re
import shutil
import threading
import uuid
from pathlib import Path

class TerminalCopyError(ValueError):
    """Safe-to-display terminal creation error with a bounded diagnostic code."""

    def __init__(self, message, *, code="copy_failed", retry_source=False):
        super().__init__(message)
        self.code = code
        self.retry_source = retry_source


def _io_problem(error, stage, *, source=False):
    """Describe an OS failure without exposing user paths or account files."""
    win = getattr(error, "winerror", None)
    err = getattr(error, "errno", None)
    number = win if isinstance(win, int) else err
    label = f" (Windows error {number})" if number is not None else ""
    if win in (112, 39) or err == errno.ENOSPC:
        return TerminalCopyError(
            "Not enough free disk space for the separate MT5 terminal" + label + ".",
            code="disk_full")
    if win in (32, 33) or err == errno.EBUSY:
        return TerminalCopyError(
            "An MT5 program file is temporarily locked" + label +
            ". Close the MetaTrader installer/updater and try again.",
            code="source_busy", retry_source=source)
    if win in (2, 3) or err == errno.ENOENT:
        return TerminalCopyError(
            "An MT5 installation file disappeared during setup" + label +
            ". Finish any MetaTrader update and retry.",
            code="source_changed", retry_source=source)
    if win in (5, 19) or err in (errno.EACCES, errno.EPERM, errno.EROFS):
        return TerminalCopyError(
            "Windows denied access while " + stage + label +
            ". Check Windows Security and your MT5 installation permissions.",
            code="access_denied", retry_source=source)
    if win == 206 or err == errno.ENAMETOOLONG:
        return TerminalCopyError(
            "An MT5 installation path is too long for Windows" + label + ".",
            code="path_too_long", retry_source=source)
    return TerminalCopyError(
        "Windows could not finish " + stage + label +
        ". Try a different detected MT5 installation or review Windows Security.",
        code="copy_failed", retry_source=source)

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
    except OSError as error:
        raise _io_problem(error, "reading the installed MT5 program", source=True) from error
    except RuntimeError as error:
        raise TerminalCopyError("The installed MT5 program path cannot be resolved.",
                                code="source_changed", retry_source=True) from error
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
    try:
        managed.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise _io_problem(error, "creating the YoungMoney3 terminal folder") from error
    ident = uuid.uuid4().hex[:12]
    destination = managed / f"{slug}-{ident}"
    staging = managed / f".{slug}-{ident}.pending"
    if destination.exists() or staging.exists():
        raise TerminalCopyError("Terminal destination already exists. Choose another name.")

    count, total_bytes = 0, 0
    try:
        staging.mkdir(mode=0o700)
        def walk_error(error):
            raise _io_problem(error, "reading installed MT5 folders", source=True) from error
        for current, dirs, files in os.walk(folder, followlinks=False, onerror=walk_error):
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
                try:
                    size = origin.stat().st_size
                except OSError as error:
                    raise _io_problem(error, "reading an installed MT5 file", source=True) from error
                count += 1
                total_bytes += size
                if count > MAX_SOURCE_FILES or total_bytes > MAX_SOURCE_BYTES:
                    raise TerminalCopyError("MT5 installation exceeds the 2 GB safety limit.",
                                            code="copy_limit", retry_source=True)
                target = target_dir / filename
                try:
                    shutil.copyfile(origin, target, follow_symlinks=False)
                except OSError as error:
                    raise _io_problem(error, "copying installed MT5 program files",
                                      source=True) from error
                if progress and (count == 1 or count % 20 == 0):
                    progress({"files": count, "bytes": total_bytes})
        if not (staging / "terminal64.exe").is_file():
            raise TerminalCopyError("The source does not contain required terminal files.")
        broker_cache = "not_available"
        if broker_directory is not None:
            directory = Path(broker_directory)
            # The broker server index is only a hint. A running MT5 may hold
            # the cache locked, and the installer can replace it any time.
            if (directory.name.casefold() == "servers.dat"
                    and directory.parent.name.casefold() == "config"
                    and not _is_link(directory) and not _is_link(directory.parent)):
                try:
                    if directory.is_file() and directory.stat().st_size <= 32 * 1024 * 1024:
                        (staging / "config").mkdir(exist_ok=True)
                        shutil.copyfile(directory, staging / "config" / "servers.dat",
                                        follow_symlinks=False)
                        broker_cache = "copied"
                except OSError:
                    broker_cache = "unavailable"
                    try:
                        (staging / "config" / "servers.dat").unlink(missing_ok=True)
                    except OSError:
                        pass
        marker = {
            "schema": 1,
            "kind": "youngmoney3-portable-mt5",
            "name": name.strip()[:48],
            "generated_blank_profile": True,
            "broker_cache": broker_cache,
        }
        (staging / ".ym-managed.json").write_text(
            json.dumps(marker, indent=2), encoding="utf-8")
        _check_cancel(cancel)
        staging.rename(destination)
    except Exception as error:
        shutil.rmtree(staging, ignore_errors=True)
        if isinstance(error, TerminalCopyError):
            raise
        if isinstance(error, OSError):
            raise _io_problem(error, "preparing the isolated terminal") from error
        # Never display a raw exception: it may contain private Windows paths.
        raise TerminalCopyError(
            "Terminal setup failed unexpectedly (" + type(error).__name__ +
            "). Please report this error type to support.",
            code="unexpected_setup_error") from error
    return destination / "terminal64.exe"
