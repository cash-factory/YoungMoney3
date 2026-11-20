"""YoungMoney3 Windows desktop entry point and frozen engine dispatcher."""
from __future__ import annotations

import argparse
import ctypes
import json
import os
from pathlib import Path
import queue
import runpy
import sys
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import webbrowser

from app_runtime import (APP_VERSION, DEFAULT_ORIGIN, EngineProcess, InstanceLock,
                         app_folder, canonical_origin, create_terminal,
                         discover_terminals, load_settings, read_capture_status,
                         save_settings, terminal_path)


class ConnectorApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        settings = load_settings()
        self.origin = tk.StringVar(value=settings["origin"])
        self.terminals = settings["terminals"]
        self.engine = EngineProcess()
        self.instance = InstanceLock(self.origin.get())
        self.events = queue.Queue()
        self.status = tk.StringVar(value="Ready to connect")
        self.detail = tk.StringVar(value="Pair this PC once, then connect your trading accounts on the website.")
        self.health = tk.StringVar(value="Checking saved pairing…")
        self.pausing = False
        self.closing = False
        self.last_check = 0
        self.health_pending = False
        self.paired = False
        self.root.title("YoungMoney3 Connector")
        self.root.geometry("760x700")
        self.root.minsize(650, 560)
        self.root.configure(bg="#0f1015")
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self._style()
        self._render()
        self.root.after(100, self.tick)

    def _style(self):
        style = ttk.Style()
        style.theme_use("clam")
        style.configure(".", font=("Segoe UI", 10), background="#0f1015", foreground="#edeef2")
        style.configure("TFrame", background="#0f1015")
        style.configure("Card.TFrame", background="#191b23")
        style.configure("TLabel", background="#0f1015", foreground="#edeef2")
        style.configure("Muted.TLabel", foreground="#a5a9b7")
        style.configure("Title.TLabel", font=("Segoe UI Semibold", 24))
        style.configure("Heading.TLabel", font=("Segoe UI Semibold", 12))
        style.configure("TButton", padding=(14, 9), background="#292c38", foreground="#f4f4f7", borderwidth=0)
        style.map("TButton", background=[("active", "#393d4c"), ("disabled", "#20222b")],
                  foreground=[("disabled", "#777c8e")])
        style.configure("Primary.TButton", background="#f49b54", foreground="#17120e")
        style.map("Primary.TButton", background=[("active", "#ffc08d"), ("disabled", "#614731")])
        style.configure("TEntry", fieldbackground="#232631", foreground="#f4f4f7", padding=8)
        style.configure("TLabelframe", bordercolor="#303441")
        style.configure("TLabelframe.Label", foreground="#b4b8c5")

    def _render(self):
        shell = ttk.Frame(self.root, padding=28)
        shell.pack(fill="both", expand=True)
        ttk.Label(shell, text="YOUNGMONEY3", foreground="#f49b54",
                  font=("Segoe UI Semibold", 10)).pack(anchor="w")
        ttk.Label(shell, text="Your trading desk, connected", style="Title.TLabel").pack(anchor="w", pady=(7, 4))
        ttk.Label(shell, text="Keep this app open while you want your MT5 trades to sync.",
                  style="Muted.TLabel").pack(anchor="w", pady=(0, 22))
        ttk.Label(shell, textvariable=self.status, style="Heading.TLabel").pack(anchor="w")
        ttk.Label(shell, textvariable=self.detail, wraplength=680, style="Muted.TLabel").pack(anchor="w", pady=(5, 10))
        ttk.Label(shell, textvariable=self.health, foreground="#f4b17d").pack(anchor="w", pady=(0, 18))

        actions = ttk.Frame(shell)
        actions.pack(fill="x")
        self.start_button = ttk.Button(actions, text="Start syncing", command=self.start, style="Primary.TButton")
        self.start_button.pack(side="left")
        self.pause_button = ttk.Button(actions, text="Pause", command=self.pause, state="disabled")
        self.pause_button.pack(side="left", padx=8)
        self.pair_button = ttk.Button(actions, text="Pair this PC", command=self.pair)
        self.pair_button.pack(side="left")
        ttk.Button(actions, text="Open dashboard", command=self.open_dashboard).pack(side="right")

        ttk.Label(shell, text="Dedicated MT5 terminals", style="Heading.TLabel").pack(anchor="w", pady=(24, 7))
        ttk.Label(shell, text="Use a separate terminal for each account monitored at the same time.",
                  style="Muted.TLabel").pack(anchor="w", pady=(0, 8))
        self.terminal_list = tk.Listbox(shell, bg="#191b23", fg="#edeef2", selectbackground="#55402e",
                                       highlightthickness=1, highlightbackground="#303441", borderwidth=0,
                                       height=4, font=("Segoe UI", 9), activestyle="none")
        self.terminal_list.pack(fill="x")
        self.refresh_terminals()
        terminal_actions = ttk.Frame(shell)
        terminal_actions.pack(fill="x", pady=(8, 10))
        self.add_button = ttk.Button(terminal_actions, text="Add terminal", command=self.add_terminal)
        self.add_button.pack(side="left")
        self.remove_button = ttk.Button(terminal_actions, text="Remove selected", command=self.remove_terminal)
        self.remove_button.pack(side="left", padx=8)
        ttk.Button(terminal_actions, text="Open selected MT5", command=self.open_terminal).pack(side="right")

        advanced = ttk.Labelframe(shell, text="Dashboard address", padding=10)
        advanced.pack(fill="x", pady=(4, 12))
        self.origin_entry = ttk.Entry(advanced, textvariable=self.origin)
        self.origin_entry.pack(fill="x")
        ttk.Label(advanced, text="This staging build starts with the staging dashboard. Each address has its own pairing.",
                  style="Muted.TLabel", wraplength=650).pack(anchor="w", pady=(5, 0))
        self.log = tk.Text(shell, height=5, bg="#14161d", fg="#a5a9b7", font=("Consolas", 9),
                           relief="flat", wrap="word", state="disabled", padx=10, pady=9)
        self.log.pack(fill="both", expand=True)
        ttk.Label(shell, text=f"Version {APP_VERSION} · Capture runs only while this app is open",
                  style="Muted.TLabel").pack(anchor="w", pady=(9, 0))

    def refresh_terminals(self):
        self.terminal_list.delete(0, "end")
        for index, path in enumerate(self.terminals, 1):
            self.terminal_list.insert("end", f"  Account slot {index}   {path}")

    def append(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", time.strftime("%H:%M:%S ") + text + "\n")
        if int(self.log.index("end-1c").split(".")[0]) > 150:
            self.log.delete("1.0", "30.0")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _save(self):
        origin = canonical_origin(self.origin.get())
        if origin != getattr(self, "locked_origin", load_settings()["origin"]):
            replacement = InstanceLock(origin)
            self.instance.close()
            self.instance = replacement
        self.locked_origin = origin
        self.origin.set(origin)
        save_settings(origin, self.terminals)
        return origin

    def open_dashboard(self):
        try:
            webbrowser.open(canonical_origin(self.origin.get()) + "/#mt5")
        except ValueError as error:
            messagebox.showerror("Dashboard address", str(error), parent=self.root)

    def add_terminal(self):
        if self.engine.running:
            return
        chooser = tk.Toplevel(self.root)
        chooser.title("Add an MT5 terminal")
        chooser.configure(bg="#0f1015")
        chooser.transient(self.root)
        chooser.grab_set()
        chooser.geometry("660x260")
        content = ttk.Frame(chooser, padding=22)
        content.pack(fill="both", expand=True)
        ttk.Label(content, text="Select your installed MT5", style="Heading.TLabel").pack(anchor="w")
        source = tk.StringVar(value=next(iter(discover_terminals()), ""))
        combo = ttk.Combobox(content, textvariable=source, values=discover_terminals())
        combo.pack(fill="x", pady=12)
        def browse():
            value = filedialog.askopenfilename(parent=chooser, title="Select MT5 terminal64.exe",
                                               filetypes=[("MT5 terminal", "terminal64.exe")])
            if value:
                source.set(value)
        ttk.Button(content, text="Browse…", command=browse).pack(anchor="w")
        ttk.Label(content, text="Create a dedicated copy for the connector, or add an existing dedicated portable terminal.",
                  style="Muted.TLabel", wraplength=610).pack(anchor="w", pady=12)
        buttons = ttk.Frame(content)
        buttons.pack(fill="x")
        def add(copy):
            try:
                origin = self._save()
                path = create_terminal(source.get(), origin, self.terminals) if copy else terminal_path(source.get())
                if path in self.terminals:
                    raise ValueError("This terminal has already been added.")
                self.terminals.append(path)
                save_settings(origin, self.terminals)
                self.refresh_terminals()
                chooser.destroy()
                self.detail.set("Open the selected MT5 once, finish its startup and find your broker, then start syncing.")
            except (ValueError, OSError) as error:
                messagebox.showerror("Add terminal", str(error), parent=chooser)
        ttk.Button(buttons, text="Create dedicated copy", command=lambda: add(True), style="Primary.TButton").pack(side="left")
        ttk.Button(buttons, text="Use existing portable copy", command=lambda: add(False)).pack(side="left", padx=10)

    def remove_terminal(self):
        selection = self.terminal_list.curselection()
        if selection and not self.engine.running:
            self.terminals.pop(selection[0])
            self.refresh_terminals()
            self._save()

    def open_terminal(self):
        import subprocess
        selection = self.terminal_list.curselection()
        if not selection:
            messagebox.showinfo("Choose a terminal", "Select an account slot first.", parent=self.root)
            return
        try:
            path = terminal_path(self.terminals[selection[0]])
            subprocess.Popen([path, "/portable"], cwd=str(Path(path).parent))
        except OSError as error:
            messagebox.showerror("Open MT5", str(error), parent=self.root)

    def pair(self):
        if self.engine.running:
            return
        if not self.terminals:
            self.add_terminal()
            return
        dialog = tk.Toplevel(self.root)
        dialog.title("Pair this PC")
        dialog.configure(bg="#0f1015")
        dialog.transient(self.root)
        dialog.grab_set()
        content = ttk.Frame(dialog, padding=24)
        content.pack(fill="both", expand=True)
        ttk.Label(content, text="Paste your website pairing code", style="Heading.TLabel").pack(anchor="w")
        ttk.Label(content, text="On the MT5 Connections page, choose Pair a PC. Codes expire after five minutes.",
                  style="Muted.TLabel", wraplength=470).pack(anchor="w", pady=(8, 12))
        code = tk.StringVar()
        entry = ttk.Entry(content, textvariable=code, width=48)
        entry.pack(fill="x")
        entry.focus_set()
        def submit():
            value = code.get().strip()
            code.set("")
            dialog.destroy()
            self.start(value)
        ttk.Button(content, text="Pair and start syncing", style="Primary.TButton", command=submit).pack(anchor="e", pady=(14, 0))

    def set_running_controls(self, running):
        for widget in [self.start_button, self.pair_button, self.add_button, self.remove_button, self.origin_entry]:
            widget.configure(state="disabled" if running else "normal")
        self.pause_button.configure(state="normal" if running and not self.pausing else "disabled")

    def start(self, pair_code=""):
        try:
            origin = self._save()
            if not pair_code and not read_capture_status(origin)["paired"]:
                self.pair()
                return
            self.engine.start(origin, self.terminals, pair_code)
            self.pausing = False
            self.status.set("Connecting…")
            self.detail.set("The connector is opening its saved accounts. You can review account status on the website.")
            self.set_running_controls(True)
            self.last_check = 0
        except (ValueError, OSError, RuntimeError) as error:
            messagebox.showerror("Start connector", str(error), parent=self.root)

    def pause(self):
        self.engine.pause()
        self.pausing = True
        self.status.set("Pausing…")
        self.detail.set("Finishing the current MT5 operation and preserving pending uploads.")
        self.pause_button.configure(state="disabled")

    def close(self):
        if self.engine.running:
            if not self.closing and not messagebox.askokcancel("Stop syncing?", "Closing this app stops trade capture on this PC. Pending uploads are retained.", parent=self.root):
                return
            self.closing = True
            self.pause()
            return
        self.instance.close()
        self.root.destroy()

    def tick(self):
        if self.instance.signal.exists():
            self.instance.signal.unlink(missing_ok=True)
            self.root.deiconify()
            self.root.lift()
            self.root.focus_force()
        for line in self.engine.messages():
            if line.startswith("YM3_STATUS "):
                try:
                    event = json.loads(line[len("YM3_STATUS "):])
                    if event.get("state") == "synced":
                        self.status.set("Syncing")
                        self.detail.set("Latest records acknowledged by the dashboard at " + time.strftime("%H:%M:%S", time.localtime(event["last_sync"] / 1000)))
                except (ValueError, KeyError, TypeError):
                    pass
                continue
            self.append(line)
            if "Connector running" in line:
                self.status.set("Syncing")
            if "failed" in line.lower() or "unavailable" in line.lower() or "pending" in line.lower():
                self.status.set("Waiting to reconnect")
        if self.engine.process and not self.engine.running:
            result = self.engine.process.returncode
            self.engine.process = None
            self.set_running_controls(False)
            self.status.set("Paused" if self.pausing or result == 0 else "Connection needs attention")
            self.detail.set("Open this app and press Start syncing when you want capture to resume." if self.pausing else "Review the message below or open the dashboard for account details.")
            self.pausing = False
            if self.closing:
                self.close()
                return
        if not self.health_pending and time.monotonic() - self.last_check > 4:
            self.last_check = time.monotonic()
            self.health_pending = True
            origin = self.origin.get()
            def health():
                try:
                    self.events.put(("health", read_capture_status(origin)))
                except Exception:
                    self.events.put(("health_error", None))
            threading.Thread(target=health, daemon=True).start()
        while not self.events.empty():
            kind, result = self.events.get()
            self.health_pending = False
            if kind == "health":
                self.paired = result["paired"]
                if not self.terminals and result.get("terminals"):
                    self.terminals = result["terminals"]
                    self.refresh_terminals()
                    save_settings(self.origin.get(), self.terminals)
                last = result["last_sync"]
                when = time.strftime("%H:%M:%S", time.localtime(last / 1000)) if last else "waiting for first sync"
                self.health.set(f"{'Paired' if self.paired else 'Pairing required'}  ·  {result['accounts']} linked accounts  ·  {result['queued']} queued records  ·  Last MT5 read {when}")
            else:
                self.health.set("Saved capture status unavailable while MT5 is updating. Retrying…")
        self.root.after(350, self.tick)


def run_engine():
    import io
    import msvcrt
    log_path = os.environ.get("YMFX_ENGINE_LOG")
    if log_path:
        sys.stdout = open(log_path, "w", encoding="utf-8", buffering=1)
        sys.stderr = sys.stdout
    if sys.stdin is None:
        from ctypes import wintypes
        get_handle = ctypes.windll.kernel32.GetStdHandle
        get_handle.argtypes = [wintypes.DWORD]
        get_handle.restype = wintypes.HANDLE
        handle = get_handle(-10)
        descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY)
        sys.stdin = io.TextIOWrapper(os.fdopen(descriptor, "rb"), encoding="utf-8")
    sys.argv = ["connect.py", *sys.argv[2:]]
    try:
        runpy.run_module("connect", run_name="__main__")
    except SystemExit:
        raise
    except Exception as error:
        print("Connector stopped:", type(error).__name__, flush=True)
        sys.exit(1)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--engine":
        run_engine()
        return
    parser = argparse.ArgumentParser(description="YoungMoney3 Connector desktop app")
    parser.add_argument("--smoke-test", metavar="REPORT", help="Launch a clean GUI smoke test and save a diagnostic result")
    args = parser.parse_args()
    if args.smoke_test:
        import MetaTrader5
        import cryptography
        import keyring.backends.Windows
        import tempfile
        with tempfile.TemporaryDirectory(prefix="ymfx-desktop-smoke-") as temporary:
            os.environ["LOCALAPPDATA"] = temporary
            root = tk.Tk()
            root.withdraw()
            app = ConnectorApp(root)
            root.update_idletasks()
            report = {"version": APP_VERSION, "gui": root.tk.call("info", "patchlevel"),
                      "mt5": MetaTrader5.__version__, "crypto": cryptography.__version__,
                      "frozen": bool(getattr(sys, "frozen", False)),
                      "default_origin": app.origin.get(), "startup": app.status.get(),
                      "terminal_slots": len(app.terminals)}
            app.instance.close()
            Path(args.smoke_test).write_text(json.dumps(report), encoding="utf-8")
            root.destroy()
        return
    root = tk.Tk()
    try:
        ConnectorApp(root)
    except RuntimeError:
        root.destroy()
        return
    root.mainloop()


if __name__ == "__main__":
    main()
