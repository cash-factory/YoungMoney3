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
    """A wrapping action row driven by measured Tk button requests and DPI scaling."""
    def __init__(self, parent, *, gap=8, minimum=132, **kwargs):
        super().__init__(parent, **kwargs)
        self.buttons = []
        self.rows = []
        self.gap = gap
        self.minimum = minimum
        self._job = None
        self._row_frames = []
        self._signature = None
        self.bind("<Configure>", self._queue_layout, add="+")
        self.bind("<Destroy>", self._cleanup, add="+")

    def add(self, button):
        self.buttons.append(button)
        self._queue_layout()
        return button

    def _cleanup(self, _event=None):
        if self._job is not None:
            self.after_cancel(self._job)
            self._job = None

    def _queue_layout(self, _event=None):
        self._cleanup()
        self._job = self.after_idle(self.reflow)

    def reflow(self):
        self._job = None
        if not self.winfo_exists() or not self.buttons:
            return
        width = self.winfo_width()
        if width <= 1:
            width = max(self.minimum, self.master.winfo_width() - 44)
        requested = [button.winfo_reqwidth() for button in self.buttons]
        rows = action_rows(width, requested, self.gap, self.minimum)
        signature = (rows, requested)
        if signature == self._signature:
            return
        self._signature = signature
        for button in self.buttons:
            button.pack_forget()
        for frame in self._row_frames:
            frame.destroy()
        self._row_frames = []
        for row in rows:
            frame = tk.Frame(self, bg=self.cget("bg"))
            frame.pack(fill="x")
            self._row_frames.append(frame)
            for position, index in enumerate(row):
                button = self.buttons[index]
                button.pack(in_=frame, side="left", fill="x", expand=True,
                            padx=(0, self.gap if position < len(row) - 1 else 0),
                            pady=(0, self.gap))
                # Buttons belong to this action group while their geometry is
                # managed inside row frames. Keep them above those row windows.
                button.lift()
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
        self._cleanup()
        self._progress = 0 if self.motion() and self.variant != "Account monitor" else 1
        self.draw()
        if self._progress == 1:
            return
        def tick():
            self._job = None
            self._progress = min(1, self._progress + .09)
            self.draw()
            if self._progress < 1:
                self._job = self.after(24, tick)
        tick()

    def draw(self):
        self.delete("all")
        background = self.cget("bg")
        dim = blend(background, self.accent, .22)
        soft = blend(background, "#ffffff", .12)
        bright = blend(self.accent, "#ffffff", .5)
        if self.variant == "Account monitor":
            # Quiet product-style composition: a Windows terminal, isolated
            # accounts and verified journal evidence. No loop or decorative
            # motion; connection animation is reserved for actual state changes.
            edge = blend(background, "#ffffff", .24)
            slate = blend(background, "#ffffff", .08)
            screen = blend(background, "#ffffff", .045)
            success = "#72cda4"
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
        if self.variant == "Account sessions":
            for index in range(3):
                x = 24 + index * 51
                self.create_rectangle(x, 19, x + 37, 84, fill=blend(background, self.accent, .055),
                                      outline=dim if index != 1 else self.accent, width=1)
                self.create_oval(x + 12, 36, x + 25, 49, outline=bright, width=2)
                self.create_line(x + 10, 68, x + 27, 68, fill=self.accent, width=2)
            points = [22, 91, 70, 100, 122, 98, 172, 88]
        elif self.variant == "Connect this PC":
            self.create_arc(72, 15, 122, 70, start=0, extent=180,
                            style="arc", outline=dim, width=4)
            self.create_rectangle(72, 43, 122, 81, fill=self.accent, outline="")
            self.create_oval(93, 54, 102, 63, fill=background, outline="")
            self.create_line(98, 61, 98, 71, fill=background, width=3)
            for x in (25, 159):
                self.create_oval(x, 48, x + 10, 58, fill=bright, outline="")
            points = [36, 53, 58, 53, 66, 60, 72, 53, 123, 53, 139, 53, 150, 53]
        elif self.variant == "Setup & troubleshooting":
            for index in range(4):
                x = 20 + index * 42
                self.create_rectangle(x, 25 - index * 3, x + 31, 84 - index * 3,
                                      fill=blend(background, self.accent, .045), outline=dim)
                self.create_line(x + 7, 45 - index * 3, x + 24, 45 - index * 3,
                                 fill=self.accent, width=2)
                self.create_line(x + 7, 56 - index * 3, x + 20, 56 - index * 3,
                                 fill=soft, width=2)
            points = [20, 97, 62, 93, 104, 89, 146, 85, 178, 81]
        else:
            for index in range(6):
                x = 23 + index * 27
                height = (22, 36, 27, 49, 40, 62)[index]
                self.create_rectangle(x, 89 - height, x + 10, 89,
                                      fill=blend(background, self.accent, .12 + index * .025), outline="")
            points = ([13, 61, 35, 61, 49, 34, 66, 82, 82, 44, 103, 44, 121, 62, 142, 20, 160, 48, 180, 48]
                      if self.variant == "Activity & diagnostics" else
                      [15, 79, 36, 68, 57, 73, 79, 45, 100, 53, 122, 29, 144, 37, 166, 17, 184, 24])
        visible = max(2, round(len(points) / 2 * self._progress)) * 2
        self.create_line(*points[:visible], fill=self.accent, width=2.5, smooth=True)
        self.create_oval(points[visible - 2] - 3, points[visible - 1] - 3,
                         points[visible - 2] + 3, points[visible - 1] + 3,
                         fill=bright, outline="")


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
            self.create_line(points[i], y, points[i+1], y, fill="#544652", width=2)
            progress = max(0, min(1, self.position - i - 1))
            if progress:
                self.create_line(points[i], y, points[i] + (points[i+1] - points[i]) * progress,
                                 y, fill="#a7ddc2", width=3)
        for i, x in enumerate(points):
            done = self.position >= i + .99
            current = i == self.level
            tone = "#a7ddc2" if done else "#f2adbd" if current else "#9e95a1"
            self.create_oval(x-8, y-8, x+8, y+8, fill=tone if done else self.cget("bg"), outline=tone, width=2)
            if done:
                self.create_line(x-4,y,x-1,y+3,x+4,y-4,fill="#19281f",width=2)
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
