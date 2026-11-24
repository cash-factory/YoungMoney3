"""Trader-first presentation elements. UI only: no broker, network or credentials."""
from __future__ import annotations

import tkinter as tk


def permission_summary(approved, mode, account_ready=True):
    """Describe permissions without implying that a broker order was placed."""
    if not account_ready:
        return "Choose a connected account", "Add or reconnect the broker account first."
    if not approved or mode not in ("demo", "live"):
        return "Copying is not allowed yet", (
            "Select this account and allow trade copying on this computer. "
            "The website cannot approve it for you."
        )
    if mode == "live":
        return "Live permission saved on this PC", (
            "This only approves this account. Live-money copying on the website "
            "is still switched off until separately released."
        )
    return "Demo permission saved on this PC", (
        "Keep this account connected, then refresh Copy Fleet on the website. "
        "The website must confirm the permission before copying can start."
    )


def trader_message(message):
    """Translate common failure categories, retaining technical details in support logs."""
    text = str(message or "")
    if "(-10005)" in text or "IPC timeout" in text or "terminal_ipc_timeout" in text:
        return "MetaTrader is taking too long to respond. We will retry; your saved trades are safe."
    if "wrong_terminal" in text:
        return "The wrong MetaTrader account opened. Check the selected account and reconnect."
    if "broker_login_timeout" in text:
        return "Your broker did not respond in time. Check the connection and try again."
    if "Capture API HTTP" in text or "Broker capture error" in text:
        return "We couldn't read the latest trade information. We'll retry without deleting saved history."
    if "local_demo_execution_not_consented" in text or "account_bound_execution_permission_missing" in text:
        return "This account has not been approved for trade copying on this computer."
    return text


class TradeJourney(tk.Canvas):
    """Quiet, state-driven trade-route illustration; motion stops after each change."""
    LABELS = ("Your trade", "Safety checks", "Receiving account")
    def __init__(self, parent, *, background="#131b24", accent="#ff536d",
                 motion=lambda: True, **kwargs):
        super().__init__(parent, height=132, bg=background, highlightthickness=0,
                         takefocus=False, **kwargs)
        self.accent = accent
        self.motion = motion
        self.state = "off"
        self._progress = 0.0
        self._job = None
        self.bind("<Configure>", lambda _event: self.draw(), add="+")
        self.bind("<Destroy>", self._cancel, add="+")
        self.draw()

    def _cancel(self, _event=None):
        if self._job is not None:
            self.after_cancel(self._job)
            self._job = None

    def set_state(self, state):
        if state not in ("off", "approved", "active"):
            state = "off"
        if state == self.state:
            return
        self._cancel()
        self.state = state
        if state == "off" or not self.motion():
            self._progress = 1.0
            self.draw()
            return
        self._progress = 0.0
        def advance(i=1):
            self._job = None
            self._progress = 1 - (1-i/14)**3
            self.draw()
            if i < 14:
                self._job = self.after(18, advance, i+1)
        advance()

    def draw(self):
        self.delete("all")
        width = max(380, self.winfo_width())
        xs = (65, width/2, width-95)
        center_y = 45
        line = "#465663"
        muted = "#c1cbd3"
        good = "#79d7b5"
        self.create_line(xs[0],center_y,xs[-1],center_y,fill=line,width=2)
        if self.state in ("approved","active"):
            self.create_line(xs[0],center_y,xs[0]+(xs[-1]-xs[0])*self._progress,center_y,
                             fill=good,width=3)
        for i,(x,label) in enumerate(zip(xs,self.LABELS)):
            done = self.state in ("approved","active") and (
                (self.state=="approved" and i<2) or self.state=="active"
            )
            stroke = good if done else line
            self.create_oval(x-18,center_y-18,x+18,center_y+18,
                             fill="#202d36",outline=stroke,width=2)
            self.create_text(x,center_y,text=str(i+1),fill=good if done else muted,
                             font=("Segoe UI",11,"bold"))
            self.create_text(x,center_y+37,text=label,fill=muted,
                             font=("Segoe UI",10))
        status = ("Approval still needed" if self.state=="off" else
                  "This PC has approved the account" if self.state=="approved" else
                  "Following changes after the account is armed")
        self.create_text(width/2,112,text=status,fill=good if self.state!="off" else muted,
                         font=("Segoe UI",9))
