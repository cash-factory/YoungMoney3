"""YoungMoney3 Connector / staging — polished, capture-only desktop session manager.

One UI controls many isolated portable MT5 directories through ONE capture
worker. Tk is main-thread-only; all broker, SQLite and HTTP work stays off Tk.
Tokens, broker passwords and pairing codes are never saved in GUI settings.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import multiprocessing
import subprocess
import json
import os
import queue
import re
import sqlite3
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
import webbrowser

import connect
from sessions import SessionError, SessionStore
from terminal_factory import TerminalCopyError, create_terminal
from concurrent_capture import run_parallel_smoke
from managed_accounts import ManagedAccounts, discover_installations, INSTALL_PAGE
from studio_ui import AnimatedButton, ResponsiveActions, ConnectionPath, StudioArt, brand_mark, windows_motion_enabled, restart_wait_seconds
from version import VERSION
from copy_execution import prepare_database as prepare_copy_database, set_consent as update_copy_consent
from trader_ui import TradeJourney, permission_summary, trader_message

STAGING_URL = "https://ym-fx-staging.ethical-hacker263.workers.dev"
ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "YMFX" / "staging-gui"
SETTINGS = ROOT / "preferences.json"
# Porcelain / ink: contemporary trading workspace with cool, quiet contrast.
# Brand red is retained in the original identity mark, not painted on every button.
BACKGROUND = "#F5F7FA"
SIDEBAR = "#FFFFFF"
PANEL = "#FFFFFF"
PANEL_ALT = "#EEF2F8"
BORDER = "#DEE5EE"
TEXT = "#17283E"
MUTED = "#607187"
ACCENT = "#4357D6"
WARM = "#926327"
DANGER = "#B5485E"
SUCCESS = "#157A65"
FONT = "Segoe UI"


def terminal_candidates():
    return [str(exe) for exe, _ in discover_installations()]


class ConnectorApp:
    NAV = (("overview", "Home"), ("sessions", "My accounts"),
           ("copy", "Trade copying"), ("pair", "Connect this PC"),
           ("activity", "Recent activity"), ("help", "Help"))

    def __init__(self, root, *, restore=True):
        self.root = root
        self.events = queue.Queue()
        self.worker = None
        self.worker_mode = None
        self.copy_worker = None
        self.copy_cancel = threading.Event()
        self.active_workers = 0
        self.stop_event = threading.Event()
        self.pause_event = threading.Event()
        self.stopping = False
        self.pair_ok = False
        self.paired = False
        self.resume_after_pair = False
        self.login_requested = False
        self.focus_setup = False
        self.focus_slot = None
        self.pc_state = "starting"
        self.device_id = None
        self.pc_name = None
        self.setup_state = None
        self.remote_paused = set()
        self.busy_since = None
        self.restart_due = None
        self.restart_delay = 0
        self.status_by_slot = {}
        self.sync_by_slot = {}
        self.retry_queue = queue.Queue()
        self.account_by_slot = {}
        self.copy_authorization_by_slot = {}
        self._links_initialized = False
        self.log_items = []
        self.last_summary = None
        self.current_page = "overview"
        self.action_groups = []
        self.header_art = {}
        self._page_canvases = {}
        self._layout_job = None
        self._poll_job = None
        self.motion_var = tk.BooleanVar(value=windows_motion_enabled())
        self.store = SessionStore(SETTINGS)
        self.managed_accounts = ManagedAccounts(self.store, ROOT.parent / "terminals")
        # Restore just the paired/unpaired UI state. No token is displayed,
        # logged, cached in preferences or sent over the network.
        try:
            service = "YMFX MT5 " + hashlib.sha256(STAGING_URL.encode()).hexdigest()[:16]
            connect.keyring.set_keyring(connect.WinVaultKeyring())
            self.paired = restore and bool(connect.keyring.get_password(service, "token"))
        except Exception:
            self.paired = False
        self.root.title("YoungMoney3  ·  MT5 Connector")
        w = min(1280, max(720, self.root.winfo_screenwidth() - 60))
        h = min(850, max(560, self.root.winfo_screenheight() - 90))
        self.root.geometry(f"{w}x{h}")
        self.root.minsize(720, 560)
        self.root.configure(bg=BACKGROUND)
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.status_var = tk.StringVar(value="Ready to pair")
        self.device_var = tk.StringVar(value=(
            "Existing pairing found in Windows Credential Manager"
            if self.paired else "Pair this PC once to begin"))
        self.queue_var = tk.StringVar(value="Add your first account to begin.")
        self.banner_var = tk.StringVar(value="Choose Add account to get started.")
        self.pair_stage_var = tk.StringVar(value="Step 1  •  Generate a five-minute pairing code on the dashboard.")
        self.code_var = tk.StringVar()
        self.code_error_var = tk.StringVar(value="32-character code • only used once, never stored in this app")
        self.pair_elapsed_var = tk.StringVar(value="")
        self.selected_details_var = tk.StringVar(value="Select an account to see its details.")
        self.copy_account_choice = tk.StringVar(value="")
        self.copy_choice_map = {}
        self.copy_permission_var = tk.StringVar(value="Choose a receiving account")
        self.copy_help_var = tk.StringVar(value="Select the account that should receive copied trades.")
        self.tour_step_var = tk.StringVar(value="")
        self.tour_index = -1
        self.account_total_var = tk.StringVar(value="0")
        self.account_active_var = tk.StringVar(value="0")
        self.account_attention_var = tk.StringVar(value="0")
        self.connection_badge_var = tk.StringVar(
            value="● SAVED PAIRING" if self.paired else "● SETUP NEEDED")
        self._configure_ttk()
        self._build()
        self.root.bind("<Configure>", self._queue_responsive_layout, add="+")
        self.root.bind("<MouseWheel>", self._wheel_page, add="+")
        self.root.bind("<Destroy>", self._cleanup_ui, add="+")
        self._layout_job = self.root.after_idle(self._responsive_layout)
        self.code_var.trace_add("write", lambda *_: self._validate_code())
        self._validate_code()
        self.refresh_sessions()
        self._log("Account monitor opened.")
        if self.paired:
            self.root.after_idle(self.start)
        self._poll_job = self.root.after(160, self.poll)

    def _configure_ttk(self):
        # ttkbootstrap gives native data controls a consistent contemporary
        # appearance. The original high-contrast ttk styles remain a safe
        # fallback for source-only installations without the optional theme.
        try:
            import ttkbootstrap
            style = ttkbootstrap.Style(theme="litera")
        except ImportError:
            style = ttk.Style(self.root)
            style.theme_use("clam")
        style.configure("YM.Treeview", background=PANEL, fieldbackground=PANEL,
                        foreground=TEXT, rowheight=52, font=(FONT, 10),
                        relief="flat", borderwidth=0)
        style.configure("YM.Treeview.Heading", background=PANEL_ALT,
                        foreground=MUTED, font=(FONT, 9, "bold"),
                        padding=(12, 12), relief="flat")
        style.map("YM.Treeview", background=[("selected", "#E5EAFD")],
                  foreground=[("selected", TEXT)])
        style.configure("YM.Vertical.TScrollbar", background=PANEL_ALT,
                        troughcolor=BACKGROUND, borderwidth=0, bordercolor=BACKGROUND,
                        lightcolor=PANEL_ALT, darkcolor=PANEL_ALT,
                        arrowcolor=MUTED, width=11, arrowsize=11)
        style.map("YM.Vertical.TScrollbar", background=[("active", "#CBD5E4")])
        style.configure("YM.Horizontal.TScrollbar", background=PANEL_ALT,
                        troughcolor=BACKGROUND, borderwidth=0, bordercolor=BACKGROUND,
                        lightcolor=PANEL_ALT, darkcolor=PANEL_ALT,
                        arrowcolor=MUTED, width=11, arrowsize=11)
        style.map("YM.Horizontal.TScrollbar", background=[("active", "#CBD5E4")])
        style.configure("YM.TCombobox", fieldbackground=PANEL_ALT, background=PANEL_ALT,
                        foreground=TEXT, arrowcolor=TEXT, selectbackground=PANEL_ALT,
                        selectforeground=TEXT, padding=(12, 9))
        style.map("YM.TCombobox", fieldbackground=[("readonly", PANEL_ALT)],
                  foreground=[("readonly", TEXT)])
        style.configure("YM.Horizontal.TProgressbar", troughcolor=PANEL_ALT,
                        background=ACCENT, borderwidth=0, bordercolor=PANEL_ALT,
                        lightcolor=ACCENT, darkcolor=ACCENT, thickness=5)

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
        label = tk.Label(parent, **opts)
        if wrap or textvar is not None:
            limit = wrap or 800
            def fit(_event=None):
                inset = sum(parent.winfo_pixels(str(parent.cget(option)))
                            for option in ("padx", "borderwidth", "highlightthickness")) * 2
                label.configure(wraplength=min(limit, max(100, parent.winfo_width() - inset - 2)))
            parent.bind("<Configure>", fit, add="+")
        return label

    def _button(self, parent, text, command, *, primary=False, quiet=False, width=None):
        background = ACCENT if primary else (PANEL_ALT if quiet else "#E6EAF9")
        foreground = "#FFFFFF" if primary else TEXT
        opts = {"text": text, "command": command, "bg": background, "fg": foreground,
                "activebackground": "#586BE5" if primary else "#E0E8F5",
                "activeforeground": "#FFFFFF" if primary else TEXT,
                "font": (FONT, 10, "bold"), "relief": "flat", "bd": 0,
                "cursor": "hand2", "padx": 15, "pady": 10,
                "highlightthickness": 2, "highlightbackground": background,
                "highlightcolor": ACCENT, "takefocus": True}
        if width:
            opts["width"] = width
        opts["disabledforeground"] = "#8994A4"
        return AnimatedButton(parent, motion=self.motion_var.get, **opts)

    def _actions(self, parent, specifications, *, minimum=132):
        group = ResponsiveActions(parent, bg=parent.cget("bg"), minimum=minimum)
        group.pack(fill="x")
        self.action_groups.append(group)
        for text, command, options in specifications:
            group.add(self._button(group, text, command, **options))
        return group

    def _queue_responsive_layout(self, event=None):
        if event is not None and event.widget is not self.root:
            return
        if self._layout_job is not None:
            self.root.after_cancel(self._layout_job)
        self._layout_job = self.root.after_idle(self._responsive_layout)

    def _cleanup_ui(self, event):
        if event.widget is self.root:
            for attribute in ("_poll_job", "_layout_job"):
                job = getattr(self, attribute, None)
                if job is not None:
                    self.root.after_cancel(job)
                    setattr(self, attribute, None)

    def _responsive_layout(self):
        self._layout_job = None
        compact = self.root.winfo_width() < 1060
        self.sidebar.configure(width=180 if compact else 205)
        self.workspace.configure(padx=17 if compact else 29, pady=16 if compact else 21)
        short = self.root.winfo_height() < 660
        self.sidebar_footer.configure(pady=12 if short else 20)
        self.environment_label.configure(text="●  PREVIEW" if short else "●  PREVIEW WORKSPACE")
        self.sidebar_mode_label.configure(text="Your accounts, your control" if short else "Your accounts stay in your control.")
        if short:
            self.sidebar_version_label.pack_forget()
        elif not self.sidebar_version_label.winfo_manager():
            self.sidebar_version_label.pack(anchor="w", pady=(14, 0))
        self._arrange_overview()
        self._arrange_copy()
        self._arrange_pair()
        for group in self.action_groups:
            group.reflow()

    def _wheel_page(self, event):
        canvas = self._page_canvases.get(self.current_page)
        if canvas is not None and event.widget.winfo_class() not in ("Text", "Treeview", "Entry"):
            canvas.yview_scroll(-1 if event.delta > 0 else 1, "units")

    def _set_busy_feedback(self, active):
        for bar in (self.pair_progress,):
            bar.stop()
            if active and self.motion_var.get():
                bar.configure(mode="indeterminate")
                bar.start(18)
            else:
                bar.configure(mode="determinate", value=55 if active else 0)
        if active and self.worker_mode == "pair":
            self.pair_progress.pack(fill="x", pady=(0, 12), before=self.pair_button)
        else:
            self.pair_progress.pack_forget()

    def _refresh_motion(self):
        self.connection_path.show(self.connection_path.level)
        self._set_busy_feedback(self._worker_busy() or bool(self.copy_worker and self.copy_worker.is_alive()))
        for art in self.header_art.values():
            if not self.motion_var.get():
                art.reveal()
        if not self.motion_var.get():
            self.copy_route._cancel()
            self.copy_route.draw()

    def _card(self, parent, pad=20):
        return tk.Frame(parent, bg=PANEL, highlightbackground=BORDER,
                        highlightthickness=1, padx=pad, pady=pad)

    def _scrollable_page(self, name):
        """Keep pairing/help actions reachable on smaller Windows displays."""
        host = self.pages[name]
        canvas = tk.Canvas(host, bg=BACKGROUND, highlightthickness=0, borderwidth=0)
        bar = ttk.Scrollbar(host, orient="vertical", command=canvas.yview,
                            style="YM.Vertical.TScrollbar")
        canvas.configure(yscrollcommand=bar.set)
        bar.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)
        frame = tk.Frame(canvas, bg=BACKGROUND)
        window = canvas.create_window((0, 0), window=frame, anchor="nw")
        frame.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda e: canvas.itemconfigure(window, width=e.width))
        self._page_canvases[name] = canvas
        return frame

    def _draw_header_art(self, parent, variant):
        # Native shapes share their host background, avoiding a framed image seam.
        art = StudioArt(parent, variant, background=BACKGROUND,
                        accent=ACCENT, motion=self.motion_var.get)
        art.pack(side="right", padx=(18, 0))
        self.header_art[variant] = art
        return art

    def _stack_heading(self, parent, title, description):
        header = tk.Frame(parent, bg=BACKGROUND)
        header.pack(fill="x", pady=(0, 17))
        copy = tk.Frame(header, bg=BACKGROUND)
        copy.pack(side="left", fill="both", expand=True)
        self._label(copy, "YOUNGMONEY  /  ACCOUNT CONNECTIONS", size=8, bold=True,
                    color=ACCENT).pack(anchor="w", pady=(0, 7))
        self._label(copy, title, size=25, bold=True).pack(anchor="w", pady=(0, 7))
        self._label(copy, description, size=10, color=MUTED,
                    wrap=470).pack(anchor="w")
        art = self._draw_header_art(header, title)
        def fit_header(event):
            if event.width < 660:
                art.pack_forget()
            elif not art.winfo_manager():
                art.pack(side="right", padx=(18, 0))
        header.bind("<Configure>", fit_header, add="+")

    def _build(self):
        self.sidebar = tk.Frame(self.root, bg=SIDEBAR, width=205,
                                highlightbackground=BORDER, highlightthickness=1)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)
        brand = tk.Frame(self.sidebar, bg=SIDEBAR, padx=12, pady=25)
        brand.pack(fill="x")
        lockup = tk.Frame(brand, bg=SIDEBAR)
        lockup.pack(fill="x", pady=(0, 10))
        brand_mark(lockup, SIDEBAR).pack(side="left", padx=(0, 8))
        wordmark = tk.Frame(lockup, bg=SIDEBAR)
        wordmark.pack(side="left", fill="x", expand=True)
        self._label(wordmark, "YOUNGMONEY3", size=7, bold=True, color=ACCENT).pack(anchor="w")
        self._label(wordmark, "CONNECTOR", size=10, bold=True).pack(anchor="w", pady=(2, 0))
        self._label(brand, "Your trading companion.", size=9, color=MUTED, wrap=160).pack(anchor="w")
        tk.Frame(self.sidebar, bg=BORDER, height=1).pack(fill="x", padx=18, pady=(0, 18))
        self.nav_buttons = {}
        for key, title in self.NAV:
            row = tk.Frame(self.sidebar, bg=SIDEBAR, padx=12)
            row.pack(fill="x", pady=3)
            button = AnimatedButton(row, motion=self.motion_var.get,
                               text=title, command=lambda page=key: self.show_page(page),
                               font=(FONT, 10, "bold"), anchor="w", padx=14, pady=11,
                               bg=SIDEBAR, fg=MUTED, relief="flat", borderwidth=0,
                               activebackground=PANEL_ALT, activeforeground=TEXT,
                               cursor="hand2", takefocus=True)
            button.pack(fill="x")
            self.nav_buttons[key] = button
        tk.Frame(self.sidebar, bg=SIDEBAR).pack(fill="both", expand=True)
        foot = self.sidebar_footer = tk.Frame(self.sidebar, bg=SIDEBAR, padx=18, pady=20)
        foot.pack(fill="x")
        self.environment_label = self._label(foot, "●  PREVIEW WORKSPACE", size=9,
                                             color=ACCENT, wrap=155, bold=True)
        self.environment_label.pack(anchor="w")
        self.sidebar_mode_label = self._label(foot, "Your accounts stay in your control.", color=MUTED,
                                              size=9, wrap=155)
        self.sidebar_mode_label.pack(anchor="w", pady=(6, 0))
        self.sidebar_version_label = self._label(foot, "v" + VERSION + "   •   Windows x64",
                                                 color=MUTED, size=8, wrap=155)
        self.sidebar_version_label.pack(anchor="w", pady=(14, 0))

        right = self.workspace = tk.Frame(self.root, bg=BACKGROUND, padx=29, pady=22)
        right.pack(side="left", fill="both", expand=True)
        header = tk.Frame(right, bg=BACKGROUND)
        header.pack(fill="x", pady=(0, 16))
        bridge_label = self._label(header, "MT5 CONNECTIONS", size=10, bold=True,
                                   color=ACCENT)
        bridge_label.pack(side="left")
        safety_label = self._label(header, "MONITORING IS READ-ONLY  ·  COPYING REQUIRES APPROVAL", size=8,
                                   color=MUTED)
        safety_label.pack(side="right")
        def fit_topbar(event):
            narrow = event.width < 650
            bridge_label.pack_configure(side="top" if narrow else "left", anchor="w",
                                         pady=(0, 5 if narrow else 0))
            safety_label.pack_configure(side="top" if narrow else "right", anchor="w")
        header.bind("<Configure>", fit_topbar, add="+")
        tk.Frame(right, bg=BORDER, height=1).pack(fill="x")
        self.page_host = tk.Frame(right, bg=BACKGROUND)
        self.page_host.pack(fill="both", expand=True, pady=(16, 4))
        self.pages = {}
        for key, _ in self.NAV:
            page = tk.Frame(self.page_host, bg=BACKGROUND)
            page.place(x=0, y=0, relwidth=1, relheight=1)
            self.pages[key] = page
        self._build_overview()
        self._build_sessions()
        self._build_copy()
        self._build_pairing()
        self._build_activity()
        self._build_help()
        footer = tk.Frame(right, bg=BACKGROUND)
        footer.pack(fill="x", pady=(2, 0))
        self._label(footer, textvar=self.banner_var, size=9,
                    color=MUTED, wrap=1000).pack(fill="x", pady=(0, 4))
        self.tour_strip = tk.Frame(footer, bg=PANEL_ALT,
                                   highlightbackground=BORDER, highlightthickness=1,
                                   padx=12, pady=10)
        self._label(self.tour_strip, textvar=self.tour_step_var, color=TEXT, size=9,
                    wrap=650).pack(side="left", fill="x", expand=True, padx=(0, 12))
        self._button(self.tour_strip, "Back", self._tour_back, quiet=True).pack(side="left", padx=4)
        self._button(self.tour_strip, "Next", self._tour_next, primary=True).pack(side="left", padx=4)
        self._button(self.tour_strip, "Skip", self._tour_end, quiet=True).pack(side="left", padx=4)
        footer_actions = tk.Frame(footer, bg=BACKGROUND)
        footer_actions.pack(fill="x")
        tk.Checkbutton(footer_actions, text="Motion", variable=self.motion_var,
                       command=self._refresh_motion,
                       bg=BACKGROUND, fg=MUTED, selectcolor=PANEL_ALT,
                       activebackground=BACKGROUND, activeforeground=TEXT,
                       font=(FONT, 9), cursor="hand2", highlightthickness=0,
                       takefocus=True).pack(side="left")
        self._label(footer_actions, "Private connection  ·  No orders without your permission", color=MUTED, size=8).pack(side="left", padx=12)
        self._button(footer_actions, "Open dashboard  ↗", lambda: webbrowser.open(STAGING_URL),
                     quiet=True).pack(side="right")
        self.show_page("overview")

    def _build_overview(self):
        page = self._scrollable_page("overview")
        self._stack_heading(page,"Your trading accounts",
                            "One quiet place to check your accounts, track trades and manage copying.")
        self.overview_columns = tk.Frame(page,bg=BACKGROUND)
        self.overview_columns.pack(fill="x",pady=(0,14))
        self.overview_columns.grid_columnconfigure(0,weight=2)
        self.overview_columns.grid_columnconfigure(1,weight=1)

        hero = self.overview_status = self._card(self.overview_columns,24)
        top = tk.Frame(hero,bg=PANEL)
        top.pack(fill="x",pady=(0,12))
        self._label(top,"CONNECTION STATUS",size=9,bold=True,color=MUTED).pack(side="left")
        self._label(top,textvar=self.connection_badge_var,size=8,
                    bold=True,color=SUCCESS).pack(side="right")
        self._label(hero,textvar=self.status_var,size=25,bold=True).pack(anchor="w",pady=(0,7))
        self._label(hero,textvar=self.device_var,size=10,color=MUTED,wrap=550).pack(anchor="w")
        self.connection_path = ConnectionPath(hero,background=PANEL,motion=self.motion_var.get)
        self.connection_path.pack(fill="x",pady=(14,8))
        self.hero_pc_button = self._button(
            hero,"Rename this computer" if self.paired else "Connect this computer",
            self._hero_pc_action,primary=not self.paired,quiet=self.paired)
        self.hero_pc_button.pack(anchor="w")
        self.progress = ttk.Progressbar(hero,style="YM.Horizontal.TProgressbar")

        next_card = self.overview_next = self._card(self.overview_columns,22)
        self._label(next_card,"WHAT WOULD YOU LIKE TO DO?",size=9,bold=True,
                    color=MUTED).pack(anchor="w",pady=(0,10))
        self._label(next_card,"Get trading",size=20,bold=True).pack(anchor="w")
        self._label(next_card,textvar=self.queue_var,color=MUTED,size=10,
                    wrap=400).pack(anchor="w",pady=(7,14))
        self.quick_setup_actions = self._actions(next_card,[
            ("Add an account",self.add_account,{"primary":True}),
            ("Set up copying",lambda:self.show_page("copy"),{"quiet":True}),
            ("Open dashboard",self.open_dashboard,{"quiet":True})],minimum=148)
        self._label(next_card,"Your journal watches trades. Copying only runs when you approve it.",
                    size=9,color=MUTED,wrap=400).pack(anchor="w",pady=(13,0))
        numbers=tk.Frame(page,bg=BACKGROUND)
        numbers.pack(fill="x",pady=(0,12))
        self.overview_metrics=[]
        for index,(label,variable,subtitle) in enumerate((
            ("YOUR ACCOUNTS",self.account_total_var,"Linked to this computer"),
            ("UPDATING",self.account_active_var,"Sending trade information"),
            ("NEED ATTENTION",self.account_attention_var,"Paused or disconnected"),
        )):
            card=self._card(numbers,16)
            card.pack(side="left",fill="both",expand=True,
                      padx=(0,10) if index!=2 else 0)
            self._label(card,label,size=9,color=MUTED,bold=True).pack(anchor="w")
            self._label(card,textvar=variable,size=24,bold=True).pack(anchor="w",pady=(5,3))
            self._label(card,subtitle,size=9,color=MUTED,wrap=200).pack(anchor="w")
            self.overview_metrics.append(card)
        self._arrange_overview()

    def _arrange_overview(self):
        if not hasattr(self,"overview_columns"):return
        compact=self.root.winfo_width()<920
        for item in (self.overview_status,self.overview_next):
            item.grid_forget()
        if compact:
            self.overview_columns.grid_columnconfigure(0,weight=1)
            self.overview_columns.grid_columnconfigure(1,weight=0)
            self.overview_status.grid(row=0,column=0,sticky="ew")
            self.overview_next.grid(row=1,column=0,sticky="ew",pady=(12,0))
        else:
            self.overview_columns.grid_columnconfigure(0,weight=2)
            self.overview_columns.grid_columnconfigure(1,weight=1)
            self.overview_status.grid(row=0,column=0,sticky="nsew",padx=(0,12))
            self.overview_next.grid(row=0,column=1,sticky="nsew")

    def _hero_pc_action(self):
        if self.paired:
            self.rename_this_pc()
        else:
            self.show_page("pair")

    def _build_sessions(self):
        page=self._scrollable_page("sessions")
        self._stack_heading(page,"My accounts",
                            "Select any account to view its connection and manage it.")
        self.session_tools=self._actions(page,[
            ("Add account",self.add_account,{"primary":True}),
            ("Open dashboard",self.open_dashboard,{"quiet":True}),
            ("More options",self.toggle_advanced,{"quiet":True})],minimum=150)
        self.session_tools.pack_configure(pady=(0,14))

        # Keep Treeview as the proven keyboard-addressable selection model.
        # The trader sees account cards instead of a filesystem-style table.
        table_area=tk.Frame(page,bg=BACKGROUND)
        columns=("name","account","status","location")
        self.session_table=ttk.Treeview(table_area,columns=columns,show="headings",
                                        style="YM.Treeview",selectmode="browse",height=5)
        for key,title,width in (("name","ACCOUNT",180),("account","BROKER",200),
                                 ("status","STATUS",160),("location","INSTALLATION",260)):
            self.session_table.heading(key,text=title,anchor="w")
            self.session_table.column(key,width=width,minwidth=90,stretch=True,anchor="w")
        self.session_table.configure(displaycolumns=("name","account","status"))
        self.session_table.bind("<<TreeviewSelect>>",lambda _e:self._selected_session_details())

        self.account_rows_host=tk.Frame(page,bg=BACKGROUND)
        self.account_rows_host.pack(fill="x",pady=(0,12))
        self._account_signature=None
        self.empty_accounts=self._card(self.account_rows_host,24)
        empty=tk.Frame(self.empty_accounts,bg=PANEL)
        empty.pack(fill="x")
        symbol=tk.Canvas(empty,width=58,height=60,bg=PANEL,highlightthickness=0)
        symbol.pack(side="left",padx=(0,20))
        symbol.create_oval(6,5,53,52,fill="#EBEFFC",outline="")
        symbol.create_line(18,29,42,29,fill=ACCENT,width=3)
        symbol.create_line(30,17,30,41,fill=ACCENT,width=3)
        words=tk.Frame(empty,bg=PANEL)
        words.pack(side="left",fill="both",expand=True)
        self._label(words,"Your accounts will appear here",size=15,bold=True).pack(anchor="w")
        self._label(words,"Add one MT5 account to see live connection status and saved trade updates.",
                    size=10,color=MUTED,wrap=550).pack(anchor="w",pady=(5,0))
        self._label(self.empty_accounts,
                    "Once connected, choose the account card to open its controls.",
                    color=MUTED,size=9).pack(anchor="w",pady=(12,0))

        self.account_detail=self._card(page,20)
        headline=tk.Frame(self.account_detail,bg=PANEL)
        headline.pack(fill="x",pady=(0,10))
        self._label(headline,"ACCOUNT CONTROLS",size=9,bold=True,
                    color=ACCENT).pack(anchor="w")
        self._label(self.account_detail,textvar=self.selected_details_var,size=11,
                    color=MUTED,wrap=770).pack(anchor="w",pady=(0,14))
        self._label(self.account_detail,"Monitoring",size=12,bold=True).pack(anchor="w",pady=(0,8))
        self.session_actions=self._actions(self.account_detail,[
            ("Resume",self.start_selected,{"primary":True}),
            ("Try reconnecting",self.retry_selected,{"quiet":True}),
            ("Pause",self.pause_selected,{"quiet":True}),
            ("Rename",self.rename_selected,{"quiet":True}),
            ("Remove",self.remove_selected,{"quiet":True})],minimum=135)
        self._label(self.account_detail,"Copying & details",size=12,
                    bold=True).pack(anchor="w",pady=(15,8))
        self.copy_controls=self._actions(self.account_detail,[
            ("Account details",self.inspect_selected_account,{"quiet":True}),
            ("Copying permissions",lambda:self.show_page("copy"),{"quiet":True}),
            ("Open Copy Fleet",lambda:webbrowser.open(STAGING_URL+"/#copy-studio"),
             {"quiet":True})],minimum=152)
        self._button(self.account_detail,"Close account controls",
                     self._hide_account_detail,quiet=True).pack(anchor="e",pady=(12,0))

        self.advanced=self._card(page,16)
        self._label(self.advanced,"Advanced MT5 tools",size=12,
                    bold=True).pack(anchor="w",pady=(0,5))
        self._label(self.advanced,
                    "Only needed for custom terminal installations or special connection problems.",
                    size=10,color=MUTED,wrap=790).pack(anchor="w",pady=(0,12))
        advanced=self._actions(self.advanced,[
            ("Create terminal",self.create_named_terminal,{"quiet":True}),
            ("Duplicate",self.duplicate_selected,{"quiet":True}),
            ("Find existing",self.add_session,{"quiet":True}),
            ("Find MT5",self.detect_sessions,{"quiet":True}),
            ("Prepare login",self.arm_selected,{"quiet":True}),
            ("Open folder",self.open_selected_folder,{"quiet":True}),
            ("Open MT5",self.launch_selected,{"quiet":True}),
            ("Stop monitoring",self.stop,{"quiet":True})],minimum=135)
        self.create_button,self.duplicate_button=advanced.buttons[:2]

    def _select_account(self,session_id):
        if not self.session_table.exists(session_id):
            return
        self.session_table.selection_set(session_id)
        self.session_table.focus(session_id)
        self._selected_session_details()
        self._render_account_cards(force=True)
        self.root.after_idle(
            lambda: self._page_canvases["sessions"].yview_moveto(1))

    def _hide_account_detail(self):
        self.session_table.selection_remove(self.session_table.selection())
        self.account_detail.pack_forget()
        self._render_account_cards(force=True)

    def _render_account_cards(self,force=False):
        entries=self.store.snapshot()
        selected=self.session_table.selection()
        active=selected[0] if selected else None
        signature=tuple((s["id"],s["name"],s["enabled"],
                         self._session_state(s),
                         str(self.account_by_slot.get(s["terminal"],{}).get("login") or ""),
                         s["id"]==active) for s in entries)
        if not force and signature==self._account_signature:
            return
        self._account_signature=signature
        for widget in list(self.account_rows_host.winfo_children()):
            if widget is not self.empty_accounts:
                widget.destroy()
        if entries:
            self.empty_accounts.pack_forget()
            for record in entries:
                info=self.account_by_slot.get(record["terminal"],{})
                selected_now=record["id"]==active
                row=tk.Frame(self.account_rows_host,bg=PANEL,
                             highlightthickness=1,
                             highlightbackground=ACCENT if selected_now else BORDER,
                             padx=18,pady=13)
                row.pack(fill="x",pady=(0,9))
                emblem=tk.Canvas(row,width=43,height=43,bg=PANEL,
                                  highlightthickness=0)
                emblem.pack(side="left",padx=(0,13))
                emblem.create_oval(1,1,42,42,fill="#EDF1FC",outline="")
                emblem.create_text(22,22,text="MT",fill=ACCENT,
                                   font=(FONT,10,"bold"))
                copy=tk.Frame(row,bg=PANEL)
                copy.pack(side="left",fill="both",expand=True)
                self._label(copy,record["name"],size=12,bold=True).pack(anchor="w")
                broker=str(info.get("server") or "Awaiting broker login")
                login=str(info.get("login") or "")
                self._label(copy,broker+("  ·  "+login if login else ""),
                            color=MUTED,size=9,wrap=460).pack(anchor="w",pady=(3,0))
                right=tk.Frame(row,bg=PANEL)
                right.pack(side="right")
                status=self._session_state(record)
                positive=status in ("Synced","Capturing","Ready")
                chip=tk.Label(right,text=("●  "+status),
                              font=(FONT,9,"bold"),
                              fg=SUCCESS if positive else (DANGER if "issue" in status.lower()
                                                or "missing" in status.lower() else MUTED),
                              bg="#E8F6F0" if positive else PANEL_ALT,
                              padx=10,pady=5)
                chip.pack(anchor="e",pady=(0,7))
                self._button(right,"Manage account",lambda sid=record["id"]:
                             self._select_account(sid),quiet=True).pack(anchor="e")
            if active and self.session_table.exists(active):
                if not self.account_detail.winfo_manager():
                    self.account_detail.pack(fill="x",pady=(3,13),
                                              after=self.account_rows_host)
            else:
                self.account_detail.pack_forget()
        else:
            self.account_detail.pack_forget()
            self.empty_accounts.pack(fill="x",pady=(0,8))

    def _build_copy(self):
        page=self._scrollable_page("copy")
        self._stack_heading(page,"Trade copying",
                            "Choose who follows your trades. You decide when copying starts.")
        steps=tk.Frame(page,bg=BACKGROUND)
        steps.pack(fill="x",pady=(0,14))
        for index,(title,subtitle) in enumerate((
            ("01  CHOOSE","Receiving account"),
            ("02  APPROVE","On this computer"),
            ("03  START","On your dashboard"),
        )):
            segment=tk.Frame(steps,bg="#E9EDFC" if index==0 else PANEL,
                             highlightbackground=BORDER,highlightthickness=1,
                             padx=12,pady=10)
            segment.pack(side="left",fill="both",expand=True,
                         padx=(0,8) if index!=2 else 0)
            self._label(segment,title,size=9,bold=True,
                        color=ACCENT if index==0 else MUTED).pack(anchor="w")
            self._label(segment,subtitle,size=9,color=TEXT,wrap=140).pack(anchor="w",pady=(3,0))
        self.copy_columns=tk.Frame(page,bg=BACKGROUND)
        self.copy_columns.pack(fill="x",pady=(0,12))
        self.copy_columns.grid_columnconfigure(0,weight=3)
        self.copy_columns.grid_columnconfigure(1,weight=2)
        self.copy_left=tk.Frame(self.copy_columns,bg=BACKGROUND)
        self.copy_right=tk.Frame(self.copy_columns,bg=BACKGROUND)

        choose=self._card(self.copy_left,20)
        choose.pack(fill="x",pady=(0,11))
        self._label(choose,"Receiving account",size=16,bold=True).pack(anchor="w",pady=(0,5))
        self._label(choose,"Select the broker account that should receive copied trades.",
                    size=10,color=MUTED,wrap=520).pack(anchor="w",pady=(0,11))
        self.copy_account_combo=ttk.Combobox(choose,textvariable=self.copy_account_choice,
                                             state="readonly",style="YM.TCombobox",
                                             font=(FONT,11))
        self.copy_account_combo.pack(fill="x",ipady=4)
        self.copy_account_combo.bind("<<ComboboxSelected>>",self._choose_copy_account)
        self.copy_add_account_button=self._button(choose,"Add receiving account",
                                                  self.add_account,quiet=True)
        self.copy_add_account_button.pack(anchor="w",pady=(11,0))

        allow=self._card(self.copy_left,20)
        allow.pack(fill="x")
        self._label(allow,"Copying permission",size=16,bold=True).pack(anchor="w",pady=(0,7))
        self._label(allow,textvar=self.copy_permission_var,
                    size=12,bold=True).pack(anchor="w",pady=(0,5))
        self._label(allow,textvar=self.copy_help_var,
                    color=MUTED,size=10,wrap=550).pack(anchor="w",pady=(0,13))
        self.copy_action_buttons=self._actions(allow,[
            ("Allow demo copying",self.authorize_selected_demo_copy,{"primary":True}),
            ("Allow live copying",self.authorize_selected_live_copy,{"quiet":True}),
            ("Stop copying",self.disable_selected_demo_copy,{"quiet":True}),
            ("Check permission",self._load_copy_permission,{"quiet":True}),
        ],minimum=156)
        warning=tk.Frame(allow,bg="#FCF6EB",padx=11,pady=9)
        warning.pack(fill="x",pady=(12,0))
        self._label(warning,
                    "Live copying can place real broker orders. It remains disabled in this test release.",
                    size=9,color=WARM,wrap=560).pack(anchor="w")

        activate=self._card(self.copy_right,20)
        activate.pack(fill="x",pady=(0,11))
        self._label(activate,"Finish on your dashboard",size=16,bold=True).pack(anchor="w",pady=(0,8))
        for heading,detail in (
            ("1. Allow this account","Confirm its permission here on this computer."),
            ("2. Check every follower","Each receiving account needs its own permission."),
            ("3. Switch on copying","Start the fleet on your YoungMoney3 dashboard."),
        ):
            line=tk.Frame(activate,bg=PANEL)
            line.pack(fill="x",pady=(0,11))
            self._label(line,heading,size=10,bold=True).pack(anchor="w")
            self._label(line,detail,size=9,color=MUTED,
                        wrap=330).pack(anchor="w",pady=(3,0))
        self.copy_web_actions=self._actions(activate,[
            ("Open Copy Fleet",lambda:webbrowser.open(STAGING_URL+"/#copy-studio"),
             {"primary":True}),
            ("Account details",self.inspect_selected_account,{"quiet":True}),
        ],minimum=150)
        safety=self._card(self.copy_right,18)
        safety.pack(fill="x")
        self._label(safety,"Built-in safeguards",size=12,bold=True).pack(anchor="w")
        self._label(safety,
                    "Only receiving accounts you approve can copy. "
                    "Paused fleets do not send new instructions. "
                    "Orders already placed at your broker cannot be undone by Pause.",
                    size=9,color=MUTED,wrap=350).pack(anchor="w",pady=(8,0))
        self._arrange_copy()

        self.copy_explain_button=self._button(
            page,"How does trade copying work?",self._toggle_copy_explanation,quiet=True)
        self.copy_explain_button.pack(anchor="w",pady=(3,12))
        flow=self._card(page,18)
        self.copy_explanation=flow
        self._label(flow,"FROM YOUR MAIN ACCOUNT TO YOUR FOLLOWERS",
                    size=9,color=MUTED,bold=True).pack(anchor="w",pady=(0,5))
        self.copy_route=TradeJourney(flow,background=PANEL,
                                    accent=ACCENT,motion=self.motion_var.get)
        self.copy_route.pack(fill="x")
        self._label(flow,
                    "Copying watches eligible new changes on your chosen main account. "
                    "Each receiving account uses its own limits and must pass broker checks.",
                    color=MUTED,size=10,wrap=800).pack(anchor="w",pady=(5,0))

    def _arrange_copy(self):
        if not hasattr(self,"copy_columns"):return
        compact=self.root.winfo_width()<920
        for panel in (self.copy_left,self.copy_right):
            panel.grid_forget()
        if compact:
            self.copy_columns.grid_columnconfigure(0,weight=1)
            self.copy_columns.grid_columnconfigure(1,weight=0)
            self.copy_left.grid(row=0,column=0,sticky="ew")
            self.copy_right.grid(row=1,column=0,sticky="ew",pady=(11,0))
        else:
            self.copy_columns.grid_columnconfigure(0,weight=3)
            self.copy_columns.grid_columnconfigure(1,weight=2)
            self.copy_left.grid(row=0,column=0,sticky="nsew",padx=(0,12))
            self.copy_right.grid(row=0,column=1,sticky="nsew")

    def _toggle_copy_explanation(self):
        if self.copy_explanation.winfo_manager():
            self.copy_explanation.pack_forget()
            self.copy_explain_button.configure(text="How does copying work?")
        else:
            self.copy_explanation.pack(fill="x",after=self.copy_explain_button,
                                       pady=(0,14))
            self.copy_explain_button.configure(text="Hide explanation")

    def _choose_copy_account(self, _event=None):
        sid = self.copy_choice_map.get(self.copy_account_choice.get())
        if not sid or not self.session_table.exists(sid):
            self.copy_permission_var.set("Choose a connected receiving account")
            self.copy_help_var.set("Add or reconnect your account in My accounts first.")
            self.copy_route.set_state("off")
            return
        self.session_table.selection_set(sid)
        self.session_table.focus(sid)
        self._selected_session_details()
        self._load_copy_permission()

    def _load_copy_permission(self):
        try:
            slot, link = self._selected_copy_target()
        except (SessionError, StopIteration):
            self.copy_permission_var.set("Choose a connected receiving account")
            self.copy_help_var.set("Select a receiving account above. You can add one in My accounts.")
            self.copy_route.set_state("off")
            return
        self.copy_permission_var.set("Checking this account…")
        self.copy_help_var.set("Reading the permission saved on your computer.")
        def read():
            try:
                path = self._copy_database_path()
                if not path.is_file():
                    raise SessionError("This account has not finished its first sync.")
                with sqlite3.connect(path, timeout=20) as db:
                    prepare_copy_database(db)
                    row = db.execute(
                        "SELECT approved,mode FROM copy_local_permissions WHERE link=?", (link,)
                    ).fetchone()
                self.events.put({"state":"copy-permission-view","slot":slot,"link":link,
                                 "approved":bool(row and row[0]),"mode":row[1] if row else "none"})
            except Exception:
                self.events.put({"state":"copy-permission-view","slot":slot,"link":link,
                                 "approved":False,"mode":"none"})
        threading.Thread(target=read, name="YMFX-copy-status",daemon=True).start()

    def toggle_advanced(self):
        if self.advanced.winfo_manager():
            self.advanced.pack_forget()
        else:
            self.advanced.pack(fill="x", after=self.session_tools, pady=(0, 8))

    def open_dashboard(self):
        webbrowser.open(STAGING_URL + "/#mt5")

    def add_account(self):
        self.login_requested = True
        if not self.paired:
            self.show_page("pair")
            return
        if self.pc_state == "pc-service-incompatible":
            self.banner_var.set("Your dashboard and this connector need the same version. Your PC link is safe; update the connector and try again.")
            return
        if self.pc_state != "pc-online":
            self.banner_var.set("Contacting your dashboard. The login will open when this PC is online.")
            if not self._worker_busy():
                self.start()
            return
        if self.setup_state == "install":
            self.banner_var.set("Install MetaTrader 5 and leave the connector open. Setup will continue automatically.")
            if messagebox.askyesno("Install MetaTrader 5", "This PC needs MetaTrader 5. Open the official installer page?"):
                webbrowser.open(INSTALL_PAGE)
            return
        self.login_requested = False
        webbrowser.open(STAGING_URL + "/?addAccount=" + self.device_id + "#mt5")

    def _build_pairing(self):
        page=self._scrollable_page("pair")
        self._stack_heading(page,"Connect this computer",
                            "Link this PC to your YoungMoney3 account once. Your connection will be saved.")
        self.pair_columns=tk.Frame(page,bg=BACKGROUND)
        self.pair_columns.pack(fill="x")
        self.pair_left=tk.Frame(self.pair_columns,bg=BACKGROUND)
        self.pair_right=tk.Frame(self.pair_columns,bg=BACKGROUND)

        field=self._card(self.pair_left,24)
        field.pack(fill="x")
        self._label(field,"Your secure pairing code",size=17,bold=True).pack(anchor="w")
        self._label(field,
                    "Get the code from your dashboard. Paste it below to connect this computer.",
                    size=10,color=MUTED,wrap=550).pack(anchor="w",pady=(5,13))
        self.code_input=tk.Entry(field,textvariable=self.code_var,
                                 width=38,show="●",font=("Consolas",13),
                                 bg=PANEL_ALT,fg=TEXT,insertbackground=TEXT,
                                 selectbackground="#D9E2FA",relief="flat",
                                 highlightbackground=BORDER,highlightthickness=1,
                                 highlightcolor=ACCENT)
        self.code_input.pack(fill="x",ipady=12,pady=(0,9))
        self.code_actions=self._actions(field,[
            ("Paste code",self.paste_code,{"quiet":True}),
            ("Show / hide",self.toggle_code,{"quiet":True}),
            ("Clear",lambda:self.code_var.set(""),{"quiet":True})],minimum=130)
        self._attach_context_menu()
        self._label(field,textvar=self.code_error_var,color=MUTED,
                    wrap=530,size=9).pack(anchor="w",pady=(11,6))
        self._label(field,textvar=self.pair_stage_var,color=ACCENT,
                    wrap=550,size=10).pack(anchor="w",pady=(10,5))
        self._label(field,textvar=self.pair_elapsed_var,color=MUTED,size=9).pack(anchor="w",pady=(0,8))
        self.pair_button=self._button(field,"Connect this computer",self.pair,primary=True)
        self.pair_button.pack(anchor="w",pady=(2,8))
        self.pair_progress=ttk.Progressbar(field,mode="indeterminate",
                                           style="YM.Horizontal.TProgressbar")

        instructions=self._card(self.pair_right,21)
        instructions.pack(fill="x")
        self._label(instructions,"Three simple steps",size=16,bold=True).pack(anchor="w",pady=(0,12))
        for num,name,detail in (
            ("01","Open your dashboard","Go to MT5 Connections and select Pair a PC."),
            ("02","Copy the code","It works once and expires in five minutes."),
            ("03","Add your account","The connector will help set up your MT5 login."),
        ):
            row=tk.Frame(instructions,bg=PANEL)
            row.pack(fill="x",pady=(0,14))
            bullet=tk.Label(row,text=num,bg="#EEF2FC",fg=ACCENT,
                            font=(FONT,9,"bold"),padx=8,pady=6)
            bullet.pack(side="left",anchor="n",padx=(0,10))
            words=tk.Frame(row,bg=PANEL)
            words.pack(side="left",fill="both",expand=True)
            self._label(words,name,size=10,bold=True).pack(anchor="w")
            self._label(words,detail,size=9,color=MUTED,
                        wrap=280).pack(anchor="w",pady=(4,0))
        self._button(instructions,"Open MT5 Connections",
                     self.open_dashboard,quiet=True).pack(fill="x")
        self._label(instructions,
                    "No broker password is saved in this screen. Your existing PC pairing is preserved when you update the connector.",
                    size=9,color=MUTED,wrap=350).pack(anchor="w",pady=(15,0))
        self._arrange_pair()

    def _arrange_pair(self):
        if not hasattr(self,"pair_columns"):return
        compact=self.root.winfo_width()<920
        for item in (self.pair_left,self.pair_right):
            item.grid_forget()
        if compact:
            self.pair_columns.grid_columnconfigure(0,weight=1)
            self.pair_columns.grid_columnconfigure(1,weight=0)
            self.pair_left.grid(row=0,column=0,sticky="ew")
            self.pair_right.grid(row=1,column=0,sticky="ew",pady=(12,0))
        else:
            self.pair_columns.grid_columnconfigure(0,weight=3)
            self.pair_columns.grid_columnconfigure(1,weight=2)
            self.pair_left.grid(row=0,column=0,sticky="nsew",padx=(0,12))
            self.pair_right.grid(row=0,column=1,sticky="nsew")

    def _build_activity(self):
        page=self.pages["activity"]
        self._stack_heading(page,"Recent activity",
                            "See account updates and find out what needs attention.")
        tools=tk.Frame(page,bg=BACKGROUND)
        tools.pack(fill="x",pady=(0,12))
        self._button(tools,"Copy support information",
                     self.copy_diagnostics,quiet=True).pack(side="left",padx=(0,9))
        self._button(tools,"Clear this list",
                     self.clear_activity,quiet=True).pack(side="left")
        panel=self._card(page,21)
        panel.pack(fill="both",expand=True)
        self._label(panel,"WHAT'S HAPPENING",size=9,color=MUTED,
                    bold=True).pack(anchor="w",pady=(0,12))
        timeline=tk.Frame(panel,bg=PANEL)
        timeline.pack(fill="both",expand=True)
        self.activity_text=tk.Text(timeline,wrap="word",
                                   bg=PANEL,fg=TEXT,selectbackground="#DDE6FF",
                                   font=(FONT,10),relief="flat",borderwidth=0,
                                   spacing1=9,spacing2=5,spacing3=8,
                                   insertbackground=TEXT,state="disabled")
        scroll=ttk.Scrollbar(timeline,orient="vertical",command=self.activity_text.yview,
                              style="YM.Vertical.TScrollbar")
        self.activity_text.configure(yscrollcommand=scroll.set)
        self.activity_text.pack(side="left",fill="both",expand=True)
        scroll.pack(side="right",fill="y")
        self._label(page,
                    "Only connection updates appear here. Support information does not include passwords or pairing codes.",
                    color=MUTED,size=9,wrap=840).pack(anchor="w",pady=(11,0))

    def _build_help(self):
        page=self._scrollable_page("help")
        self._stack_heading(page,"Help when you need it",
                            "Short answers, without technical instructions.")
        welcome=self._card(page,21)
        welcome.pack(fill="x",pady=(0,14))
        self._label(welcome,"A quick guided tour",size=17,bold=True).pack(anchor="w")
        self._label(welcome,
                    "Explore the important screens at your own pace. Skip at any time.",
                    size=10,color=MUTED,wrap=790).pack(anchor="w",pady=(6,13))
        self._button(welcome,"Show me around",self._tour_start,
                     primary=True).pack(anchor="w")
        self._label(page,"COMMON QUESTIONS",size=9,color=MUTED,
                    bold=True).pack(anchor="w",pady=(9,11))
        answers=(
            ("How do I connect this computer?",
             "Open Connect this computer, get a pairing code from MT5 Connections on your dashboard, paste it and choose Connect. The link is kept for future launches."),
            ("How do I add another broker account?",
             "Choose Add account. Enter your MT5 broker, account number and password on the dashboard. The app prepares a separate MT5 workspace when needed."),
            ("My account stopped updating. What now?",
             "Check MetaTrader is running, then open My accounts, select the account and choose Try reconnecting. Missing trade history is checked again when the broker reconnects."),
            ("Why can’t I start trade copying?",
             "Each receiving account must be connected, trading-enabled, and specifically approved in Trade copying on this PC. Refresh the Copy Fleet website screen to see exactly which account needs attention."),
            ("Can copying place real orders?",
             "Demo copying can place demo broker orders only after you approve the account and start its fleet. Live-money copying remains unavailable in this test release."),
            ("Do I lose my history when I disconnect?",
             "No. The connector keeps already captured information and retries uploads after reconnecting. It retrieves broker deals that were available while disconnected; unobserved intermediate stop changes cannot be invented."),
            ("How do I manage several accounts?",
             "Each broker account has its own monitored MT5 session. Select an account under My accounts to pause, resume, rename, retry or view its details."),
        )
        self.help_items=[]
        for title,description in answers:
            card=self._card(page,12)
            card.pack(fill="x",pady=(0,7))
            title_button=self._button(card,title+"   +",
                                      lambda:None,quiet=True)
            title_button.configure(anchor="w",font=(FONT,10,"bold"),
                                   padx=9,pady=8)
            title_button.pack(fill="x")
            answer=self._label(card,description,size=10,color=MUTED,wrap=810)
            def toggle(button=title_button,copy=answer,name=title):
                if copy.winfo_manager():
                    copy.pack_forget()
                    button.configure(text=name+"   +")
                else:
                    copy.pack(fill="x",padx=10,pady=(5,9))
                    button.configure(text=name+"   −")
            title_button.configure(command=toggle)
            self.help_items.append((title_button,answer))

    TOUR_STEPS = (
        ("overview", "Your home: see whether the computer is connected and how many accounts are updating."),
        ("pair", "Connect this PC: link this computer to your YoungMoney3 account one time."),
        ("sessions", "My accounts: add, reconnect, or pause individual broker accounts."),
        ("copy", "Trade copying: choose a receiving account and allow it to copy trades on this computer."),
        ("activity", "Recent activity: review updates and copy support details if anything needs attention."),
    )

    def _tour_start(self):
        self.tour_index = 0
        self._tour_visit()

    def _tour_visit(self):
        if not 0 <= self.tour_index < len(self.TOUR_STEPS):
            self._tour_end()
            return
        page,description=self.TOUR_STEPS[self.tour_index]
        self.tour_step_var.set("GUIDE "+str(self.tour_index+1)+"/"+
                               str(len(self.TOUR_STEPS))+"  ·  "+description)
        if not self.tour_strip.winfo_manager():
            self.tour_strip.pack(fill="x", pady=(0, 10))
        self.show_page(page)

    def _tour_next(self):
        self.tour_index += 1
        self._tour_visit()

    def _tour_back(self):
        self.tour_index = max(0,self.tour_index-1)
        self._tour_visit()

    def _tour_end(self):
        self.tour_index = -1
        self.tour_strip.pack_forget()
        self.banner_var.set("Guide closed. You can open it again from Help.")

    def show_page(self, key):
        self.current_page = key
        self.pages[key].tkraise()
        for item, button in self.nav_buttons.items():
            selected = item == key
            button.set_tones("#E8ECFC" if selected else SIDEBAR, "#EEF1FA")
            button.configure(fg=ACCENT if selected else MUTED)
        if key in ("sessions", "copy"):
            self.refresh_sessions()
        if key == "copy" and self.copy_account_choice.get():
            self._choose_copy_account()
        titles = {"overview": "Your trading accounts", "sessions": "My accounts",
                  "copy": "Trade copying", "pair": "Connect this computer",
                  "activity": "Recent activity", "help": "Help when you need it"}
        art = self.header_art.get(titles.get(key))
        if art:
            art.reveal()
        canvas = self._page_canvases.get(key)
        if canvas is not None:
            canvas.yview_moveto(0)

    def _attach_context_menu(self):
        menu = tk.Menu(self.code_input, tearoff=0, bg=PANEL_ALT, fg=TEXT,
                       activebackground="#E8ECFC", activeforeground=TEXT)
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
        self.pair_button.configure(text="Pairing securely…" if self._worker_busy() and self.worker_mode == "pair" else "Pair this PC")
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
        if self.paired:
            self.pair_stage_var.set("This PC already has a saved pairing. Reuse it instead of generating another PC entry.")
            self.banner_var.set("Open Overview to see the paired PC name and identifier. You can rename it there.")
            self.show_page("overview")
            return
        code = self._normalized_code()
        self.pair_ok = False
        self.pair_stage_var.set("Sending a secure pairing request…")
        self.banner_var.set("Connecting to staging. Pairing feedback appears here.")
        self.code_var.set("")
        self._log("Pairing request started. Waiting for staging to confirm.")
        self._start_worker([STAGING_URL, "--pair", "--pair-only"], pairing_code=code)

    def rename_this_pc(self):
        if not self.paired or self.pc_state != "pc-online":
            self.banner_var.set("Connect this paired PC to the dashboard before changing its name.")
            return
        proposed = simpledialog.askstring("Rename paired PC",
            "This name appears in the connector and on your YoungMoney3 dashboard.\n"
            "Example: Trading Laptop · Office", initialvalue=self.pc_name or "",
            parent=self.root)
        if proposed is None:
            return
        proposed = proposed.strip()
        if not (2 <= len(proposed) <= 48 and proposed[0].isalnum() and
                re.fullmatch(r"[\w .()'&·–-]+", proposed)):
            self.banner_var.set("Use a PC name between 2 and 48 characters, without file path characters.")
            return
        self.banner_var.set("Updating your PC name on staging…")
        def perform():
            try:
                result = connect.rename_paired_pc(STAGING_URL, proposed)
                self.events.put({"state":"pc-renamed","device":result.get("device"),"name":result.get("name")})
            except Exception:
                self.events.put({"state":"pc-name-error"})
        threading.Thread(target=perform, name="YMFX-rename-PC", daemon=True).start()

    def _selected(self):
        selected = self.session_table.selection()
        if not selected:
            raise SessionError("Choose an account first.")
        sid = selected[0]
        return next(s for s in self.store.snapshot() if s["id"] == sid)

    def _selected_session_details(self):
        try:
            s = self._selected()
        except (SessionError, StopIteration):
            self.selected_details_var.set("Choose an account to see its details.")
            return
        link = self.account_by_slot.get(s["terminal"])
        identity = (str(link.get("server") or "broker") + " / " +
                    str(link.get("login") or "account")) if link else "Not linked yet"
        receipt = self.sync_by_slot.get(s["terminal"])
        if receipt:
            identity += "  •  Last sync " + receipt[0] + "  •  " + str(receipt[1]) + " decisions awaiting review"
        copy_state = self.copy_authorization_by_slot.get(s["terminal"])
        if copy_state is not None:
            identity += "  •  copying " + ("allowed" if copy_state else "off")
        self.selected_details_var.set(s["name"] + "  •  " + identity)

    def _copy_database_path(self):
        # The token is read from Windows Credential Manager strictly to derive
        # the connector's existing local data directory. Never display it.
        service = "YMFX MT5 " + hashlib.sha256(STAGING_URL.encode()).hexdigest()[:16]
        connect.keyring.set_keyring(connect.WinVaultKeyring())
        token = connect.keyring.get_password(service, "token")
        if not token:
            raise SessionError("The saved Windows PC pairing is unavailable.")
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "YMFX" / hashlib.sha256(
            (STAGING_URL + token).encode()).hexdigest()[:20] / "capture.db"

    def _selected_copy_target(self):
        session = self._selected()
        linked = self.account_by_slot.get(session["terminal"])
        if not linked or not linked.get("link"):
            raise SessionError("Choose a connected receiving account first.")
        return session["terminal"], str(linked["link"])

    def _copy_account_identity(self, link):
        path = self._copy_database_path()
        if not path.is_file():
            raise SessionError("The MT5 capture database is not yet initialized.")
        with sqlite3.connect(path, timeout=20) as db:
            row=db.execute("SELECT login,server FROM links WHERE link=?", (link,)).fetchone()
        if not row or not str(row[0]).isdecimal() or not row[1]:
            raise SessionError("This MT5 account has no verified broker login and server.")
        return str(row[0]),str(row[1])

    def _copy_consent_worker(self, slot, link, allow, mode="demo"):
        try:
            filename = self._copy_database_path()
            if not filename.is_file():
                raise SessionError("The MT5 capture database is not yet initialized.")
            with sqlite3.connect(filename, timeout=20) as db:
                db.execute("PRAGMA busy_timeout=20000")
                prepare_copy_database(db)
                row=db.execute("SELECT login,server FROM links WHERE link=?", (link,)).fetchone()
                if allow and (not row or not str(row[0]).isdecimal() or not row[1]):
                    raise SessionError("Verified broker account login is unavailable.")
                update_copy_consent(db, link, allow, mode=mode,
                                    login=row[0] if row else None,
                                    server=row[1] if row else None)
            self.events.put({"state":"copy-consent-updated","slot":slot,"enabled":allow,"mode":mode})
        except Exception:
            self.events.put({"state":"copy-consent-error","slot":slot})

    def authorize_selected_demo_copy(self):
        try:
            slot, link = self._selected_copy_target()
        except (SessionError, StopIteration) as error:
            messagebox.showwarning("Copying permission", trader_message(error), parent=self.root)
            return
        if not messagebox.askyesno("Allow this account to copy demo trades?",
            "This lets the selected demo account receive copied orders after you "
            "separately switch on its fleet on the website. Demo money is simulated. "
            "Orders can still fail or fill at a different price. "
            "Your other accounts remain unaffected. Continue?", parent=self.root):
            return
        answer = simpledialog.askstring("Confirm demo copying",
            "To approve this demo account on your computer, type DEMO:",
            parent=self.root)
        if answer != "DEMO":
            self.banner_var.set("Demo copying remains off for this account.")
            return
        self.banner_var.set("Saving demo copying permission for this account…")
        threading.Thread(target=self._copy_consent_worker,args=(slot,link,True,"demo"),
                         daemon=True,name="YMFX-demo-consent").start()

    def authorize_selected_live_copy(self):
        try:
            slot, link = self._selected_copy_target()
            login, server = self._copy_account_identity(link)
        except (SessionError, StopIteration) as error:
            messagebox.showwarning("Live copying", trader_message(error), parent=self.root)
            return
        if not messagebox.askyesno("REAL MONEY — authorize selected MT5 account",
            "You are granting permission for this exact MT5 account to receive REAL broker "
            "orders when its LIVE fleet is separately armed on the website. "
            "Market orders, pending orders, SL/TP changes and closes may place real money "
            "at risk. Broker prices can slip, gaps can exceed stop loss, and an emergency "
            "pause cannot recall orders already sent. No other MT5 account is authorized.\n\n"
            + "Login: " + login + "\nServer: " + server + "\n\n"
            + "Only continue if you own/control this account and your broker allows copying.",
            parent=self.root):
            return
        phrase="LIVE "+login
        answer=simpledialog.askstring("Confirm REAL MONEY authorization",
            "Type "+phrase+" to authorize this specific account for live trade copying:",
            parent=self.root)
        if answer!=phrase:
            self.banner_var.set("Live copying remains off for this account.")
            return
        self.banner_var.set("Saving your live copying permission for this account…")
        threading.Thread(target=self._copy_consent_worker,args=(slot,link,True,"live"),
                         daemon=True,name="YMFX-live-consent").start()

    def disable_selected_demo_copy(self):
        try:
            slot, link = self._selected_copy_target()
        except (SessionError, StopIteration) as error:
            messagebox.showwarning("Copying permission", trader_message(error), parent=self.root)
            return
        # Revocation is always available; no confirmation needed to halt new work.
        self.banner_var.set("Turning off trade copying for this account…")
        threading.Thread(target=self._copy_consent_worker,args=(slot,link,False),
                         daemon=True,name="YMFX-demo-disable").start()

    def inspect_selected_account(self):
        try:
            slot, link = self._selected_copy_target()
            session = self._selected()
        except (SessionError, StopIteration) as error:
            messagebox.showwarning("Account details", trader_message(error), parent=self.root)
            return
        account = self.account_by_slot.get(slot,{})
        def read():
            try:
                path = self._copy_database_path()
                with sqlite3.connect(path, timeout=20) as db:
                    db.execute("PRAGMA busy_timeout=20000")
                    prepare_copy_database(db)
                    local = db.execute("""SELECT observed_at_ms,account_balance,account_equity,margin_free,
                        open_positions,pending_orders,source_active,last_execution_result
                        FROM copy_local_health WHERE link=?""",(link,)).fetchone()
                    allowed = db.execute("SELECT approved,mode FROM copy_local_permissions WHERE link=?",
                        (link,)).fetchone()
                    queued = db.execute("SELECT COUNT(*) FROM outbox WHERE link=?",(link,)).fetchone()[0]
                    unresolved = db.execute("SELECT COUNT(*) FROM position_recovery WHERE link=? AND status!='broker_closure_verified'",
                        (link,)).fetchone()[0]
                    recent = db.execute("SELECT COUNT(*) FROM copy_local_tasks WHERE link=? AND status IN ('reserved','ack_pending')",
                        (link,)).fetchone()[0]
                self.events.put({"state":"copy-account-details","slot":slot,
                    "name":session["name"],"broker":str(account.get("server","Unknown")),
                    "login":str(account.get("login","Unknown")),"local":local,
                    "allowed":bool(allowed and allowed[0]),"copy_mode":allowed[1] if allowed and allowed[0] else "none","queued":queued,
                    "unresolved":unresolved,"unacknowledged":recent})
            except Exception:
                self.events.put({"state":"copy-account-details-error"})
        threading.Thread(target=read,daemon=True,name="YMFX-account-insights").start()
        self.banner_var.set("Reading this account's local capture and execution state…")

    def _show_copy_account_details(self, item):
        window = tk.Toplevel(self.root)
        window.title("Account insights  /  " + str(item.get("name","MT5"))[:55])
        window.configure(bg=BACKGROUND)
        window.geometry("600x520")
        window.minsize(480,400)
        frame = tk.Frame(window,bg=BACKGROUND,padx=24,pady=22)
        frame.pack(fill="both",expand=True)
        self._label(frame,"YOUR BROKER ACCOUNT",size=9,bold=True,
                    color=ACCENT).pack(anchor="w")
        self._label(frame,str(item.get("name","Account")),size=20,bold=True).pack(anchor="w",pady=(8,5))
        self._label(frame,str(item.get("broker",""))+" · "+str(item.get("login","")),
                    size=11,color=MUTED).pack(anchor="w",pady=(0,17))
        health=item.get("local")
        rows=[
            ("Broker connection", "Latest recorded account scan" if health else "Not observed yet"),
            ("Last local observation", dt.datetime.fromtimestamp(health[0]/1000,dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC") if health else "Awaiting MT5 capture"),
            ("Account balance", f"{health[1]:,.2f}" if health else "—"),
            ("Account equity", f"{health[2]:,.2f}" if health else "—"),
            ("Free margin", f"{health[3]:,.2f}" if health else "—"),
            ("Open positions", str(health[4]) if health else "—"),
            ("Pending orders", str(health[5]) if health else "—"),
            ("Main account for copying", "Observed for an armed fleet" if health and health[6] else "Not acting as source"),
            ("Trade copying on this computer", (str(item.get("copy_mode","none")).upper()+" · Allowed") if item.get("allowed") else "Not allowed"),
            ("Trades waiting to update", str(item.get("queued",0))),
            ("Trades awaiting final broker confirmation", str(item.get("unresolved",0))),
            ("Copy orders awaiting confirmation", str(item.get("unacknowledged",0))),
            ("Last copy result", str(health[7]) if health and health[7] else "No copied orders yet"),
        ]
        for label,value in rows:
            line=tk.Frame(frame,bg=BACKGROUND)
            line.pack(fill="x",pady=3)
            self._label(line,label,size=10,color=MUTED).pack(side="left",anchor="w")
            self._label(line,value,size=10,bold=True,wrap=330).pack(side="right",anchor="e")
        self._button(frame,"Close details",window.destroy,quiet=True).pack(anchor="e",pady=(18,0))

    def _session_state(self, s):
        slot = s["terminal"]
        if not Path(slot).is_file():
            return "Terminal missing"
        if self.account_by_slot.get(slot, {}).get("link") in self.remote_paused:
            return "Paused on dashboard"
        if not s["enabled"]:
            return "Paused on this PC"
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
        mapping={}
        for session in entries:
            info=self.account_by_slot.get(session["terminal"])
            if info and info.get("link"):
                label=(session["name"]+"  ·  "+str(info.get("server") or "Broker")+
                       "  /  "+str(info.get("login") or "Account"))
                mapping[label]=session["id"]
        self.copy_choice_map=mapping
        self.copy_account_combo.configure(values=list(mapping))
        if mapping:
            self.copy_add_account_button.pack_forget()
        elif not self.copy_add_account_button.winfo_manager():
            self.copy_add_account_button.pack(anchor="w",pady=(13,0))
        if self.copy_account_choice.get() not in mapping:
            self.copy_account_choice.set(next(iter(mapping), ""))
        self.account_total_var.set(str(len(mapping)))
        self.account_active_var.set(str(sum(
            1 for session in entries if
            session["terminal"] in self.account_by_slot and session["enabled"] and
            self.status_by_slot.get(session["terminal"]) in ("Synced","Capturing")
        )))
        self.account_attention_var.set(str(sum(
            1 for session in entries if
            session["terminal"] in self.account_by_slot and
            (not session["enabled"] or self._session_state(session) in (
                "Needs reconnection","Needs re-link","Terminal missing","Paused on dashboard"))
        )))
        self._selected_session_details()
        self._render_account_cards()

    def _safe_change(self, action):
        try:
            action()
            self.refresh_sessions()
        except (SessionError, OSError, ValueError, StopIteration) as error:
            self._log("This account needs attention: " + str(error))
            messagebox.showwarning("Account needs attention", trader_message(error))

    def _copy_named_terminal(self, source, name):
        if self.copy_worker and self.copy_worker.is_alive():
            messagebox.showinfo("Terminal installation", "Another terminal is being created. Complete it first.")
            return
        self.copy_cancel.clear()
        self.banner_var.set("Creating clean portable terminal • starting file copy…")
        self.status_var.set("Creating terminal…")
        self._log("Creating a separate MT5 installation. Broker credentials and EAs are excluded.")
        self.show_page("sessions")

        def work():
            try:
                terminal = create_terminal(
                    source, ROOT.parent / "terminals", name,
                    cancel=self.copy_cancel,
                    progress=lambda info: self.events.put({
                        "state": "copy-progress", "files": info["files"],
                        "bytes": info["bytes"]})
                )
                self.events.put({"state": "copy-finished",
                                 "terminal": str(terminal), "name": name})
            except (TerminalCopyError, OSError) as error:
                self.events.put({"state": "copy-error",
                                 "message": str(error)[:180]})
            except BaseException as error:
                self.events.put({"state": "copy-error",
                                 "message": "Could not create terminal (" +
                                 type(error).__name__ + ")."})
        self.copy_worker = threading.Thread(target=work, name="YMFX-terminal-copy",
                                            daemon=False)
        self.copy_worker.start()
        self._set_busy_feedback(True)

    def create_named_terminal(self):
        candidates = terminal_candidates()
        initial = str(Path(candidates[0]).parent) if candidates else str(Path.home())
        source = filedialog.askopenfilename(
            title="Select an existing MT5 installation to create a clean copy",
            initialdir=initial,
            filetypes=[("MetaTrader terminal", "terminal64.exe"), ("Executable", "*.exe")])
        if not source:
            return
        name = simpledialog.askstring(
            "Name your new terminal", "New terminal name (e.g. Exness Demo 2):",
            initialvalue=f"MT5 Demo {len(self.store.snapshot()) + 1}", parent=self.root)
        if name is not None:
            self._copy_named_terminal(source, name)

    def duplicate_selected(self):
        try:
            item = self._selected()
        except (SessionError, StopIteration):
            messagebox.showwarning("Duplicate MT5", "Select a source terminal from the sessions table.")
            return
        if not messagebox.askyesno(
                "Duplicate installed MT5?",
                "Create a new isolated copy of this terminal's program files? "
                "The new copy will NOT inherit broker logins, account databases, EAs, "
                "charts or trading history. You must link the new account separately."):
            return
        name = simpledialog.askstring(
            "Name duplicated terminal", "New terminal name:",
            initialvalue=item["name"] + " Copy", parent=self.root)
        if name is not None:
            self._copy_named_terminal(item["terminal"], name)

    def launch_selected(self):
        def launch():
            path = Path(self._selected()["terminal"])
            if not path.is_file():
                raise SessionError("This MT5 terminal no longer exists.")
            # No shell and no account credentials in process arguments.
            subprocess.Popen([str(path), "/portable"], cwd=str(path.parent),
                             close_fds=True)
            self._log("Opened a dedicated MT5 terminal in portable mode.")
        self._safe_change(launch)

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
            if self._worker_busy() and self.worker_mode != "capture":
                raise SessionError("Finish pairing this PC before arming a broker session.")
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

    def _queue_monitoring(self, item, paused):
        link = self.account_by_slot.get(item["terminal"])
        if not link:
            return False
        if self.pc_state != "pc-online" or not self._worker_busy():
            raise SessionError("Open the connector and wait for PC online, then try again.")
        self.managed_accounts.controls.put((link["link"], paused))
        self.banner_var.set("Updating account monitoring on your dashboard…")
        return True

    def start_selected(self):
        def start_one():
            if self._worker_busy() and self.worker_mode != "capture":
                raise SessionError("Finish pairing this PC before starting broker capture.")
            item = self._selected()
            if self._queue_monitoring(item, False):
                return
            self.store.set_enabled(item["id"], True)
            if not self._worker_busy():
                self.start()
            self.banner_var.set(item["name"] + " enabled for capture.")
            self._log(item["name"] + " enabled.")
        self._safe_change(start_one)

    def retry_selected(self):
        def retry():
            item = self._selected()
            if not item["enabled"] or item["terminal"] not in self.account_by_slot:
                raise SessionError("Choose an enabled, linked session to retry.")
            if not self._worker_busy():
                self.start()
            self.retry_queue.put(item["terminal"])
            self.banner_var.set("Retry queued for " + item["name"] + ".")
        self._safe_change(retry)

    def pause_selected(self):
        def pause_one():
            item = self._selected()
            if self._queue_monitoring(item, True):
                return
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
        self.restart_due = None
        self.busy_since = time.monotonic()
        self.worker_mode = "pair" if pairing_code is not None else "capture"
        self.status_var.set("Pairing securely…" if self.worker_mode == "pair" else
                            "Starting broker capture…")
        self._set_busy_feedback(True)
        self._validate_code()

        def work():
            try:
                connect.main(args, pairing_code=pairing_code,
                             stop_event=self.stop_event, pause_event=self.pause_event,
                             report=self.events.put, retry_queue=self.retry_queue,
                             all_slots=self.store.all_terminals,
                             active_slots=self.store.active_terminals,
                             armed_slot=self.store.armed_terminal,
                             parallel_capture=pairing_code is None, managed_accounts=self.managed_accounts)
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
        self._validate_code()

    def start(self):
        if self._worker_busy():
            if self.worker_mode == "capture":
                self.pause_event.clear()
                self.status_var.set("Capture running")
                return
            self.banner_var.set("Complete PC pairing before starting capture.")
            return
        if not self.paired:
            self.show_page("pair")
            return
        self.pc_state = "starting"
        self.status_var.set("Connecting this PC…")
        self._start_worker([STAGING_URL, *self.store.all_terminals()])

    def stop(self):
        self.restart_due = None
        self.stop_event.set()
        self.pause_event.clear()
        if self._worker_busy():
            self.status_var.set("Stopping safely…")
            self.banner_var.set("Finishing the current request and preserving the upload queue.")
            self._log("Safe stop requested. Waiting for current broker operation.")
        else:
            self.status_var.set("Monitoring stopped")

    def _log(self, message):
        # Messages are composed from known app text, not user input, tokens or
        # HTTP payloads. Keep at most 250 events in memory and on-screen.
        timestamp = dt.datetime.now().strftime("%H:%M:%S")
        value = "[" + timestamp + "]  " + str(message)[:300]
        self.log_items.append(value)
        self.log_items = self.log_items[-250:]
        if hasattr(self, "activity_text"):
            self.activity_text.configure(state="normal")
            self.activity_text.insert("end",
                timestamp+"   ·   "+trader_message(message)[:300]+"\n")
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
        header = "YoungMoney3 Connector " + VERSION + " • staging • monitoring and optional copying\n"
        text = header + "\n".join(self.log_items)
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.banner_var.set("Safe diagnostic events copied. No pairing code or account password included.")

    def _event(self, item):
        state = item.get("state", "unknown")
        slot = item.get("slot")
        message = trader_message(item.get("message", ""))
        if state == "pc-online":
            self.connection_badge_var.set("● COMPUTER ONLINE")
            self.pc_state = state
            self.device_id = item["device"]
            self.pc_name = item.get("name") or ("PC "+self.device_id[:8])
            previous_setup = self.setup_state
            self.setup_state = item["setup"]
            self.status_var.set("PC online" if self.setup_state == "ready" else "MetaTrader installation needed")
            self.device_var.set(self.pc_name+"  ·  PC "+self.device_id[:8]+
                                "  ·  Paired with this dashboard. Keep this connector open.")
            self.connection_path.show(3 if self.sync_by_slot else 2 if self.account_by_slot else 1)
            self.pair_stage_var.set("PC online. You can now add a broker account.")
            self.banner_var.set("Choose Add account to sign in to your broker." if self.setup_state == "ready"
                                else "Choose Add account to get MetaTrader 5. This PC stays paired.")
            if self.login_requested and (self.setup_state == "ready" or previous_setup != "install"):
                self.add_account()
        elif state == "pc-renamed":
            self.pc_name = item.get("name") or self.pc_name
            if self.pc_name and self.device_id:
                self.device_var.set(self.pc_name+"  ·  PC "+self.device_id[:8]+"  ·  Paired with this dashboard.")
            self.banner_var.set("PC name updated. The dashboard now shows the same name.")
        elif state == "pc-name-error":
            self.banner_var.set("Could not rename this PC. Check your connection, then retry.")
        elif state == "pc-identity-conflict":
            self.pc_state = state
            self.status_var.set("Duplicate PC identity needs attention")
            self.device_var.set("Another active pairing belongs to this installation identity. Review paired PCs on your dashboard.")
            self.banner_var.set("Do not pair this PC again. Unpair an obsolete duplicate from the dashboard; keep the one with your active accounts.")
        elif state == "pc-reconnecting":
            self.pc_state = state
            self.status_var.set("Reconnecting to dashboard")
            self.device_var.set("Your pairing is saved. This PC will retry automatically.")
            self.banner_var.set("Check the PC’s internet connection. Your accounts stay saved.")
        elif state == "pc-service-incompatible":
            self.pc_state = state
            self.status_var.set("Staging server needs an update")
            self.device_var.set("This PC's pairing remains saved. The staging API did not acknowledge connector check-ins.")
            self.banner_var.set("Update the app or dashboard before adding more accounts. Your saved account link is safe.")
            self._log("Connector check-in endpoint is unavailable or returned an incompatible response.")
        elif state == "pc-revoked":
            self.restart_due = None
            self.pc_state, self.paired = state, False
            self.connection_path.show(0)
            self.status_var.set("Pair this PC again")
            self.device_var.set("The dashboard no longer authorizes this PC.")
            self.banner_var.set("Open Pair this PC to reconnect.")
        elif state in ("control-saved", "control-error"):
            self.banner_var.set(message)
            self._log(message)
        elif state == "copy-permission-view":
            try:
                selected_slot,selected_link=self._selected_copy_target()
            except (SessionError, StopIteration):
                selected_slot,selected_link=None,None
            if slot==selected_slot and item.get("link")==selected_link:
                label,advice=permission_summary(bool(item.get("approved")),item.get("mode"),True)
                self.copy_permission_var.set(label)
                self.copy_help_var.set(advice)
                self.copy_route.set_state("approved" if item.get("approved") else "off")
        elif state == "copy-consent-updated":
            self.copy_authorization_by_slot[slot] = bool(item.get("enabled"))
            mode=item.get("mode","demo").upper()
            self.banner_var.set((mode+" copy execution authorized for selected account only.") if item.get("enabled")
                                else "Trade copy execution disabled for selected account.")
            self._log("Copying permission changed for the selected account only.")
            self._selected_session_details()
            self._load_copy_permission()
        elif state == "copy-consent-error":
            self.banner_var.set("We could not save this account's copying permission. Reconnect and try again.")
            self.copy_permission_var.set("Permission could not be saved")
            self.copy_help_var.set("Reconnect this account, then choose Allow trade copying again.")
        elif state == "copy-account-details":
            self._show_copy_account_details(item)
        elif state == "copy-account-details-error":
            self.banner_var.set("Could not read local account insights; the existing journal capture is unchanged.")
        elif state == "monitoring-policy":
            self.remote_paused = set(item["paused"])
        elif state in ("preparing-account", "setup-error"):
            self.focus_setup = state == "preparing-account"
            self.focus_slot = None
            self.connection_path.show(1)
            self.banner_var.set(message)
            self.status_var.set("Setting up MetaTrader" if state == "preparing-account" else "Account setup needs attention")
            self._log(message)
        elif state == "known-links":
            previous_accounts = self.account_by_slot
            previous = set(previous_accounts)
            self.account_by_slot = {
                record["slot"]: record for record in item.get("links", [])
            }
            for terminal, old in previous_accounts.items():
                if old.get("link") != self.account_by_slot.get(terminal, {}).get("link"):
                    self.sync_by_slot.pop(terminal, None)
            for removed in previous - set(self.account_by_slot):
                self.status_by_slot.pop(removed, None)
            if self.store.armed_terminal() in self.account_by_slot:
                self.store.clear_arm()
            if self._links_initialized and previous - set(self.account_by_slot):
                self.banner_var.set("A broker login needs attention. Open its status on the dashboard, then choose Add account to retry.")
                self._log("Broker link removed after staging verification. Existing evidence remains preserved.")
            else:
                self._log("Known broker accounts: " +
                          str(len(self.account_by_slot)) + " link(s).")
            self._links_initialized = True
        elif state == "paired":
            self.pair_ok = True
            self.paired = True
            self.connection_badge_var.set("● PAIRING SAVED")
            self.hero_pc_button.configure(text="Rename this computer")
            self.hero_pc_button.set_tones(PANEL_ALT,"#354450")
            self.resume_after_pair = True
            self.restart_due = None
            self.restart_delay = 0
            self.sync_by_slot.clear()
            self.connection_path.show(1)
            # A new device token has its own broker links and SQLite folder.
            # Do not show the old device's linked accounts after re-pairing.
            self.account_by_slot.clear()
            self.status_by_slot.clear()
            self._links_initialized = False
            self.device_var.set("PC paired successfully  •  ready for account setup")
            self.pair_stage_var.set("Success! Your PC is paired with staging.")
            self.pair_elapsed_var.set("Pairing confirmed by the staging server.")
            self.status_var.set("PC paired successfully")
            self.banner_var.set("Computer connected. Getting your accounts ready.")
            self._log("PC pairing confirmed. No account credentials are stored in the GUI.")
        elif state == "verifying":
            self.focus_slot = slot
            self.status_var.set("Checking broker login")
            self.pair_stage_var.set("Your broker is checking the account details.")
            self.banner_var.set(message)
            self._log(message)
        elif state == "account-linked":
            self.account_by_slot[slot] = item
            self.status_by_slot[slot] = "Waiting for first sync"
            self.connection_path.show(max(2, self.connection_path.level))
            self.status_var.set("Broker verified")
            self.store.clear_arm(slot)
            self.banner_var.set("Your broker account is connected. Your trade history is being updated."
                                if item.get("acknowledged") else
                                "Your broker account is ready. We are finishing the link to your dashboard.")
            self._log("Broker account linked to selected terminal " +
                      str(Path(slot).parent.name) + ".")
        elif state == "arm-consumed":
            self.store.clear_arm(slot)
        elif state == "copy-progress":
            self.status_var.set("Creating terminal…")
            self.banner_var.set(
                "Copying MT5 installation • " + str(item.get("files", 0)) +
                " files copied. Personal broker data is excluded.")
            return
        elif state == "copy-finished":
            self._set_busy_feedback(self._worker_busy())
            try:
                created = self.store.add(item["terminal"], item["name"])
                self.banner_var.set("Terminal created: " + created["name"] +
                                    ". Choose Arm for account, then link it on staging.")
                self.status_var.set("New terminal ready")
                self._log("Clean MT5 terminal created. A new broker login is required.")
                self.show_page("sessions")
                self.session_table.selection_set(created["id"])
                self.session_table.focus(created["id"])
            except (SessionError, OSError) as error:
                self._log("Created terminal needs attention: " + str(error))
                self.banner_var.set("Terminal created but profile could not be added. Use Add existing.")
        elif state == "copy-error":
            self._set_busy_feedback(self._worker_busy())
            self.status_var.set("Terminal creation failed")
            self.banner_var.set(message)
            self._log("Terminal creation failed: " + message)
        elif state == "session-starting":
            self.status_by_slot[slot] = "Starting process"
            self._log("A dedicated MT5 capture process is starting.")
        elif state == "session-worker-exited":
            if slot in self.account_by_slot and self.status_by_slot.get(slot) != "Needs reconnection":
                self.status_by_slot[slot] = "Stopped"
        elif state == "session-unlinked":
            self.sync_by_slot.pop(slot, None)
            self.status_by_slot[slot] = "Needs re-link"
            self.banner_var.set(message)
            self._log("MT5 broker link was not approved or was removed.")
        elif state == "session-synced":
            prior = self.status_by_slot.get(slot)
            if item.get("synced_at"):
                self.sync_by_slot[slot] = (item["synced_at"], item.get("awaiting", 0))
                if not self.focus_setup or self.focus_slot == slot:
                    self.focus_setup = False
                    self.connection_path.show(3)
                    if self.pc_state == "pc-online":
                        self.status_var.set("Monitoring accounts")
            self.status_by_slot[slot] = "Synced" if slot in self.sync_by_slot else "Capturing"
            if prior != self.status_by_slot[slot]:
                self._log("Broker session " + str(Path(slot).parent.name) + " synced successfully.")
        elif state in ("session-error", "account-error"):
            if state == "account-error" and self.focus_slot == slot:
                self.focus_setup = False
                self.status_var.set("Broker login needs attention")
            self.status_by_slot[slot] = "Needs reconnection"
            self.banner_var.set(message)
            self._log("Session attention required: " + message)
        elif state == "error":
            self.status_var.set("Connector error")
            self.pair_stage_var.set(message)
            self.banner_var.set(message)
            self._log("ERROR: " + message)
        elif state == "worker-exit":
            self.active_workers = 0
            self._set_busy_feedback(False)
            if item.get("mode") == "pair":
                if not self.pair_ok and not self.status_var.get().startswith("Connector error"):
                    self.pair_stage_var.set("Pairing did not complete. Generate a new code and retry.")
                elif self.pair_ok:
                    self.status_var.set("PC paired successfully")
            else:
                # Only an unexpected coordinator exit warrants a restart.
                # Intentional stop, close and PC revocation must never relaunch.
                unexpected = (not self.stopping and not self.stop_event.is_set()
                              and self.paired and self.pc_state != "pc-revoked")
                if unexpected:
                    uptime = max(0, time.monotonic() - (self.busy_since or time.monotonic()))
                    self.restart_delay = restart_wait_seconds(self.restart_delay, uptime)
                    self.restart_due = time.monotonic() + self.restart_delay
                    self.pc_state = "restarting"
                    self.status_var.set("Reconnecting automatically")
                    self.banner_var.set("Monitoring stopped unexpectedly. Reconnecting without losing your pairing or queued trades.")
                    self._log("Capture coordinator stopped unexpectedly; a bounded automatic retry is scheduled.")
                else:
                    self.restart_due = None
                    if self.pc_state not in ("pc-revoked", "pc-identity-conflict"):
                        self.pc_state = "stopped"
                        self.status_var.set("Connector stopped")
                    self._log("Monitoring stopped. Pairing and saved accounts retained.")
            self.busy_since = None
        elif state == "running":
            self.active_workers = int(item.get("active_workers", 0))
            if item.get("linked") is not None:
                linked = item["linked"]
                self.queue_var.set(f"{linked} linked  ·  {self.active_workers} monitoring  ·  {item.get('queued', 0)} items waiting to sync"
                                   if linked else "Add your first account to begin.")
            return
        elif state == "retrying":
            self.status_var.set("Retrying connection")
            self.banner_var.set("Broker/network issue. Retrying without losing queued events.")
            if self.last_summary != "retrying":
                self._log("Capture temporarily offline; retry scheduled.")
                self.last_summary = "retrying"
        elif state == "paused":
            self.status_var.set("Monitoring paused")
        self.refresh_sessions()

    def poll(self):
        self._poll_job = None
        try:
            while True:
                item = self.events.get_nowait()
                self._event(item)
        except queue.Empty:
            pass
        if self.worker and not self.worker.is_alive():
            # A finished pairing task does not erase its success or error state.
            self._set_busy_feedback(False)
            self.worker = None
            self.worker_mode = None
            self._validate_code()
        if self.resume_after_pair and self.worker is None and not self.stopping:
            self.resume_after_pair = False
            self.show_page("overview")
            self.start()
        if (self.restart_due is not None and self.worker is None
                and not self.stopping and not self.stop_event.is_set()
                and self.paired and time.monotonic() >= self.restart_due):
            self.restart_due = None
            self.start()
        if self.worker_mode == "pair" and self.busy_since is not None:
            self.pair_elapsed_var.set(
                "Waiting for confirmation  •  " +
                str(int(time.monotonic() - self.busy_since)) + " seconds elapsed")
        if self.stopping:
            if self.worker is None and (not self.copy_worker or not self.copy_worker.is_alive()):
                self.root.destroy()
                return
        self._poll_job = self.root.after(160, self.poll)

    def close(self):
        if self.stopping:
            return
        self.stopping = True
        self.copy_cancel.set()
        self.stop()
        if self.worker is None and (not self.copy_worker or not self.copy_worker.is_alive()):
            self.root.destroy()

def main():
    smoke = len(sys.argv) == 3 and sys.argv[1] == "--startup-smoke"
    parallel_smoke = len(sys.argv) == 3 and sys.argv[1] == "--parallel-smoke"
    if parallel_smoke:
        # No Tk window, MT5 login, network or user settings are touched.
        Path(sys.argv[2]).write_text(json.dumps(run_parallel_smoke()), encoding="utf-8")
        return
    if len(sys.argv) > 1 and not smoke:
        raise ValueError("Expected --startup-smoke REPORT_PATH, --parallel-smoke REPORT_PATH or no arguments")
    try:
        if not smoke:
            ROOT.mkdir(parents=True, exist_ok=True)
        window = tk.Tk()
        if smoke:
            window.withdraw()
        app = ConnectorApp(window, restore=not smoke)
        if smoke:
            # Layout needs a mapped window; full transparency keeps CI startup
            # unobtrusive while exercising the real Windows Tk geometry engine.
            window.attributes("-alpha", 0)
            window.deiconify()
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
                    if not {"overview", "sessions", "copy", "pair", "activity", "help"} <= set(app.pages):
                        raise RuntimeError("New session manager navigation is incomplete")
                    app.code_var.set("a" * 32)
                    if not app._validate_code():
                        raise RuntimeError("Pair code validation did not accept a valid code")
                    app.code_var.set("")
                    if app._validate_code():
                        raise RuntimeError("Pair code validation accepted an empty code")
                    if not app.code_input.bind("<Button-3>"):
                        raise RuntimeError("Right-click pairing context menu is missing")
                    if not app.create_button or not app.duplicate_button:
                        raise RuntimeError("Terminal creation controls are missing")
                    app.motion_var.set(False)
                    responsive_sizes = []
                    for width, height in ((720, 560), (780, 600), (1024, 768), (1440, 900)):
                        window.geometry(f"{width}x{height}")
                        for page, groups in (("overview", [app.quick_setup_actions]),
                                             ("sessions", [app.session_tools]),
                                             ("pair", [app.code_actions])):
                            app.show_page(page)
                            for _ in range(3):
                                window.update_idletasks()
                                app._responsive_layout()
                            for group in groups:
                                edge = group.winfo_rootx() + group.winfo_width()
                                for button in group.buttons:
                                    if button.winfo_width() < button.winfo_reqwidth() or button.winfo_rootx() + button.winfo_width() > edge + 1:
                                        raise RuntimeError("Responsive action label was clipped")
                                    siblings = group.winfo_children()
                                    if siblings.index(button) < siblings.index(button.pack_info()["in"]):
                                        raise RuntimeError("Responsive action covered by row frame")
                        responsive_sizes.append([width, height])
                    if app.worker is not None or SETTINGS.exists():
                        raise RuntimeError("Presentation smoke started capture or wrote settings")
                    for folder, sentinel in (("_tcl_data", "init.tcl"), ("_tk_data", "tk.tcl")):
                        if not (bundle / folder / sentinel).is_file():
                            raise RuntimeError("Bundled Tcl/Tk data missing")
                    Path(sys.argv[2]).write_text(json.dumps({
                        "startup": "ok", "frozen": True, "capture_started": False,
                        "session_manager": len(app.pages) == 6 and bool(app.session_table),
                        "terminal_creation": bool(app.create_button) and bool(app.duplicate_button),
                        "pairing_controls": bool(app.pair_button) and bool(app.code_input),
                        "activity_view": bool(app.activity_text),
                        "responsive_layout": True,
                        "responsive_sizes": responsive_sizes,
                        "motion_controls": bool(app.motion_var is not None),
                        "native_artwork": len(app.header_art) == 6,
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
    # PyInstaller workers must dispatch here instead of opening another GUI.
    multiprocessing.freeze_support()
    main()
