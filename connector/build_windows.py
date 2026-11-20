"""Build and inspect the standalone Windows application; fail closed on missing Tk."""
import sys
from pathlib import Path
import tkinter as tk


def main():
    if sys.platform != "win32":
        raise RuntimeError("Build on Windows with the release Python installation")
    import PyInstaller.__main__
    from PyInstaller.archive.readers import CArchiveReader

    # Ask the actual interpreter, rather than guessing setup-python's layout.
    root = tk.Tk()
    root.withdraw()
    try:
        tcl = Path(root.tk.eval("info library")).resolve()
        tk_data = Path(root.tk.eval("set tk_library")).resolve()
        for directory, sentinel in ((tcl, "init.tcl"), (tk_data, "tk.tcl")):
            if not (directory / sentinel).is_file():
                raise RuntimeError(f"Incomplete Tcl/Tk installation: {directory / sentinel}")
    finally:
        root.destroy()

    PyInstaller.__main__.run([
        "--noconfirm", "--clean", "--onefile", "--windowed",
        "--name", "YoungMoney3 Connector", "--paths", "connector",
        "--hidden-import", "_tkinter", "--hidden-import", "tkinter",
        "--runtime-hook", "connector/startup_diagnostics.py",
        "--add-data", f"{tcl};_tcl_data",
        "--add-data", f"{tk_data};_tk_data",
        "--collect-all", "MetaTrader5", "--collect-all", "keyring",
        # MetaTrader5's compiled extension imports NumPy through the C API;
        # static Python import analysis cannot discover that dependency.
        "--collect-all", "numpy", "--hidden-import", "numpy",
        "--collect-all", "tzdata", "connector/connector_gui.py",
    ])
    archive = CArchiveReader("dist/YoungMoney3 Connector.exe")
    names = {name.replace("\\", "/") for name in archive.toc}
    required = {"_tcl_data/init.tcl", "_tk_data/tk.tcl"}
    if not required.issubset(names):
        raise RuntimeError(f"Executable missing Tcl/Tk scripts: {required - names}")
    for prefix, suffix in (("_tkinter", ".pyd"), ("tcl", ".dll"), ("tk", ".dll")):
        if not any(Path(name).name.lower().startswith(prefix) and name.lower().endswith(suffix)
                   for name in names):
            raise RuntimeError(f"Executable missing {prefix} native library")
    print("Verified Tcl/Tk scripts and native libraries in executable")


if __name__ == "__main__":
    main()
