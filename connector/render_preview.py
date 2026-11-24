"""Capture real Windows screenshots of unpaired trader-only screens.

No broker sessions, network calls, pairing tokens or user profile files.
These are genuine Tk-rendered review images, NOT AI mockups.
"""
from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import time
import tkinter as tk

from PIL import ImageGrab, ImageStat


def main():
    if sys.platform != "win32" or len(sys.argv) != 2:
        raise RuntimeError("Windows review requires one output directory.")
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ymfx-visual-review-") as workspace:
        # Isolate both app preference paths and account credentials. The UI is
        # loaded with restore=False, so no previous pairing is read or started.
        os.environ["LOCALAPPDATA"] = workspace
        import connector_gui as app_module
        app_module.ROOT = Path(workspace) / "YMFX" / "staging-gui"
        app_module.SETTINGS = app_module.ROOT / "preferences.json"

        window = tk.Tk()
        try:
            app = app_module.ConnectorApp(window, restore=False)
            app.motion_var.set(False)
            app._refresh_motion()
            window.attributes("-topmost", True)
            snapshots = (
                ("home", "overview", "wide"),
                ("accounts", "sessions", "wide"),
                ("copying", "copy", "wide"),
                ("guide", "help", "wide"),
                ("copying", "copy", "compact"),
                ("accounts", "sessions", "compact"),
            )
            for label, page, size in snapshots:
                max_width = max(720, window.winfo_screenwidth() - 60)
                max_height = max(560, window.winfo_screenheight() - 60)
                width = min(max_width, 1180 if size == "wide" else 760)
                height = min(max_height, 800 if size == "wide" else 620)
                window.geometry(f"{width}x{height}+20+20")
                app.show_page(page)
                window.update_idletasks()
                window.update()
                window.lift()
                time.sleep(.12)
                window.update()
                x,y = window.winfo_rootx(),window.winfo_rooty()
                w,h = window.winfo_width(),window.winfo_height()
                shot=ImageGrab.grab(bbox=(x,y,x+w,y+h))
                variance=ImageStat.Stat(shot.convert("RGB")).stddev
                if w<700 or h<540 or max(variance)<7:
                    raise RuntimeError(f"Screenshot capture empty or clipped: {label}-{size} {w}x{h}")
                shot.save(output / f"{label}-{size}.png")
            if app.worker is not None or app_module.SETTINGS.exists():
                raise RuntimeError("Review unexpectedly accessed a saved broker or account setting")
        finally:
            window.destroy()


if __name__ == "__main__":
    main()
