"""YoungMoney3 Connector — Windows-native staging GUI.

This app never places, changes or cancels trades. The UI remains on the main
thread; MT5 + SQLite calls run exclusively in the single capture worker thread.
CLI pairing/token/outbox storage stays compatible with connect.py.
"""
import json
import os
import queue
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
import webbrowser

import connect

STAGING_URL = "https://ym-fx-staging.ethical-hacker263.workers.dev"
ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "YMFX" / "staging-gui"
SETTINGS = ROOT / "preferences.json"
BACKGROUND = "#0e1b26"
PANEL = "#142737"
TEXT = "#e9f4f4"
MUTED = "#a0b7c5"
ACCENT = "#56d4be"


def terminal_candidates():
    paths = []
    roots = [Path(os.environ.get("PROGRAMFILES", "C:/Program Files")),
             Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)")),
             Path.home() / "Documents", Path.home() / "Downloads"]
    for root in roots:
        if not root.exists():
            continue
        if root.name.lower() in ("documents", "downloads"):
            choices = [root / "MT5" / "terminal64.exe", root / "MetaTrader 5" / "terminal64.exe"]
        else:
            choices = [root / "MetaTrader 5" / "terminal64.exe",
                       root / "MT5 Weltrade" / "terminal64.exe"]
            try:
                choices.extend(path / "terminal64.exe" for path in list(root.iterdir())[:120]
                               if path.is_dir() and ("mt5" in path.name.lower() or "metatrader" in path.name.lower()))
            except OSError:
                pass
        for path in choices:
            try:
                resolved = str(path.resolve())
                if path.is_file() and resolved not in paths:
                    paths.append(resolved)
            except OSError:
                pass
    return paths


class ConnectorApp:
    def __init__(self, root):
        self.root = root
        self.events = queue.Queue()
        self.worker = None
        self.stopping = False
        self.stop_event = threading.Event()
        self.pause_event = threading.Event()
        self.terminals = []
        self._load()
        self.root.title("YoungMoney3 Connector  |  Staging")
        self.root.geometry("860x690")
        self.root.minsize(670, 550)
        self.root.configure(bg=BACKGROUND)
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self._build()
        self.root.after(140, self.poll)

    def _load(self):
        try:
            values = json.loads(SETTINGS.read_text("utf-8"))
            self.terminals = [x for x in values.get("terminals", []) if
                              isinstance(x, str) and Path(x).is_file()
                              and Path(x).name.lower() == "terminal64.exe"]
        except (OSError, ValueError, TypeError):
            self.terminals = []

    def _save(self):
        ROOT.mkdir(parents=True, exist_ok=True)
        SETTINGS.write_text(json.dumps({"terminals": self.terminals}, indent=2), "utf-8")

    def _button(self, parent, text, action, primary=False):
        button = tk.Button(parent, text=text, command=action, relief="flat",
                           padx=14, pady=9, font=("Segoe UI", 10, "bold"),
                           bg=ACCENT if primary else "#243b4c",
                           fg="#082126" if primary else TEXT,
                           activebackground="#8debdc" if primary else "#36556b",
                           activeforeground="#082126" if primary else TEXT,
                           cursor="hand2", borderwidth=0)
        button.pack(side="left", padx=(0, 8), pady=4)
        return button

    def _section(self, parent, title, caption):
        container = tk.Frame(parent, bg=PANEL, padx=18, pady=14)
        container.pack(fill="x", pady=(0, 10))
        tk.Label(container, text=title, bg=PANEL, fg=TEXT,
                 font=("Segoe UI", 12, "bold")).pack(anchor="w")
        tk.Label(container, text=caption, bg=PANEL, fg=MUTED,
                 font=("Segoe UI", 9), wraplength=735, justify="left").pack(anchor="w", pady=(3, 9))
        return container

    def _build(self):
        root = self.root
        outer = tk.Frame(root, bg=BACKGROUND, padx=20, pady=18)
        outer.pack(fill="both", expand=True)
        top = tk.Frame(outer, bg=BACKGROUND)
        top.pack(fill="x", pady=(0, 15))
        tk.Label(top, text="YOUNGMONEY3", bg=BACKGROUND, fg=ACCENT,
                 font=("Segoe UI", 10, "bold")).pack(anchor="w")
        tk.Label(top, text="MT5 Connector  /  Staging", bg=BACKGROUND, fg=TEXT,
                 font=("Segoe UI", 21, "bold")).pack(anchor="w", pady=(2, 3))
        tk.Label(top, text="Local, read-only capture. Demo and contest accounts only.",
                 bg=BACKGROUND, fg=MUTED, font=("Segoe UI", 10)).pack(anchor="w")
        device = self._section(outer, "01  Pair this PC",
                               "Create a five-minute code on the staging dashboard, then paste it here. Do not share the code.")
        entry_row = tk.Frame(device, bg=PANEL)
        entry_row.pack(fill="x")
        self.code_var = tk.StringVar()
        self.code_input = tk.Entry(entry_row, textvariable=self.code_var, width=37, show="•",
                                   bg="#0c1d2a", fg=TEXT, insertbackground=TEXT,
                                   relief="flat", font=("Consolas", 12))
        self.code_input.pack(side="left", padx=(0, 10), ipady=8, fill="x", expand=True)
        actions = tk.Frame(device, bg=PANEL)
        actions.pack(fill="x", pady=(8, 0))
        self._button(actions, "Pair this PC", self.pair, primary=True)
        self._button(actions, "Open staging dashboard", lambda: webbrowser.open(STAGING_URL))
        terminals = self._section(outer, "02  Dedicated MT5 terminals",
                                  "Select one portable terminal64.exe per account. Using the same server for several accounts is supported; each needs a separate terminal directory.")
        self.terminal_list = tk.Listbox(terminals, height=4, selectmode=tk.EXTENDED,
                                        bg="#0c1d2a", fg=TEXT, selectbackground="#245b60",
                                        borderwidth=0, highlightthickness=0, font=("Consolas", 9))
        self.terminal_list.pack(fill="x")
        self.refresh_list()
        buttons = tk.Frame(terminals, bg=PANEL)
        buttons.pack(fill="x", pady=(8, 0))
        self._button(buttons, "Detect MT5", self.detect)
        self._button(buttons, "Browse terminal", self.browse)
        self._button(buttons, "Remove selected", self.remove)
        tk.Label(terminals, text="If login fails, open this copy with /portable, then use File → Open an Account to find the exact broker server.",
                 bg=PANEL, fg=MUTED, wraplength=740, justify="left", font=("Segoe UI", 9)).pack(anchor="w", pady=(8, 0))
        sync = self._section(outer, "03  Capture controls",
                             "Start when you want to sync. Pause stops new polling; closing the application stops capture and preserves pending uploads.")
        control = tk.Frame(sync, bg=PANEL)
        control.pack(fill="x")
        self.start_button = self._button(control, "Start syncing", self.start, primary=True)
        self.pause_button = self._button(control, "Pause", self.pause)
        self._button(control, "Stop", self.stop)
        self.status_var = tk.StringVar(value="Stopped")
        self.details_var = tk.StringVar(value="Linked accounts: —  ·  Queued records: —  ·  Last sync: —")
        tk.Label(sync, textvariable=self.status_var, bg=PANEL, fg=ACCENT,
                 font=("Segoe UI", 10, "bold"), anchor="w").pack(fill="x", pady=(8, 2))
        tk.Label(sync, textvariable=self.details_var, bg=PANEL, fg=MUTED,
                 font=("Segoe UI", 9), anchor="w").pack(fill="x")
        self.progress = ttk.Progressbar(sync, mode="indeterminate")
        self.progress.pack(fill="x", pady=(10, 0))
        tk.Label(outer, text="STAGING ONLY   ·   No trading commands   ·   Unsigned Windows prerelease",
                 bg=BACKGROUND, fg=MUTED, font=("Segoe UI", 8)).pack(anchor="w", pady=(8, 0))

    def refresh_list(self):
        self.terminal_list.delete(0, tk.END)
        for terminal in self.terminals:
            self.terminal_list.insert(tk.END, terminal)

    def detect(self):
        found = 0
        for terminal in terminal_candidates():
            if terminal not in self.terminals:
                self.terminals.append(terminal)
                found += 1
        self._save()
        self.refresh_list()
        self.status_var.set("Detected " + str(found) + " new terminal(s). Prepare dedicated /portable copies.")

    def browse(self):
        name = filedialog.askopenfilename(title="Choose dedicated terminal64.exe",
                filetypes=[("MetaTrader 5 terminal", "terminal64.exe"), ("Executable", "*.exe")])
        if not name:
            return
        path = Path(name)
        if path.name.lower() != "terminal64.exe":
            messagebox.showerror("Invalid terminal", "Choose a terminal64.exe from its dedicated portable installation.")
            return
        absolute = str(path.resolve())
        if absolute not in self.terminals:
            self.terminals.append(absolute)
            self._save()
            self.refresh_list()

    def remove(self):
        if self.worker and self.worker.is_alive():
            messagebox.showwarning("Sync is running", "Stop syncing before changing terminal assignments.")
            return
        chosen = set(self.terminal_list.curselection())
        self.terminals = [x for i, x in enumerate(self.terminals) if i not in chosen]
        self._save()
        self.refresh_list()

    def _start_worker(self, args, pairing_code=None):
        if self.worker and self.worker.is_alive():
            messagebox.showinfo("Connector busy", "Pause or stop the current capture before pairing again.")
            return
        self.stop_event.clear()
        self.pause_event.clear()
        def work():
            try:
                connect.main(args, pairing_code=pairing_code,
                             stop_event=self.stop_event, pause_event=self.pause_event,
                             report=self.events.put)
            except BaseException as error:
                # Do not print codes, account passwords, encryption or connector state.
                self.events.put({"state":"error","message":str(type(error).__name__) +
                                 ": " + str(error)[:180]})
            finally:
                self.events.put({"state":"stopped","message":"Capture worker exited."})
        self.worker = threading.Thread(target=work, daemon=False, name="MT5-SQLite-worker")
        self.worker.start()
        self.progress.start(12)

    def pair(self):
        code = self.code_var.get().strip()
        if len(code) != 32 or any(ch.lower() not in "0123456789abcdef" for ch in code):
            messagebox.showerror("Pairing code", "Paste the complete 32-character staging pairing code.")
            return
        self.code_var.set("")
        self._start_worker([STAGING_URL, "--pair", "--pair-only"], pairing_code=code.lower())

    def start(self):
        if self.worker and self.worker.is_alive():
            self.pause_event.clear()
            self.status_var.set("Sync resumed")
            return
        if not self.terminals:
            messagebox.showwarning("No terminal selected", "Detect or browse a dedicated MT5 terminal before starting.")
            return
        self._start_worker([STAGING_URL, *self.terminals])

    def pause(self):
        if self.worker and self.worker.is_alive():
            self.pause_event.set()
            self.status_var.set("Pausing after current MT5 or upload operation")

    def stop(self):
        self.stop_event.set()
        self.pause_event.clear()
        if self.worker and self.worker.is_alive():
            self.status_var.set("Stopping capture; preserving queued records")

    def poll(self):
        try:
            while True:
                item = self.events.get_nowait()
                state = item.get("state", "running")
                self.status_var.set(state.upper() + "  ·  " + item.get("message", ""))
                if "queued" in item:
                    self.details_var.set("Linked accounts: " + str(item.get("linked", "—")) +
                                         "  ·  Queued: " + str(item.get("queued", "—")) +
                                         "  ·  Last capture cycle: " + str(item.get("last_sync", "—")))
                if state in ("stopped", "error", "paired"):
                    self.progress.stop()
        except queue.Empty:
            pass
        if self.stopping:
            if not self.worker or not self.worker.is_alive():
                self._save()
                self.root.destroy()
                return
        self.root.after(150, self.poll)

    def close(self):
        self.stopping = True
        self.stop()
        if not self.worker or not self.worker.is_alive():
            self._save()
            self.root.destroy()


def main():
    smoke = len(sys.argv) == 3 and sys.argv[1] == "--startup-smoke"
    if len(sys.argv) > 1 and not smoke:
        raise ValueError("Expected --startup-smoke REPORT_PATH or no arguments")
    try:
        if not smoke:
            ROOT.mkdir(parents=True, exist_ok=True)
        window = tk.Tk()
        if smoke:
            window.withdraw()
        app = ConnectorApp(window)
        if smoke:
            # Exercise the real widgets/event loop, without pairing or MT5 access.
            # No close() call: it would write the user's preferences.
            def finish():
                try:
                    if app.worker is not None:
                        raise RuntimeError("Startup unexpectedly started capture")
                    bundle = Path(getattr(sys, "_MEIPASS", ""))
                    if not getattr(sys, "frozen", False):
                        raise RuntimeError("Smoke test requires the frozen executable")
                    for folder, sentinel in (("_tcl_data", "init.tcl"), ("_tk_data", "tk.tcl")):
                        if not (bundle / folder / sentinel).is_file():
                            raise RuntimeError("Bundled Tcl/Tk data missing")
                    Path(sys.argv[2]).write_text(json.dumps({
                        "startup": "ok", "frozen": True, "capture_started": False,
                        "tcl": window.tk.eval("info patchlevel"),
                        "tk": window.tk.eval("package present Tk"),
                        "tcl_bundled": Path(window.tk.eval("info library")).resolve() == (bundle / "_tcl_data").resolve(),
                        "tk_bundled": Path(window.tk.eval("set tk_library")).resolve() == (bundle / "_tk_data").resolve(),
                    }), encoding="utf-8")
                finally:
                    window.destroy()
            window.after(400, finish)
        window.mainloop()
    except Exception as error:
        if sys.stderr is not None:
            sys.stderr.write(type(error).__name__ + ": " + str(error)[:160] + "\n")
        raise


if __name__ == "__main__":
    main()
