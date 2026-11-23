"""Launch only YoungMoney3-owned portable terminals with a hidden startup hint.

The MT5 Python extension still requires an actual Windows MT5 process.
Neither a command-line password nor a plaintext INI file is created.
SW_HIDE is a Windows startup hint, not a guarantee that the broker platform
will never show its own approval/first-run dialogs. The connector retains an
explicit 'Open MT5' action for those exceptional cases.
"""
import os
import subprocess
from pathlib import Path

class TerminalLaunchError(RuntimeError):
    pass

def start_managed_terminal(slot):
    executable=Path(slot).resolve()
    if executable.name.lower()!="terminal64.exe" or not (executable.parent/".ym-managed.json").is_file():
        raise TerminalLaunchError("Only an isolated YoungMoney3-managed terminal may start in the background.")
    if not executable.is_file():
        raise TerminalLaunchError("Managed MetaTrader executable is unavailable.")
    # The built-in MT5 MCP server is unrelated to MetaTrader5 Python IPC.
    # Disable the unused listener only in YM-FX-owned portable profiles to
    # avoid a port-22346 collision when the same PC monitors several accounts.
    from managed_mcp import disable_internal_mcp
    try:
        disable_internal_mcp(executable.parent)
    except (OSError, ValueError):
        # Compatibility with future MT5 configuration formats must not block
        # authentication; diagnostics remain available in terminal Journal.
        pass
    kwargs={"cwd":str(executable.parent)}
    if os.name=="nt":
        settings=subprocess.STARTUPINFO()
        settings.dwFlags|=subprocess.STARTF_USESHOWWINDOW
        settings.wShowWindow=subprocess.SW_HIDE
        kwargs["startupinfo"]=settings
    return subprocess.Popen([str(executable),"/portable"],**kwargs)
