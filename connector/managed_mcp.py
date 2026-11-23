"""Disable MT5's unused *internal MCP server* only on YM-FX-owned portable profiles.

This is independent of the official MetaTrader5 Python IPC integration.
MT5 builds with a built-in MCP service may otherwise compete for TCP 22346
when multiple owned terminal instances launch on the same Windows user.
Never change an existing personal/broker installation or any trading setting.
"""
from __future__ import annotations

import configparser
import io
import os
import uuid
from pathlib import Path


def _linked(path: Path) -> bool:
    return path.is_symlink() or bool(getattr(path, "is_junction", lambda: False)())


def disable_internal_mcp(profile: str | Path) -> bool:
    """Best-effort, additive, per-managed-profile setting. No credentials."""
    folder=Path(profile)
    marker=folder / ".ym-managed.json"
    if (_linked(folder) or _linked(marker) or not marker.is_file()
            or os.environ.get("YMFX_ENABLE_TERMINAL_MCP") == "1"):
        return False
    config=folder / "Config"
    if _linked(config):
        return False
    config.mkdir(exist_ok=True)
    settings=config / "assistant.ini"
    if _linked(settings):
        return False
    parser=configparser.ConfigParser(interpolation=None, strict=False)
    parser.optionxform=str
    if settings.exists():
        if not settings.is_file() or settings.stat().st_size>1024*1024:
            return False
        try:
            parser.read_string(settings.read_text(encoding="utf-8-sig"))
        except (UnicodeError, configparser.Error):
            # Never overwrite an unfamiliar/binary vendor configuration.
            return False
    for section in ("MCP.MetaTrader", "MCP.MetaEditor"):
        if not parser.has_section(section):
            parser.add_section(section)
        for key in list(parser[section]):
            if key.casefold()=="enable":
                del parser[section][key]
        parser[section]["Enable"]="0"
    output=io.StringIO()
    parser.write(output)
    data=output.getvalue()
    # On each launch MT5 may have rewritten the option since last shutdown.
    if settings.exists() and settings.read_text(encoding="utf-8-sig")==data:
        return True
    temporary=config / ("." + uuid.uuid4().hex + ".assistant.tmp")
    try:
        with temporary.open("x",encoding="utf-8",newline="\n") as handle:
            handle.write(data)
        os.replace(temporary,settings)
    finally:
        temporary.unlink(missing_ok=True)
    return True
