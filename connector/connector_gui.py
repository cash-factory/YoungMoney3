"""YoungMoney3 Connector / staging — polished, capture-only desktop session manager.

One UI controls many isolated portable MT5 directories through ONE capture
worker. Tk is main-thread-only; all broker, SQLite and HTTP work stays off Tk.
Tokens, broker passwords and pairing codes are never saved in GUI settings.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import queue
import re
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
import webbrowser

import connect
from sessions import SessionError, SessionStore

STAGING_URL = "https://ym-fx-staging.ethical-hacker263.workers.dev"
ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "YMFX" / "staging-gui"
SETTINGS = ROOT / "preferences.json"
BACKGROUND = "#091622"
SIDEBAR = "#0d1e2c"
PANEL = "#132a3a"
PANEL_ALT = "#183446"
BORDER = "#2a4858"
TEXT = "#edf6f5"
MUTED = "#a1bac6"
ACCENT = "#63dfc2"
WARM = "#e6c485"
DANGER = "#ff9a99"
FONT = "Segoe UI"
VERSION = "0.3.0-rc1"


def terminal_candidates():
    paths = []
    roots = [Path(os.environ.get("PROGRAMFILES", "C:/Program Files")),
             Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)")),
             Path.home() / "Documents", Path.home() / "Downloads"]
    for root in roots:
        if not root.exists():
            continue
        if root.name.lower() in ("documents", "downloads"):
            choices = [root / "MT5" / "terminal64.exe",
                       root / "MetaTrader 5" / "terminal64.exe"]
        else:
            choices = [root / "MetaTrader 5" / "terminal64.exe",
                       root / "MT5 Weltrade" / "terminal64.exe"]
            try:
                choices.extend(path / "terminal64.exe" for path in list(root.iterdir())[:120]
                               if path.is_dir() and ("mt5" in path.name.lower()
                                                     or "metatrader" in path.name.lower()))
            except OSError:
                pass
        for candidate in choices:
            try:
                if candidate.is_file():
                    resolved = str(candidate.resolve())
                    if resolved not in paths:
                        paths.append(resolved)
            except OSError:
                pass
    return paths


class ConnectorApp:
    NAV = (("overview", "Overview"), ("sessions", "Sessions"),
           ("pair", "Pair this PC"), ("activity", "Activity"),
           ("help", "Setup & help"))

    def __init__(self, root):
        self.root = root
        self.events = queue.Queue()
        self.worker = None
        self.worker_mode = None
        self.stop_event = threading.Event()
        self.pause_event = threading.Event()
        self.stopping = False
        self.pair_ok = False
        self.paired = False
        self.busy_since = None
        self.status_by_slot = {}
        self.account_by_slot = {}
        self.log_items = []
        self.last_summary = None
        self.current_page = "overview"
        self.store = SessionStore(SETTINGS)
        # Restore just the paired/unpaired UI state. No token is displayed,
        # logged, cached in preferences or sent over the network.
        try:
            service = "YMFX MT5 " + hashlib.sha256(STAGING_URL.encode()).hexdigest()[:16]
            connect.keyring.set_keyring(connect.WinVaultKeyring())
            self.paired = bool(connect.keyring.get_password(service, "token"))
        except Exception:
            self.paired = False
        self.root.title("YoungMoney3  /  MT5 Connector  /  Staging")
        w = min(1170, max(840, self.root.winfo_screenwidth() - 60))
        h = min(790, max(630, self.root.winfo_screenheight() - 90))
        self.root.geometry(f"{w}x{h}")
        self.root.minsize(840, 630)
        self.root.configure(bg=BACKGROUND)
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.status_var = tk.StringVar(value="Ready to configure")
        self.device_var = tk.StringVar(value=(
            "Existing pairing found in Windows Credential Manager"
            if self.paired else "Pair this PC once to begin"))
        self.queue_var = tk.StringVar(value="Waiting for a capture cycle")
        self.banner_var = tk.StringVar(value="Configure a session, then connect its broker account.")
        self.pair_stage_var = tk.StringVar(value="Step 1  •  Generate a five-minute pairing code on the dashboard.")
        self.code_var = tk.StringVar()
        self.code_error_var = tk.StringVar(value="32-character code • only used once, never stored in this app")
        self.pair_elapsed_var = tk.StringVar(value="")
        self.selected_details_var = tk.StringVar(value="Select a session to manage its account.")
        self.overview_sessions_var = tk.StringVar(value="0 configured")
        self.overview_active_var = tk.StringVar(value="0 enabled")
        self.overview_linked_var = tk.StringVar(value="0 verified accounts")
        self._configure_ttk()
        self._build()
        self.code_var.trace_add("write", lambda *_: self._validate_code())
        self._validate_code()
        self.refresh_sessions()
        self._log("Application ready. Broker capture is not started automatically.")
        self.root.after(160, self.poll)

    def _configure_ttk(self):
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("YM.Treeview", background=PANEL, fieldbackground=PANEL,
                        foreground=TEXT, rowheight=42, font=(FONT, 10),
                        relief="flat", borderwidth=0)
        style.configure("YM.Treeview.Heading", background=PANEL_ALT,
                        foreground=MUTED, font=(FONT, 9, "bold"),
                        padding=(12, 12), relief="flat")
        style.map("YM.Treeview", background=[("selected", "#255b65")],
                  foreground=[("selected", TEXT)])
        style.configure("YM.Vertical.TScrollbar", background=PANEL_ALT,
                        troughcolor=BACKGROUND, borderwidth=0)
        style.configure("YM.Horizontal.TProgressbar", troughcolor=PANEL_ALT,
                        background=ACCENT, borderwidth=0)

    def _label(self, parent, text="", *, size=10, color=TEXT, bold=False,
               wrap=0, textvar=None):
        opts = {"bg": parent.cget("bg"), "fg": color, "font": (FONT, size, "bold" if bold else "normal"),
                "anchor": "w", "justify": "left"}
        if wrap:
            opts["wraplength"] = wrap
        if textvar is not None:
            opts["textvariable"] = textvar
        else:
            opts["text"] = text
        return tk.Label(parent, **opts)

    def _button(self, parent, text, command, *, primary=False, quiet=False, width=None):
        background = ACCENT if primary else (PANEL_ALT if quiet else "#244656")
        foreground = BACKGROUND if primary else TEXT
        opts = {"text": text, "command": command, "bg": background, "fg": foreground,
                "activebackground": "#83f3d5" if primary else "#315d70",
                "activeforeground": BACKGROUND if primary else TEXT,
                "font": (FONT, 10, "bold"), "relief": "flat", "bd": 0,
                "cursor": "hand2", "padx": 15, "pady": 10,
                "highlightthickness": 2, "highlightbackground": background,
                "highlightcolor": ACCENT, "takefocus": True}
        if width:
            opts["width"] = width
        return tk.Button(parent, **opts)

    def _card(self, parent, pad=20):
        return tk.Frame(parent, bg=PANEL, highlightbackground=BORDER,
                        highlightthickness=1, padx=pad, pady=pad)

    def _scrollable_page(self, name):
        """Keep pairing/help actions reachable on smaller Windows displays."""
        host = self.pages[name]
        canvas = tk.Canvas(host, bg=BACKGROUND, highlightthickness=0, borderwidth=0)
        bar = ttk.Scrollbar(host, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=bar.set)
        bar.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)
        frame = tk.Frame(canvas, bg=BACKGROUND)
        window = canvas.create_window((0, 0), window=frame, anchor="nw")
        frame.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda e: canvas.itemconfigure(window, width=e.width))
        canvas.bind("<MouseWheel>", lambda e: canvas.yview_scroll(-1 if e.delta > 0 else 1, "units"))
        return frame

    def _stack_heading(self, parent, title, description):
        self._label(parent, title, size=21, bold=True).pack(anchor="w", pady=(0, 6))
        self._label(parent, description, size=10, color=MUTED,
                    wrap=810).pack(anchor="w", pady=(0, 24))

    def _build(self):
        self.sidebar = tk.Frame(self.root, bg=SIDEBAR, width=205,
                                highlightbackground=BORDER, highlightthickness=1)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)
        brand = tk.Frame(self.sidebar, bg=SIDEBAR, padx=19, pady=28)
        brand.pack(fill="x")
        self._label(brand, "YOUNGMONEY3", size=11, bold=True, color=ACCENT).pack(anchor="w")
        self._label(brand, "CONNECTOR", size=19, bold=True).pack(anchor="w", pady=(2, 4))
        self._label(brand, "Trading evidence, in sync.", size=9, color=MUTED).pack(anchor="w")
        tk.Frame(self.sidebar, bg=BORDER, height=1).pack(fill="x", padx=18, pady=(0, 18))
        self.nav_buttons = {}
        for key, title in self.NAV:
            row = tk.Frame(self.sidebar, bg=SIDEBAR, padx=12)
            row.pack(fill="x", pady=3)
            button = tk.Button(row, text=title, command=lambda page=key: self.show_page(page),
                               font=(FONT, 11), anchor="w", padx=14, pady=13,
                               bg=SIDEBAR, fg=MUTED, relief="flat", borderwidth=0,
                               activebackground=PANEL_ALT, activeforeground=TEXT,
                               cursor="hand2", takefocus=True)
            button.pack(fill="x")
            self.nav_buttons[key] = button
        tk.Frame(self.sidebar, bg=SIDEBAR).pack(fill="both", expand=True)
        foot = tk.Frame(self.sidebar, bg=SIDEBAR, padx=18, pady=20)
        foot.pack(fill="x")
        self._label(foot, "●  STAGING ENVIRONMENT", size=9, color=ACCENT,
                    bold=True).pack(anchor="w")
        self._label(foot, "Read-only  /  demo + contest", color=MUTED,
                    size=9).pack(anchor="w", pady=(6, 0))
        self._label(foot, "v" + VERSION + "   •   Windows x64",
                    color=MUTED, size=8).pack(anchor="w", pady=(14, 0))

        right = tk.Frame(self.root, bg=BACKGROUND, padx=29, pady=22)
        right.pack(side="left", fill="both", expand=True)
        header = tk.Frame(right, bg=BACKGROUND)
        header.pack(fill="x", pady=(0, 18))
        self._label(header, "MT5  /  DESKTOP SYNC", size=10, bold=True,
                    color=ACCENT).pack(side="left")
        self._label(header, "CAPTURE ONLY  •  NO TRADING COMMANDS", size=9,
                    color=MUTED).pack(side="right")
        tk.Frame(right, bg=BORDER, height=1).pack(fill="x")
        self.page_host = tk.Frame(right, bg=BACKGROUND)
        self.page_host.pack(fill="both", expand=True, pady=(22, 12))
        self.pages = {}
        for key, _ in self.NAV:
            page = tk.Frame(self.page_host, bg=BACKGROUND)
            page.place(x=0, y=0, relwidth=1, relheight=1)
            self.pages[key] = page
        self._build_overview()
        self._build_sessions()
        self._build_pairing()
        self._build_activity()
        self._build_help()
        footer = tk.Frame(right, bg=BACKGROUND)
        footer.pack(fill="x", pady=(2, 0))
        self._label(footer, textvar=self.banner_var, size=9,
                    color=WARM, wrap=800).pack(side="left", fill="x", expand=True)
        self._button(footer, "Open dashboard", lambda: webbrowser.open(STAGING_URL),
                     quiet=True).pack(side="right")
        self.show_page("overview")

    def _build_overview(self):
        page = self.pages["overview"]
        self._stack_heading(page, "Command centre",
                            "See what's connected, what is syncing, and what needs your attention.")
        stats = tk.Frame(page, bg=BACKGROUND)
        stats.pack(fill="x", pady=(0, 16))
        for title, var in (("LOCAL SESSIONS", self.overview_sessions_var),
                           ("ENABLED SESSIONS", self.overview_active_var),
                           ("VERIFIED ACCOUNTS", self.overview_linked_var)):
            card = self._card(stats, 18)
            card.pack(side="left", fill="both", expand=True, padx=(0, 10))
            self._label(card, title, size=9, bold=True, color=MUTED).pack(anchor="w")
            self._label(card, textvar=var, size=18, bold=True).pack(anchor="w", pady=(7, 0))
        hero = self._card(page, 23)
        hero.pack(fill="x", pady=(0, 16))
        self._label(hero, "Your capture service", size=14, bold=True).pack(anchor="w")
        self._label(hero, textvar=self.status_var, size=18, bold=True,
                    color=ACCENT).pack(anchor="w", pady=(10, 5))
        self._label(hero, textvar=self.queue_var, color=MUTED,
                    size=10).pack(anchor="w")
        self.progress = ttk.Progressbar(hero, mode="indeterminate",
                                        style="YM.Horizontal.TProgressbar")
        self.progress.pack(fill="x", pady=(17, 14))
        actions = tk.Frame(hero, bg=PANEL)
        actions.pack(fill="x")
        self._button(actions, "Start syncing", self.start, primary=True).pack(side="left", padx=(0, 9))
        self._button(actions, "Pause all", self.pause_all).pack(side="left", padx=(0, 9))
        self._button(actions, "Stop service", self.stop, quiet=True).pack(side="left")
        next_card = self._card(page, 20)
        next_card.pack(fill="x")
        self._label(next_card, "QUICK SETUP", size=9, color=ACCENT,
                    bold=True).pack(anchor="w")
        self._label(next_card, textvar=self.device_var, size=11,
                    bold=True).pack(anchor="w", pady=(8, 13))
        shortcuts = tk.Frame(next_card, bg=PANEL)
        shortcuts.pack(fill="x")
        self._button(shortcuts, "Pair this PC", lambda: self.show_page("pair")).pack(side="left", padx=(0, 8))
        self._button(shortcuts, "+ Add a session", self.add_session).pack(side="left", padx=(0, 8))
        self._button(shortcuts, "Manage sessions",
                     lambda: self.show_page("sessions"), quiet=True).pack(side="left")

    def _build_sessions(self):
        page = self.pages["sessions"]
        self._stack_heading(page, "Account sessions",
                            "One application, multiple MT5 accounts. Each account requires its own isolated portable terminal folder.")
        tools = tk.Frame(page, bg=BACKGROUND)
        tools.pack(fill="x", pady=(0, 16))
        self._button(tools, "+ Add session", self.add_session, primary=True).pack(side="left", padx=(0, 8))
        self._button(tools, "Detect terminals", self.detect_sessions).pack(side="left", padx=(0, 8))
        self._button(tools, "Start all", self.start_all).pack(side="left", padx=(0, 8))
        self._button(tools, "Pause all", self.pause_all, quiet=True).pack(side="left")
        table_area = self._card(page, 12)
        table_area.pack(fill="both", expand=True, pady=(0, 12))
        columns = ("name", "account", "status", "location")
        self.session_table = ttk.Treeview(table_area, columns=columns, show="headings",
                                           style="YM.Treeview", selectmode="browse", height=7)
        for key, text, width in (("name", "SESSION", 160),
                                  ("account", "BROKER / LOGIN", 176),
                                  ("status", "STATE", 145),
                                  ("location", "TERMINAL DIRECTORY", 270)):
            self.session_table.heading(key, text=text, anchor="w")
            self.session_table.column(key, width=width, minwidth=90, stretch=True, anchor="w")
        bar = ttk.Scrollbar(table_area, orient="vertical", command=self.session_table.yview,
                            style="YM.Vertical.TScrollbar")
        self.session_table.configure(yscrollcommand=bar.set)
        self.session_table.pack(side="left", fill="both", expand=True)
        bar.pack(side="right", fill="y")
        self.session_table.bind("<<TreeviewSelect>>", lambda _event: self._selected_session_details())
        detail = self._card(page, 15)
        detail.pack(fill="x")
        self._label(detail, textvar=self.selected_details_var, size=10,
                    color=MUTED, wrap=810).pack(anchor="w", pady=(0, 9))
        row = tk.Frame(detail, bg=PANEL)
        row.pack(fill="x")
        self._button(row, "Arm for account", self.arm_selected, primary=True).pack(side="left", padx=(0, 7), pady=2)
        self._button(row, "Start", self.start_selected).pack(side="left", padx=(0, 7), pady=2)
        self._button(row, "Pause", self.pause_selected).pack(side="left", padx=(0, 7), pady=2)
        self._button(row, "Rename", self.rename_selected, quiet=True).pack(side="left", padx=(0, 7), pady=2)
        self._button(row, "Folder", self.open_selected_folder, quiet=True).pack(side="left", padx=(0, 7), pady=2)
        self._button(row, "Remove", self.remove_selected, quiet=True).pack(side="left", pady=2)
        self._label(page, "ARM FOR ACCOUNT: Select a free session, arm it here, then use Connect MT5 account on the website. "
                    "An already linked session keeps its existing broker identity.",
                    size=9, color=MUTED, wrap=850).pack(anchor="w", pady=(6, 0))

    def _build_pairing(self):
        page = self._scrollable_page("pair")
        self._stack_heading(page, "Connect this PC",
                            "A guided, one-time secure link between this Windows user and your staging account.")
        steps = self._card(page, 22)
        steps.pack(fill="x", pady=(0, 14))
        self._label(steps, "01   Generate a pairing code", size=13, bold=True).pack(anchor="w")
        self._label(steps, "In YoungMoney3 staging, open MT5 Connections → Pair a PC. "
                    "The code expires after five minutes.", size=10,
                    color=MUTED, wrap=770).pack(anchor="w", pady=(6, 12))
        self._button(steps, "Open MT5 Connections in staging",
                     lambda: webbrowser.open(STAGING_URL), quiet=True).pack(anchor="w")
        field = self._card(page, 22)
        field.pack(fill="x", pady=(0, 14))
        self._label(field, "02   Paste the code", size=13, bold=True).pack(anchor="w")
        self._label(field, "Use Ctrl+V, the Paste button, or right-click the field.",
                    color=MUTED).pack(anchor="w", pady=(5, 12))
        entryrow = tk.Frame(field, bg=PANEL)
        entryrow.pack(fill="x")
        self.code_input = tk.Entry(entryrow, textvariable=self.code_var,
                                   width=38, show="●", font=("Consolas", 13),
                                   bg=BACKGROUND, fg=TEXT, insertbackground=TEXT,
                                   selectbackground="#386d78", relief="flat",
                                   highlightbackground=BORDER, highlightthickness=2,
                                   highlightcolor=ACCENT)
        self.code_input.pack(side="left", fill="x", expand=True, ipady=11, padx=(0, 8))
        self._button(entryrow, "Paste", self.paste_code).pack(side="left", padx=(0, 8))
        self._button(entryrow, "Show", self.toggle_code, quiet=True).pack(side="left", padx=(0, 8))
        self._button(entryrow, "Clear", lambda: self.code_var.set(""),
                     quiet=True).pack(side="left")
        self._attach_context_menu()
        self._label(field, textvar=self.code_error_var, color=MUTED,
                    size=9).pack(anchor="w", pady=(10, 0))
        confirmation = self._card(page, 22)
        confirmation.pack(fill="x")
        self._label(confirmation, "03   Verify and confirm", size=13,
                    bold=True).pack(anchor="w")
        self._label(confirmation, textvar=self.pair_stage_var, color=ACCENT,
                    size=10, wrap=770).pack(anchor="w", pady=(8, 8))
        self._label(confirmation, textvar=self.pair_elapsed_var, size=9,
                    color=MUTED).pack(anchor="w", pady=(0, 10))
        self.pair_button = self._button(confirmation, "Pair this PC",
                                        self.pair, primary=True)
        self.pair_button.pack(anchor="w")
        self._label(confirmation, "When it says 'PC paired successfully', return to Sessions, "
                    "add a terminal, arm it and connect its broker account on the website. "
                    "No broker password is entered here.", color=MUTED,
                    wrap=770, size=9).pack(anchor="w", pady=(15, 0))

    def _build_activity(self):
        page = self.pages["activity"]
        self._stack_heading(page, "Activity & diagnostics",
                            "Visible progress, safe retry messages and separate broker session activity.")
        tools = tk.Frame(page, bg=BACKGROUND)
        tools.pack(fill="x", pady=(0, 12))
        self._button(tools, "Copy diagnostics", self.copy_diagnostics,
                     primary=True).pack(side="left", padx=(0, 9))
        self._button(tools, "Clear display", self.clear_activity, quiet=True).pack(side="left")
        panel = self._card(page, 14)
        panel.pack(fill="both", expand=True)
        self.activity_text = tk.Text(panel, wrap="word", bg=BACKGROUND, fg=TEXT,
                                     selectbackground="#315b67",
                                     font=("Consolas", 10), relief="flat",
                                     borderwidth=0, spacing2=5,
                                     insertbackground=TEXT, state="disabled")
        scroll = ttk.Scrollbar(panel, orient="vertical", command=self.activity_text.yview)
        self.activity_text.configure(yscrollcommand=scroll.set)
        self.activity_text.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self._label(page, "No pairing codes, passwords or device tokens are included. "
                    "Copy the diagnostics when reporting an error.", color=MUTED,
                    size=9).pack(anchor="w", pady=(10, 0))

    def _build_help(self):
        page = self._scrollable_page("help")
        self._stack_heading(page, "Setup & troubleshooting",
                            "Everything needed to prepare isolated broker terminals for capture.")
        for title, desc in [
            ("01   Create a dedicated MT5 terminal",
             "Install MetaTrader 5. For each account, use its own writable /portable terminal directory. "
             "Do not reuse the same terminal64.exe path for multiple simultaneous accounts."),
            ("02   Pair this Windows user",
             "In the staging dashboard choose MT5 Connections → Pair a PC. Paste its 32-character code here. "
             "The app saves credentials in Windows Credential Manager, not in the session configuration."),
            ("03   Add and arm each session",
             "Browse to the first terminal64.exe, name its session, click Arm for account, "
             "then enter its broker server and account login on the website. Repeat for another terminal."),
            ("04   When a connection fails",
             "Open each isolated terminal once using /portable and log in to the correct broker account. "
             "Check File → Open an Account to find the exact server. MT5 IPC -10005 often means "
             "the terminal could not attach; confirm its terminal path, startup and profile."),
            ("05   Verify broker evidence",
             "Use the staging dashboard to confirm each broker timezone. Review historical fills before import; "
             "the default is 30 days and the maximum is 90 days. "
             "Live accounts and trading commands are not enabled.")
        ]:
            card = self._card(page, 14)
            card.pack(fill="x", pady=(0, 8))
            self._label(card, title, bold=True, size=11).pack(anchor="w")
            self._label(card, desc, color=MUTED, size=9,
                        wrap=790).pack(anchor="w", pady=(5, 0))

    def show_page(self, key):
        self.current_page = key
        self.pages[key].tkraise()
        for item, button in self.nav_buttons.items():
            selected = item == key
            button.configure(bg=PANEL_ALT if selected else SIDEBAR,
                             fg=ACCENT if selected else MUTED)
        if key == "sessions":
            self.refresh_sessions()

    def _attach_context_menu(self):
        menu = tk.Menu(self.code_input, tearoff=0, bg=PANEL_ALT, fg=TEXT,
                       activebackground="#2f6370", activeforeground=TEXT)
        menu.add_command(label="Cut", command=lambda: self.code_input.event_generate("<<Cut>>"))
        menu.add_command(label="Copy", command=lambda: self.code_input.event_generate("<<Copy>>"))
        menu.add_command(label="Paste", command=self.paste_code)
        menu.add_separator()
        menu.add_command(label="Select all", command=self.select_all_code)

        def open_menu(event):
            self.code_input.focus_set()
            menu.tk_popup(event.x_root, event.y_root)
            menu.grab_release()
            return "break"
        self.code_input.bind("<Button-3>", open_menu)
        self.code_input.bind("<Control-a>", self.select_all_code)
        self.code_input.bind("<Control-A>", self.select_all_code)
        self.code_input.bind("<Return>", lambda _event: self.pair())

    def select_all_code(self, _event=None):
        self.code_input.select_range(0, tk.END)
        self.code_input.icursor(tk.END)
        return "break"

    def paste_code(self):
        try:
            clip = self.root.clipboard_get()
        except tk.TclError:
            self.code_error_var.set("Clipboard is empty. Copy the code from the staging website.")
            return
        self.code_input.delete(0, tk.END)
        self.code_input.insert(0, clip.strip())
        self.code_input.focus_set()

    def toggle_code(self):
        self.code_input.configure(show="" if self.code_input.cget("show") else "●")

    def _normalized_code(self):
        return re.sub(r"[\s-]", "", self.code_var.get()).lower()

    def _validate_code(self):
        code = self._normalized_code()
        valid = bool(re.fullmatch(r"[a-f0-9]{32}", code))
        if code:
            self.code_error_var.set("Valid code format • ready to pair" if valid else
                                    f"{len(code)}/32 characters • use the complete code")
        else:
            self.code_error_var.set("32-character code • expires in five minutes • never logged")
        self.pair_button.configure(state="normal" if valid and not self._worker_busy()
                                   else "disabled")
        return valid

    def _worker_busy(self):
        return bool(self.worker and self.worker.is_alive())

    def pair(self):
        if not self._validate_code():
            self.pair_stage_var.set("The code is incomplete or invalid. Copy a new code from staging.")
            return
        if self._worker_busy():
            self.pair_stage_var.set("Stop the current capture service before pairing this PC again.")
            return
        if self.paired and not messagebox.askyesno("Pair again?",
            "Pairing again creates a new device identity. Existing links may need to be reconnected. Continue?"):
            return
        code = self._normalized_code()
        self.pair_ok = False
        self.pair_stage_var.set("Sending a secure pairing request…")
        self.banner_var.set("Connecting to staging. Pairing feedback appears here.")
        self.code_var.set("")
        self._log("Pairing request started. Waiting for staging to confirm.")
        self._start_worker([STAGING_URL, "--pair", "--pair-only"], pairing_code=code)

    def _selected(self):
        selected = self.session_table.selection()
        if not selected:
            raise SessionError("Select a session from the table first.")
        sid = selected[0]
        return next(s for s in self.store.snapshot() if s["id"] == sid)

    def _selected_session_details(self):
        try:
            s = self._selected()
        except (SessionError, StopIteration):
            self.selected_details_var.set("Select a session to manage its account.")
            return
        link = self.account_by_slot.get(s["terminal"])
        identity = (str(link.get("server") or "broker") + " / " +
                    str(link.get("login") or "account")) if link else "Not linked yet"
        self.selected_details_var.set(s["name"] + "  •  " + identity +
                                       "  •  " + s["terminal"])

    def _session_state(self, s):
        slot = s["terminal"]
        if not Path(slot).is_file():
            return "Terminal missing"
        if not s["enabled"]:
            return "Paused"
        if self.store.armed_terminal() == slot:
            return "Awaiting website"
        if slot not in self.account_by_slot:
            return "Ready to link"
        if not self._worker_busy() or self.worker_mode != "capture":
            return "Ready"
        return self.status_by_slot.get(slot, "Connecting")

    def refresh_sessions(self):
        entries = self.store.snapshot()
        selected = self.session_table.selection()
        for item in self.session_table.get_children():
            self.session_table.delete(item)
        for session in entries:
            slot = session["terminal"]
            link = self.account_by_slot.get(slot)
            account = (str(link.get("server", "")) + " · " +
                       str(link.get("login", ""))) if link else "Not linked"
            self.session_table.insert("", "end", iid=session["id"],
                values=(session["name"], account, self._session_state(session),
                        str(Path(slot).parent)))
        if selected and self.session_table.exists(selected[0]):
            self.session_table.selection_set(selected[0])
        self._selected_session_details()
        self.overview_sessions_var.set(f"{len(entries)} configured")
        enabled = sum(bool(s["enabled"]) and Path(s["terminal"]).is_file()
                      for s in entries)
        self.overview_active_var.set(f"{enabled} enabled")
        self.overview_linked_var.set(f"{len(self.account_by_slot)} verified")

    def _safe_change(self, action):
        try:
            action()
            self.refresh_sessions()
        except (SessionError, OSError, ValueError, StopIteration) as error:
            self._log("Session configuration needs attention: " + str(error))
            messagebox.showwarning("Session manager", str(error))

    def add_session(self):
        path = filedialog.askopenfilename(
            title="Choose a separate portable MT5 terminal64.exe",
            filetypes=[("MetaTrader 5 terminal", "terminal64.exe"),
                       ("Executable", "*.exe")])
        if not path:
            return
        def save():
            name = simpledialog.askstring("Name your session", "Session nickname (e.g. Exness Demo 1):",
                                          initialvalue=f"Session {len(self.store.snapshot()) + 1}",
                                          parent=self.root)
            if name is None:
                return
            item = self.store.add(path, name)
            self.status_var.set("New session added")
            self.banner_var.set("Session saved. Select it and choose Arm for account before connecting on staging.")
            self._log("Added session " + item["name"] + ".")
            self.show_page("sessions")
            self.session_table.selection_set(item["id"])
            self.session_table.focus(item["id"])
        self._safe_change(save)

    def detect_sessions(self):
        found = [p for p in terminal_candidates() if p not in self.store.all_terminals()]
        if not found:
            self.banner_var.set("No new MT5 terminals detected. Use Add session to browse an isolated portable copy.")
            return
        if not messagebox.askyesno("Detected MT5", f"Found {len(found)} MT5 executable(s). "
            "Only add writable dedicated /portable installations, not a shared trading terminal. Add these paths?"):
            return
        def save():
            for path in found:
                try:
                    self.store.add(path, Path(path).parent.name)
                except SessionError:
                    continue
            self._log(f"Detected {len(found)} MT5 terminal path(s). Verify each uses /portable.")
        self._safe_change(save)

    def rename_selected(self):
        def save():
            item = self._selected()
            name = simpledialog.askstring("Rename session", "New session nickname:",
                                          initialvalue=item["name"], parent=self.root)
            if name is not None:
                self.store.rename(item["id"], name)
                self._log("Renamed local session.")
        self._safe_change(save)

    def remove_selected(self):
        def save():
            item = self._selected()
            if item["terminal"] in self.account_by_slot:
                raise SessionError("This session has a linked broker account. Keep its profile, "
                                   "or revoke the account/device on staging before removing it.")
            if not messagebox.askyesno("Remove session?",
                    "Remove only this local profile? This does not delete MT5 files or broker evidence."):
                return
            self.store.remove(item["id"])
            self._log("Removed a local unlinked session profile; no broker data was deleted.")
        self._safe_change(save)

    def open_selected_folder(self):
        def open_it():
            path = Path(self._selected()["terminal"]).parent
            if not path.exists():
                raise SessionError("Terminal folder no longer exists.")
            if sys.platform == "win32":
                os.startfile(str(path))
            else:
                webbrowser.open(path.as_uri())
        self._safe_change(open_it)

    def arm_selected(self):
        def arm():
            item = self._selected()
            if item["terminal"] in self.account_by_slot:
                raise SessionError("This session already has an account. Add a separate terminal session for another account.")
            self.store.set_enabled(item["id"], True)
            self.store.arm(item["id"])
            if not self._worker_busy():
                self.start()
            elif self.worker_mode != "capture":
                raise SessionError("Finish PC pairing before arming a broker session.")
            self.status_var.set("Waiting for broker account")
            self.banner_var.set("Session armed: " + item["name"] +
                                 ". On staging, select Connect MT5 account and submit its credentials.")
            self._log("Armed " + item["name"] + " for the next website account request.")
        self._safe_change(arm)

    def start_selected(self):
        def start_one():
            item = self._selected()
            self.store.set_enabled(item["id"], True)
            if not self._worker_busy():
                self.start()
            self.banner_var.set(item["name"] + " enabled for capture.")
            self._log(item["name"] + " enabled.")
        self._safe_change(start_one)

    def pause_selected(self):
        def pause_one():
            item = self._selected()
            self.store.set_enabled(item["id"], False)
            self.status_by_slot[item["terminal"]] = "Paused"
            self._log(item["name"] + " paused. Other sessions continue; queued evidence remains intact.")
            self.banner_var.set(item["name"] + " paused independently.")
        self._safe_change(pause_one)

    def start_all(self):
        self._safe_change(lambda: self.store.set_all_enabled(True))
        self.start()

    def pause_all(self):
        self._safe_change(lambda: self.store.set_all_enabled(False))
        self.store.clear_arm()
        self.status_var.set("All sessions paused")
        self.banner_var.set("No account is being scanned. Outbox and saved credentials are preserved.")
        self._log("All sessions paused. Capture worker stays available for resuming.")

    def _start_worker(self, args, pairing_code=None):
        if self._worker_busy():
            self.banner_var.set("A connector operation is already running.")
            return
        self.stop_event.clear()
        self.pause_event.clear()
        self.busy_since = time.monotonic()
        self.worker_mode = "pair" if pairing_code is not None else "capture"
        self.status_var.set("Pairing securely…" if self.worker_mode == "pair" else
                            "Starting broker capture…")
        self.progress.start(12)
        self._validate_code()

        def work():
            try:
                connect.main(args, pairing_code=pairing_code,
                             stop_event=self.stop_event, pause_event=self.pause_event,
                             report=self.events.put,
                             all_slots=self.store.all_terminals,
                             active_slots=self.store.active_terminals,
                             armed_slot=self.store.armed_terminal)
            except BaseException as error:
                # Never expose exception detail: MT5/HTTP exceptions may embed
                # a URL, account identifier or credential-bearing payload.
                self.events.put({"state": "error",
                                 "message": "Connector operation failed (" +
                                 type(error).__name__ +
                                 "). See Activity and verify staging connectivity."})
            finally:
                self.events.put({"state": "worker-exit",
                                 "mode": "pair" if pairing_code is not None else "capture"})
        self.worker = threading.Thread(target=work, daemon=False,
                                       name="YMFX-single-MT5-SQLite-worker")
        self.worker.start()

    def start(self):
        if self._worker_busy():
            if self.worker_mode == "capture":
                self.pause_event.clear()
                self.status_var.set("Capture running")
                return
            self.banner_var.set("Complete PC pairing before starting capture.")
            return
        if not self.store.all_terminals():
            self.banner_var.set("Add a dedicated MT5 terminal session before starting capture.")
            self.show_page("sessions")
            return
        if not self.store.active_terminals():
            self.banner_var.set("All sessions paused. Enable at least one session first.")
            self.show_page("sessions")
            return
        self._log("Starting capture worker for enabled MT5 sessions.")
        self._start_worker([STAGING_URL, *self.store.all_terminals()])

    def stop(self):
        self.stop_event.set()
        self.pause_event.clear()
        if self._worker_busy():
            self.status_var.set("Stopping safely…")
            self.banner_var.set("Finishing the current request and preserving the upload queue.")
            self._log("Safe stop requested. Waiting for current broker operation.")
        else:
            self.status_var.set("Capture stopped")

    def _log(self, message):
        # Messages are composed from known app text, not user input, tokens or
        # HTTP payloads. Keep at most 250 events in memory and on-screen.
        timestamp = dt.datetime.now().strftime("%H:%M:%S")
        value = "[" + timestamp + "]  " + str(message)[:300]
        self.log_items.append(value)
        self.log_items = self.log_items[-250:]
        if hasattr(self, "activity_text"):
            self.activity_text.configure(state="normal")
            self.activity_text.insert("end", value + "\n")
            lines = int(self.activity_text.index("end-1c").split(".")[0])
            if lines > 255:
                self.activity_text.delete("1.0", f"{lines - 250}.0")
            self.activity_text.see("end")
            self.activity_text.configure(state="disabled")

    def clear_activity(self):
        self.log_items.clear()
        self.activity_text.configure(state="normal")
        self.activity_text.delete("1.0", tk.END)
        self.activity_text.configure(state="disabled")

    def copy_diagnostics(self):
        header = "YoungMoney3 Connector " + VERSION + " • staging • capture only\n"
        text = header + "\n".join(self.log_items)
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.banner_var.set("Safe diagnostic events copied. No pairing code or account password included.")

    def _event(self, item):
        state = item.get("state", "unknown")
        slot = item.get("slot")
        message = item.get("message", "")
        if state == "known-links":
            for record in item.get("links", []):
                self.account_by_slot[record["slot"]] = record
            if self.store.armed_terminal() in self.account_by_slot:
                self.store.clear_arm()
            self._log("Recovered " + str(len(item.get("links", []))) +
                      " saved broker link(s) from the existing connector database.")
        elif state == "paired":
            self.pair_ok = True
            self.paired = True
            # A new device token has its own broker links and SQLite folder.
            # Do not show the old device's linked accounts after re-pairing.
            self.account_by_slot.clear()
            self.status_by_slot.clear()
            self.device_var.set("PC paired successfully  •  ready for account setup")
            self.pair_stage_var.set("Success! Your PC is paired with staging.")
            self.pair_elapsed_var.set("Pairing confirmed by the staging server.")
            self.status_var.set("PC paired successfully")
            self.banner_var.set("PC paired. Add a session and arm it before submitting broker login details.")
            self._log("PC pairing confirmed. No account credentials are stored in the GUI.")
        elif state == "verifying":
            self.pair_stage_var.set("Website account request received; checking the selected terminal.")
            self.banner_var.set(message)
            self._log(message)
        elif state == "account-linked":
            self.account_by_slot[slot] = item
            self.status_by_slot[slot] = "Pending server sync"
            self.store.clear_arm(slot)
            self.banner_var.set("Broker login verified locally. Staging acknowledgement will follow on the next sync cycle.")
            self._log("Broker account linked to selected terminal " +
                      str(Path(slot).parent.name) + ".")
        elif state == "arm-consumed":
            self.store.clear_arm(slot)
        elif state == "session-synced":
            prior = self.status_by_slot.get(slot)
            self.status_by_slot[slot] = "Syncing"
            if prior != "Syncing":
                self._log("Broker session " + str(Path(slot).parent.name) + " synced successfully.")
        elif state in ("session-error", "account-error"):
            self.status_by_slot[slot] = "Connection issue"
            self.banner_var.set(message)
            self._log("Session attention required: " + message)
        elif state == "error":
            self.status_var.set("Connector error")
            self.pair_stage_var.set(message)
            self.banner_var.set(message)
            self._log("ERROR: " + message)
        elif state == "worker-exit":
            self.progress.stop()
            if item.get("mode") == "pair":
                if not self.pair_ok and not self.status_var.get().startswith("Connector error"):
                    self.pair_stage_var.set("Pairing did not complete. Generate a new code and retry.")
                elif self.pair_ok:
                    self.status_var.set("PC paired successfully")
            else:
                self.status_var.set("Capture stopped")
                self._log("Worker stopped; outbox and paired accounts retained.")
            self.busy_since = None
        elif state == "running":
            self.status_var.set("Capture running")
            if item.get("linked") is not None:
                self.queue_var.set("Linked accounts: " + str(item["linked"]) +
                                   "  •  Outbox: " + str(item.get("queued", 0)) +
                                   " queued  •  Cycle: " + str(item.get("last_sync", "—"))[:19])
            if self.last_summary != "running":
                self._log("Capture service online; individual sessions cycle sequentially.")
                self.last_summary = "running"
        elif state == "retrying":
            self.status_var.set("Retrying connection")
            self.banner_var.set("Broker/network issue. Retrying without losing queued events.")
            if self.last_summary != "retrying":
                self._log("Capture temporarily offline; retry scheduled.")
                self.last_summary = "retrying"
        elif state == "paused":
            self.status_var.set("Capture paused")
        self.refresh_sessions()

    def poll(self):
        try:
            while True:
                item = self.events.get_nowait()
                self._event(item)
        except queue.Empty:
            pass
        if self.worker and not self.worker.is_alive():
            # A finished pairing task does not erase its success or error state.
            self.progress.stop()
            self.worker = None
            self.worker_mode = None
            self._validate_code()
        if self.worker_mode == "pair" and self.busy_since is not None:
            self.pair_elapsed_var.set(
                "Waiting for confirmation  •  " +
                str(int(time.monotonic() - self.busy_since)) + " seconds elapsed")
        if self.stopping:
            if self.worker is None:
                self.root.destroy()
                return
        self.root.after(160, self.poll)

    def close(self):
        if self.stopping:
            return
        self.stopping = True
        self.stop()
        if self.worker is None:
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
                    # Exercise real nav/pairing widgets without starting capture
                    # or touching any user session/credential setting.
                    if not {"overview", "sessions", "pair", "activity", "help"} <= set(app.pages):
                        raise RuntimeError("New session manager navigation is incomplete")
                    app.code_var.set("a" * 32)
                    if not app._validate_code():
                        raise RuntimeError("Pair code validation did not accept a valid code")
                    app.code_var.set("")
                    if app._validate_code():
                        raise RuntimeError("Pair code validation accepted an empty code")
                    if not app.code_input.bind("<Button-3>"):
                        raise RuntimeError("Right-click pairing context menu is missing")
                    for folder, sentinel in (("_tcl_data", "init.tcl"), ("_tk_data", "tk.tcl")):
                        if not (bundle / folder / sentinel).is_file():
                            raise RuntimeError("Bundled Tcl/Tk data missing")
                    Path(sys.argv[2]).write_text(json.dumps({
                        "startup": "ok", "frozen": True, "capture_started": False,
                        "session_manager": len(app.pages) == 5 and bool(app.session_table),
                        "pairing_controls": bool(app.pair_button) and bool(app.code_input),
                        "activity_view": bool(app.activity_text),
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
