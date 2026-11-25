"""Create real Windows screenshot artifacts without broker accounts or tokens."""
from __future__ import annotations
import os
import sys
import tempfile
import time
import tkinter as tk
from pathlib import Path
from PIL import ImageGrab, ImageStat

def main():
    if sys.platform != "win32" or len(sys.argv) != 2:
        raise RuntimeError("Windows-only connector preview requires output directory")
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ymfx-enterprise-review-") as temp:
        os.environ["LOCALAPPDATA"] = temp
        import connector_gui as module
        module.ROOT = Path(temp) / "YMFX" / "staging-gui"
        module.SETTINGS = module.ROOT / "preferences.json"
        root = tk.Tk()
        try:
            app = module.ConnectorApp(root, restore=False)
            app.motion_var.set(False)
            app._refresh_motion()
            root.attributes("-topmost", True)
            for name, page, wide in (
                ("home", "overview", True),
                ("accounts", "sessions", True),
                ("pairing", "pair", True),
                ("activity", "activity", True),
                ("help", "help", True),
                ("home-compact", "overview", False),
                ("accounts-compact", "sessions", False),
            ):
                w = min(root.winfo_screenwidth()-40, 1180 if wide else 760)
                h = min(root.winfo_screenheight()-45, 800 if wide else 620)
                root.geometry(f"{w}x{h}+15+15")
                app.show_page(page)
                if page == "sessions" and not app.session_table.get_children():
                    if not app.empty_account_panel.winfo_manager():
                        raise RuntimeError("No-account empty state did not appear")
                for _ in range(4):
                    root.update_idletasks()
                    root.update()
                    time.sleep(.04)
                x, y = root.winfo_rootx(), root.winfo_rooty()
                sw, sh = root.winfo_width(), root.winfo_height()
                image = ImageGrab.grab(bbox=(x, y, x+sw, y+sh))
                if sw < 700 or sh < 540 or max(ImageStat.Stat(image.convert("RGB")).stddev) < 7:
                    raise RuntimeError(f"Blank/clipped screenshot: {name} {sw}x{sh}")
                image.save(output / f"{name}.png")
            if app.worker is not None or module.SETTINGS.exists():
                raise RuntimeError("Preview accessed broker capture or modified saved settings")
        finally:
            root.destroy()

if __name__ == "__main__":
    main()
