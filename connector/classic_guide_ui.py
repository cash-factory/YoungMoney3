"""Interactive, trader-first manual for the classic Tk Windows connector.

This UI changes only the help view and its own local progress record. Navigation
buttons do not authorize copying, pair the PC, or start/stop monitoring.
"""
from __future__ import annotations

import json
import tkinter as tk
from pathlib import Path
from tkinter import ttk

from enterprise_theme import COLORS
from help_guide import GUIDE_TOPICS, available_step_ids, search_faq, topic_for
from studio_ui import blend

BACKGROUND = COLORS["canvas"]
PANEL = COLORS["surface"]
PANEL_ALT = COLORS["surface_alt"]
TEXT = COLORS["text"]
MUTED = COLORS["muted"]
ACCENT = COLORS["red"]
BORDER = COLORS["line"]
HERO = COLORS["ink"]


class ClassicGuidePanel:
    """An isolated, keyboard-accessible help controller for the shipped Tk app."""

    def __init__(self, app, parent, progress_path: Path, copy_studio_url: str):
        self.app = app
        self.parent = parent
        self.progress_path = Path(progress_path)
        self.copy_studio_url = copy_studio_url
        self.topic_id = "connect"
        self.position = 0
        self.open_answer = None
        self.seen = self._load_progress()
        self.color_job = None
        self._build()
        self._render_step()
        self._render_faq()

    def _load_progress(self):
        try:
            saved = json.loads(self.progress_path.read_text(encoding="utf-8"))
            if not isinstance(saved, dict) or saved.get("version") != 1:
                return set()
            steps = saved.get("steps", [])
            if not isinstance(steps, list):
                return set()
            return set(x for x in steps if isinstance(x, str)) & available_step_ids()
        except (OSError, ValueError, TypeError):
            return set()

    def _remember(self):
        key = f"{self.topic_id}:{self.position}"
        if key in self.seen:
            return
        self.seen.add(key)
        try:
            self.progress_path.parent.mkdir(parents=True, exist_ok=True)
            self.progress_path.write_text(
                json.dumps({"version": 1, "steps": sorted(self.seen)}),
                encoding="utf-8",
            )
        except OSError:
            # The guide remains usable if a locked-down workstation forbids storage.
            pass

    def _build(self):
        app = self.app
        hero = tk.Frame(self.parent, bg=HERO, padx=23, pady=22)
        hero.pack(fill="x", pady=(0, 12))
        app._label(hero, "SIGNAL DESK  /  INTERACTIVE FIELD MANUAL",
                   size=9, bold=True, color="#FF9CAF").pack(anchor="w")
        app._label(hero, "Learn the system. Keep control.",
                   size=19, bold=True, color="#FFFFFF").pack(anchor="w", pady=(8, 8))
        app._label(
            hero,
            "Choose a task, follow the steps, and open the real screen when ready. "
            "This manual never changes a broker setting or places an order.",
            size=10, color="#D6D8DE", wrap=790,
        ).pack(anchor="w")
        self.status_var = tk.StringVar()
        app._label(hero, textvar=self.status_var, size=9,
                   color="#D6D8DE", wrap=790).pack(anchor="w", pady=(13, 0))

        progress_card = app._card(self.parent, 17)
        progress_card.pack(fill="x", pady=(0, 12))
        self.progress_var = tk.StringVar()
        app._label(progress_card, textvar=self.progress_var, size=9,
                   bold=True, color=MUTED).pack(anchor="w", pady=(0, 8))
        self.progress = ttk.Progressbar(
            progress_card, style="YM.Horizontal.TProgressbar",
            mode="determinate", maximum=len(available_step_ids()),
        )
        self.progress.pack(fill="x")
        app._label(progress_card, "Learning progress is saved only on this Windows user. "
                   "No login credentials, pairing codes or trade data are stored.",
                   size=9, color=MUTED, wrap=790).pack(anchor="w", pady=(9, 0))

        app._label(self.parent, "CHOOSE YOUR TASK", size=9, bold=True,
                   color=ACCENT).pack(anchor="w", pady=(3, 9))
        topic_grid = tk.Frame(self.parent, bg=BACKGROUND)
        topic_grid.pack(fill="x", pady=(0, 12))
        topic_grid.grid_columnconfigure(0, weight=1, uniform="topics")
        topic_grid.grid_columnconfigure(1, weight=1, uniform="topics")
        self.topic_buttons = {}
        for i, topic in enumerate(GUIDE_TOPICS):
            cell = app._card(topic_grid, 10)
            cell.grid(row=i // 2, column=i % 2, sticky="nsew",
                      padx=(0, 5) if i % 2 == 0 else (5, 0), pady=(0, 9))
            button = app._button(cell, f"0{i + 1}   {topic['title']}",
                                 lambda key=topic["id"]: self.choose_topic(key),
                                 quiet=True)
            button.pack(fill="x")
            self.topic_buttons[topic["id"]] = button
            app._label(cell, topic["subtitle"], size=9,
                       color=MUTED, wrap=310).pack(anchor="w", pady=(8, 3))

        frame = app._card(self.parent, 21)
        frame.pack(fill="x", pady=(0, 12))
        eyebrow = tk.Frame(frame, bg=PANEL)
        eyebrow.pack(fill="x")
        self.topic_label = app._label(eyebrow, size=9, bold=True, color=ACCENT)
        self.topic_label.pack(side="left")
        self.step_label = app._label(eyebrow, size=9, color=MUTED)
        self.step_label.pack(side="right")
        self.title_label = app._label(frame, size=17, bold=True,
                                      color=TEXT, wrap=790)
        self.title_label.pack(anchor="w", pady=(13, 10))
        self.body_label = app._label(frame, size=10, color=TEXT, wrap=790)
        self.body_label.pack(anchor="w")

        tip = tk.Frame(frame, bg=PANEL_ALT, padx=13, pady=12)
        tip.pack(fill="x", pady=(17, 16))
        app._label(tip, "REMEMBER", size=8, bold=True,
                   color=ACCENT).pack(anchor="w")
        self.tip_label = app._label(tip, size=10, color=TEXT, wrap=740)
        self.tip_label.pack(anchor="w", pady=(5, 0))
        self.open_button = app._button(frame, "Open this screen",
                                        self.open_destination, primary=True)
        self.open_button.pack(anchor="w", pady=(0, 13))

        app._label(frame, "JUMP TO A STEP", size=9, bold=True,
                   color=MUTED).pack(anchor="w", pady=(4, 7))
        jump_grid = tk.Frame(frame, bg=PANEL)
        jump_grid.pack(fill="x", pady=(0, 15))
        jump_grid.grid_columnconfigure(0, weight=1, uniform="guide-steps")
        jump_grid.grid_columnconfigure(1, weight=1, uniform="guide-steps")
        self.jump_buttons = []
        for i in range(4):
            button = app._button(jump_grid, f"0{i + 1}", lambda index=i: self.select_step(index),
                                 quiet=True)
            button.grid(row=i // 2, column=i % 2, sticky="ew",
                        padx=(0, 4) if i % 2 == 0 else (4, 0), pady=4)
            self.jump_buttons.append(button)

        control_row = tk.Frame(frame, bg=PANEL)
        control_row.pack(fill="x")
        self.prev_button = app._button(control_row, "←  Previous",
                                       lambda: self.select_step(self.position - 1),
                                       quiet=True)
        self.prev_button.pack(side="left")
        self.next_button = app._button(control_row, "Next step  →",
                                       lambda: self.select_step(self.position + 1),
                                       primary=True)
        self.next_button.pack(side="right")

        faq_card = app._card(self.parent, 19)
        faq_card.pack(fill="x", pady=(0, 14))
        app._label(faq_card, "Quick answers", size=16, bold=True).pack(anchor="w")
        app._label(faq_card, "Search for pairing, copying, recovery or a broker status.",
                   size=9, color=MUTED, wrap=790).pack(anchor="w", pady=(4, 11))
        self.search_var = tk.StringVar()
        self.search_entry = tk.Entry(
            faq_card, textvariable=self.search_var,
            font=("Segoe UI", 10), bg=PANEL, fg=TEXT,
            insertbackground=TEXT, selectbackground=COLORS["red_pale"],
            relief="flat", highlightbackground=BORDER, highlightthickness=2,
            highlightcolor=ACCENT, takefocus=True,
        )
        self.search_entry.pack(fill="x", ipady=10, pady=(0, 12))
        self.search_var.trace_add("write", lambda *_: self._render_faq())
        self.faq_list = tk.Frame(faq_card, bg=PANEL)
        self.faq_list.pack(fill="x")

    def _animate_title(self):
        if self.color_job is not None:
            try:
                self.app.root.after_cancel(self.color_job)
            except (tk.TclError, ValueError):
                pass
            self.color_job = None
        if not self.app.motion_var.get():
            self.title_label.configure(fg=TEXT)
            return

        def frame(index=0):
            if not self.title_label.winfo_exists():
                return
            self.title_label.configure(fg=blend(ACCENT, TEXT, index / 5))
            if index < 5:
                self.color_job = self.app.root.after(36, lambda: frame(index + 1))
            else:
                self.color_job = None

        frame()

    def _render_step(self):
        current = topic_for(self.topic_id)
        self.position = max(0, min(self.position, len(current["steps"]) - 1))
        self._remember()
        title, body, tip, _destination, button_text = current["steps"][self.position]
        self.status_var.set(
            ("PC pairing saved" if self.app.paired else "PC pairing required") +
            "   •   Captured trades must be confirmed separately"
        )
        self.progress_var.set(
            f"{len(self.seen)} of {len(available_step_ids())} guide steps explored"
        )
        self.progress.configure(value=len(self.seen))
        self.topic_label.configure(text=current["title"].upper())
        self.step_label.configure(text=f"STEP {self.position + 1} OF {len(current['steps'])}")
        self.title_label.configure(text=title)
        self.body_label.configure(text=body)
        self.tip_label.configure(text=tip)
        self.open_button.configure(text=button_text)
        self.prev_button.configure(state="normal" if self.position > 0 else "disabled")
        self.next_button.configure(state="normal" if self.position < len(current["steps"]) - 1 else "disabled")
        for topic in GUIDE_TOPICS:
            button = self.topic_buttons[topic["id"]]
            button.set_tones(ACCENT if self.topic_id == topic["id"] else PANEL_ALT,
                             COLORS["red_hover"] if self.topic_id == topic["id"] else "#E9EAED")
            button.configure(fg="#FFFFFF" if self.topic_id == topic["id"] else TEXT)
        for index, button in enumerate(self.jump_buttons):
            jump_title = current["steps"][index][0]
            if len(jump_title) > 23:
                jump_title = jump_title[:22].rstrip() + "…"
            button.configure(text=f"0{index + 1}  {jump_title}",
                             fg=ACCENT if self.position == index else TEXT)
        self._animate_title()

    def choose_topic(self, identifier):
        self.topic_id = topic_for(identifier)["id"]
        self.position = 0
        self._render_step()

    def select_step(self, index):
        current = topic_for(self.topic_id)
        if 0 <= index < len(current["steps"]):
            self.position = index
            self._render_step()

    def open_destination(self):
        """Navigate only. Never invoke account, copy, capture or retry commands."""
        destination = topic_for(self.topic_id)["steps"][self.position][3]
        if destination in {"overview", "sessions", "pair", "activity"}:
            self.app.show_page(destination)
        elif destination == "dashboard":
            self.app.open_dashboard()
        elif destination == "copy-studio":
            import webbrowser
            webbrowser.open(self.copy_studio_url)

    def _render_faq(self):
        if not hasattr(self, "faq_list"):
            return
        for child in self.faq_list.winfo_children():
            child.destroy()
        matches = search_faq(self.search_var.get())
        if not matches:
            self.app._label(
                self.faq_list, "No matching answers. Try a shorter question.",
                color=MUTED, size=10,
            ).pack(anchor="w", pady=12)
            return
        for index, question, answer in matches:
            row = tk.Frame(self.faq_list, bg=PANEL)
            row.pack(fill="x", pady=(0, 3))
            btn = self.app._button(
                row, ("−" if self.open_answer == index else "+") + "  " + question,
                lambda item=index: self.toggle_answer(item), quiet=True,
            )
            btn.pack(fill="x", pady=(0, 2))
            if self.open_answer == index:
                self.app._label(row, answer, size=9, color=MUTED,
                                wrap=750).pack(anchor="w", pady=(6, 13))

    def toggle_answer(self, index):
        self.open_answer = None if self.open_answer == index else index
        self._render_faq()

    def refresh_status(self):
        self.status_var.set(
            ("PC pairing saved" if self.app.paired else "PC pairing required") +
            "   •   Captured trades must be confirmed separately"
        )

    def destroy(self):
        if self.color_job is not None:
            try:
                self.app.root.after_cancel(self.color_job)
            except (tk.TclError, ValueError):
                pass
            self.color_job = None
