"""Small native Tk presentation primitives; no network, broker or settings access."""
from __future__ import annotations

import sys
import tkinter as tk


def windows_motion_enabled():
    """Respect Windows' client-area animation preference when it is available."""
    if sys.platform == "win32":
        try:
            import ctypes
            enabled = ctypes.c_int(1)
            if ctypes.windll.user32.SystemParametersInfoW(0x1042, 0, ctypes.byref(enabled), 0):
                return bool(enabled.value)
        except (AttributeError, OSError):
            pass
    return True


def restart_wait_seconds(previous_delay, running_seconds):
    """Bound unexpected service-exit retries without rapid relaunch loops."""
    if previous_delay <= 0 or running_seconds >= 90:
        return 3
    return min(60, previous_delay * 2)


def blend(start, end, amount):
    amount = max(0.0, min(1.0, amount))
    a = [int(start[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(end[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * amount):02x}" for x, y in zip(a, b))


def action_rows(width, requested, gap=8, minimum=132):
    """Fit complete button labels, wrapping before a button would be truncated."""
    rows, row, used = [], [], 0
    for index, requested_width in enumerate(requested):
        needed = max(minimum, requested_width)
        if row and used + gap + needed > max(1, width):
            rows.append(row)
            row, used = [], 0
        row.append(index)
        used += (gap if len(row) > 1 else 0) + needed
    if row:
        rows.append(row)
    return rows


class AnimatedButton(tk.Button):
    """Accessible native button with short color transitions, never moving hit targets."""
    def __init__(self, parent, *, motion=lambda: True, **kwargs):
        super().__init__(parent, **kwargs)
        self._motion = motion
        self._base = kwargs["bg"]
        self._hover = kwargs.get("activebackground", self._base)
        self._job = None
        self.bind("<Enter>", lambda _e: self._transition(self._hover), add="+")
        self.bind("<Leave>", lambda _e: self._transition(self._base), add="+")
        self.bind("<ButtonPress-1>", lambda _e: self._transition(blend(self._hover, "#ffffff", .13)), add="+")
        self.bind("<ButtonRelease-1>", lambda _e: self._transition(self._hover), add="+")
        self.bind("<Destroy>", self._cleanup, add="+")

    def _cleanup(self, _event=None):
        if self._job is not None:
            self.after_cancel(self._job)
            self._job = None

    def set_tones(self, background, hover=None):
        self._cleanup()
        self._base = background
        if hover is not None:
            self._hover = hover
        self.configure(bg=background, highlightbackground=background)

    def _transition(self, target):
        self._cleanup()
        if str(self.cget("state")) == "disabled":
            self.configure(bg=self._base)
            return
        start = self.cget("bg")
        if not self._motion():
            self.configure(bg=target, highlightbackground=target)
            return
        def tick(step=1):
            self._job = None
            if not self.winfo_exists():
                return
            color = blend(start, target, 1 - (1 - step / 7) ** 2)
            self.configure(bg=color, highlightbackground=color)
            if step < 7:
                self._job = self.after(16, tick, step + 1)
        tick()


class ResponsiveActions(tk.Frame):
    """Stable grid-based toolbar that wraps to measured space, without
    creating or destroying containers whenever Windows recalculates its layout.
    A responsive action must never move repeatedly or become unclickable.
    """
    def __init__(self, parent, *, gap=8, minimum=132, **kwargs):
        super().__init__(parent, **kwargs)
        self.buttons = []
        self.rows = []
        self.gap = gap
        self.minimum = minimum
        self._job = None
        self._signature = None
        self._last_width = None
        # A toolbar must not resize its parent as it changes row count.
        # The surrounding card sets the available width, and this toolbar
        # explicitly reserves enough height for the selected number of rows.
        self.grid_propagate(False)
        self.configure(height=50)
        self.bind("<Configure>", self._queue_layout, add="+")
        self.bind("<Destroy>", self._cleanup, add="+")

    def add(self, button):
        self.buttons.append(button)
        self._queue_layout()
        return button

    def _cleanup(self, event=None):
        if event is not None and event.widget is not self:
            return
        if self._job is not None:
            self.after_cancel(self._job)
            self._job = None

    def _queue_layout(self, event=None):
        if event is not None and event.widget is not self:
            return
        if not self.winfo_ismapped():
            return
        if event is not None and event.width == self._last_width:
            return
        if event is not None:
            self._last_width = event.width
        if self._job is not None:
            return
        self._job = self.after_idle(self.reflow)

    def reflow(self):
        self._job = None
        if not self.winfo_exists() or not self.buttons:
            return
        # Buttons are children of this frame. Keep them in place and switch
        # only their grid slots; never rebuild containing row frames.
        width = self.winfo_width()
        if width <= 1:
            width = max(self.minimum, self.master.winfo_width() - 40)
        requested = [button.winfo_reqwidth() for button in self.buttons]
        rows = action_rows(width, requested, self.gap, self.minimum)
        signature = (tuple(tuple(r) for r in rows), tuple(requested))
        if signature == self._signature:
            return
        self._signature = signature
        row_height=max(button.winfo_reqheight() for button in self.buttons)
        target_height=len(rows)*(row_height+self.gap)
        if self.winfo_height()!=target_height and int(self.cget("height"))!=target_height:
            self.configure(height=target_height)
        for button in self.buttons:
            button.grid_forget()
        # Clear unused weights from any previous row layout.
        for col in range(max(len(self.buttons), max(map(len,self.rows),default=0))):
            self.grid_columnconfigure(col,weight=0,minsize=0)
        for r, indices in enumerate(rows):
            for col, index in enumerate(indices):
                self.grid_columnconfigure(col,weight=1,uniform="")
                self.buttons[index].grid(row=r,column=col,sticky="ew",
                    padx=(0,self.gap if col<len(indices)-1 else 0),
                    pady=(0,self.gap))
        self.rows = rows


class StudioArt(tk.Canvas):
    """Scalable, text-free native artwork with a short page-entry signal reveal."""
    def __init__(self, parent, variant, *, background, accent, motion=lambda: True):
        super().__init__(parent, width=190, height=104, bg=background,
                         highlightthickness=0, borderwidth=0, takefocus=False)
        self.variant, self.accent, self.motion = variant, accent, motion
        self._job = None
        self._progress = 1
        self.bind("<Configure>", lambda _e: self.draw(), add="+")
        self.bind("<Destroy>", self._cleanup, add="+")
        self.draw()

    def _cleanup(self, _event=None):
        if self._job is not None:
            self.after_cancel(self._job)
            self._job = None

    def reveal(self):
        """Keep the illustration stable. Only real connection stages animate."""
        self._cleanup()
        self._progress = 1
        self.draw()

    def draw(self):
        self.delete("all")
        background = self.cget("bg")
        dim = blend(background, self.accent, .22)
        soft = blend(background, "#19283E", .27)
        bright = blend(self.accent, "#FFFFFF", .15)
        if self.variant == "Your trading accounts":
            # Quiet product-style composition: a Windows terminal, isolated
            # accounts and verified journal evidence. No loop or decorative
            # motion; connection animation is reserved for actual state changes.
            edge = blend(background, "#19283E", .22)
            slate = blend(background, "#19283E", .055)
            screen = blend(background, "#4357D6", .045)
            success = "#218A73"
            self.create_rectangle(17, 20, 101, 79, fill=slate, outline=edge,
                                  width=1)
            self.create_rectangle(22, 25, 96, 70, fill=screen, outline=edge,
                                  width=1)
            self.create_line(43, 83, 76, 83, fill=edge, width=2)
            self.create_line(53, 79, 53, 83, fill=edge, width=2)
            self.create_line(69, 79, 69, 83, fill=edge, width=2)
            # A compact candlestick/chart reference within the terminal.
            self.create_line(32, 60, 44, 50, 57, 54, 69, 38, 86, 30,
                             fill=self.accent, width=2.5, smooth=True)
            for x, low, high in ((38, 51, 62), (55, 42, 57), (73, 30, 47)):
                self.create_line(x, low, x, high, fill=edge, width=1)
            # Native connection path to three independent captured accounts.
            self.create_line(105, 49, 128, 49, fill=edge, width=2)
            self.create_line(128, 27, 128, 70, fill=edge, width=2)
            for y in (27, 49, 70):
                self.create_line(128, y, 143, y, fill=edge, width=2)
                self.create_rectangle(145, y - 10, 173, y + 10,
                                      fill=slate, outline=edge, width=1)
                self.create_line(151, y - 2, 156, y + 2, 165, y - 5,
                                 fill=success, width=1.9)
            return
        # Compact enterprise vector scene instead of an animated zig-zag.
        # The art carries structure; actual connection progress is shown
        # separately by ConnectionPath only after server acknowledgements.
        border = blend(background, "#19283E", .23)
        field = blend(background, "#4357D6", .048)
        dark = blend(background, "#19283E", .035)
        self.create_rectangle(13, 12, 183, 94, fill=dark, outline=border, width=1)
        self.create_rectangle(18, 17, 178, 88, fill=field, outline="")
        self.create_line(18, 36, 178, 36, fill=border, width=1)
        for cx in (29, 37, 45):
            self.create_oval(cx - 2, 25, cx + 2, 29,
                             fill=self.accent if cx == 29 else soft, outline="")
        if self.variant == "Trade copying":
            # One clear source → three receiving accounts. No pulsing lights
            # that would suggest trades are executing when they are not.
            self.create_rectangle(24,44,65,75,fill=background,outline=bright,width=2)
            for cx,cy,price in ((33,60,53),(42,55,49),(51,52,44)):
                self.create_line(cx,cy,cx,price,fill=self.accent,width=2)
            self.create_line(65,59,104,59,fill=border,width=2)
            self.create_line(104,39,104,80,fill=border,width=2)
            for index,y in enumerate((39,59,79)):
                self.create_line(104,y,128,y,fill=border,width=2)
                self.create_rectangle(132,y-9,166,y+9,fill=background,outline=border,width=1)
                self.create_oval(138,y-3,143,y+2,fill="#218A73",outline="")
                self.create_line(149,y,159,y,fill=soft,width=2)
        elif self.variant == "My accounts":
            for i in range(3):
                x, y = 30, 44 + i * 13
                self.create_rectangle(x, y, 166, y + 10, fill=background,
                                      outline=border if i == 0 else dim, width=1)
                self.create_oval(x + 5, y + 3, x + 9, y + 7,
                                 fill="#218A73" if i != 2 else self.accent, outline="")
                self.create_line(x + 17, y + 5, x + 83, y + 5, fill=soft, width=2)
                self.create_line(x + 103, y + 5, x + 125, y + 5,
                                 fill=self.accent, width=2)
        elif self.variant == "Connect this computer":
            self.create_rectangle(29, 46, 86, 76, outline=bright, fill=background, width=2)
            self.create_line(50, 80, 66, 80, fill=soft, width=2)
            self.create_line(57, 76, 57, 80, fill=soft, width=2)
            self.create_line(87, 61, 122, 61, fill=border, width=2)
            self.create_rectangle(127, 50, 162, 72, outline=border, fill=background)
            self.create_line(134, 61, 140, 66, 151, 55,
                             fill="#218A73", width=2.5)
        elif self.variant == "Help when you need it":
            for i in range(3):
                y = 46 + i * 12
                self.create_oval(28, y, 35, y + 7, outline="",
                                 fill="#218A73" if i == 0 else soft)
                self.create_line(43, y + 4, 114 + i * 12, y + 4,
                                 fill=bright if i == 0 else border, width=2)
                self.create_line(143, y + 4, 161, y + 4,
                                 fill=self.accent if i == 2 else soft, width=2)
        else:
            # Diagnostic timeline with distinct receipts, not flashing pulses.
            self.create_line(38, 44, 38, 77, fill=border, width=2)
            for i in range(3):
                y = 45 + i * 14
                self.create_oval(34, y - 3, 42, y + 5,
                                 fill="#218A73" if i < 2 else self.accent, outline="")
                self.create_line(52, y + 1, 125 + i * 7, y + 1,
                                 fill=soft if i else bright, width=2)


class ConnectionPath(tk.Canvas):
    """Animate the distance between acknowledged milestones, then come to rest."""
    labels = ("PC paired", "Broker verified", "Journal synced")

    def __init__(self, parent, *, background, motion):
        super().__init__(parent, height=72, highlightthickness=0, bg=background, takefocus=False)
        self.motion = motion
        self.level = 0
        self.position = 0.0
        self._job = None
        self.bind("<Configure>", lambda _: self.draw())
        self.bind("<Destroy>", lambda _: self.cancel())

    def cancel(self):
        if self._job is not None:
            self.after_cancel(self._job)
            self._job = None

    def show(self, level):
        if level == self.level and self.motion():
            return
        self.cancel()
        self.level = level
        start = self.position
        def frame(i):
            self._job = None
            self.position = start + (level - start) * (1 - (1 - i / 14) ** 3)
            self.draw()
            if i < 14:
                self._job = self.after(22, frame, i + 1)
        frame(1 if self.motion() and level > start else 14)

    def draw(self):
        self.delete("all")
        width = max(160, self.winfo_width())
        margin = min(60, width // 6)
        points = (margin, width / 2, width - margin)
        y = 24
        for i in range(2):
            self.create_line(points[i], y, points[i+1], y, fill="#C9D2DF", width=2)
            progress = max(0, min(1, self.position - i - 1))
            if progress:
                self.create_line(points[i], y, points[i] + (points[i+1] - points[i]) * progress,
                                 y, fill="#2E9680", width=3)
        for i, x in enumerate(points):
            done = self.position >= i + .99
            current = i == self.level
            tone = "#218A73" if done else "#4357D6" if current else "#93A0B1"
            self.create_oval(x-8, y-8, x+8, y+8, fill=tone if done else self.cget("bg"), outline=tone, width=2)
            if done:
                self.create_line(x-4,y,x-1,y+3,x+4,y-4,fill="#FFFFFF",width=2)
            elif current:
                self.create_oval(x-2,y-2,x+2,y+2,fill=tone,outline="")
            self.create_text(x, 51, text=self.labels[i], font=("Segoe UI", 9), fill=tone)


def brand_mark(parent, background):
    """The selected Signal Monogram, using the website's exact vector points."""
    canvas = tk.Canvas(parent, width=40, height=40, bg=background,
                       highlightthickness=0, takefocus=False)
    canvas.create_polygon(7, 0, 33, 0, 40, 7, 40, 33, 33, 40, 7, 40, 0, 33, 0, 7,
                          fill="#b51030", outline="", smooth=True, splinesteps=12)
    shapes = [((1, 3), (21, 3), (40, 25), (59, 3), (80, 3), (23, 71), (23, 45)),
              ((27, 71), (54, 39), (65, 50), (85, 24), (104, 24), (104, 72),
               (84, 72), (84, 47), (65, 73), (53, 59), (43, 71))]
    for shape in shapes:
        canvas.create_polygon(*[coordinate for point in shape for coordinate in
                                (5 + point[0] * .285, 8 + point[1] * .285)],
                              fill="#ffffff", outline="")
    return canvas
