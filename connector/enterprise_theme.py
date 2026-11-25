"""Native visual tokens distilled from YoungMoney3 Connector Enterprise Asset Kit v1.

Presentation only: no broker, execution, settings, credentials, or networking access.
"""
from __future__ import annotations
import tkinter as tk

COLORS = {
    "red": "#C8102E", "red_hover": "#A90F28", "red_pale": "#FFF0F2",
    "red_border": "#E9C6CF", "ink": "#17191D", "black": "#111215",
    "nav": "#18191D", "nav_hover": "#2A2C32", "text": "#1B1C20",
    "muted": "#62666F", "subtle": "#92959C", "line": "#E1E3E6",
    "surface": "#FFFFFF", "canvas": "#F6F7F8", "surface_alt": "#F0F1F3",
    "disabled": "#B4B6BC", "focus": "#AC1E36",
    "on_dark": "#FFFFFF", "muted_dark": "#ABB0B8",
}
SPACING = (4, 8, 12, 16, 20, 24, 32, 40, 48, 64)


def label_color(surface: str, requested: str) -> str:
    """Maintain high-contrast labels on the dark nav and connection hero."""
    if surface.lower() in (COLORS["nav"].lower(), COLORS["ink"].lower()):
        if requested.lower() == COLORS["text"].lower():
            return COLORS["on_dark"]
        if requested.lower() == COLORS["muted"].lower():
            return COLORS["muted_dark"]
        if requested.lower() == COLORS["red"].lower():
            return "#FF7280"
    return requested


def contrast_ratio(foreground: str, background: str) -> float:
    def luminance(value):
        channels = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
                  for c in channels]
        return sum(a * b for a, b in zip(linear, (.2126, .7152, .0722)))
    a, b = luminance(foreground), luminance(background)
    return (max(a, b) + .05) / (min(a, b) + .05)


class EnterpriseHeroArt(tk.Canvas):
    """Lightweight Tk rendition of the asset-kit operations arc, decoration only."""
    def __init__(self, parent, *, background=COLORS["ink"]):
        super().__init__(parent, bg=background, width=168, height=110,
                         highlightthickness=0, borderwidth=0, takefocus=False)
        self.bind("<Configure>", self.redraw, add="+")
        self.redraw()

    def redraw(self, _event=None):
        self.delete("all")
        w, h = max(100, self.winfo_width()), max(90, self.winfo_height())
        self.create_polygon(0, h, w*.34, h*.86, w*.70, h*.45, w, h*.10, w, h,
                            fill="#25262C", outline="", smooth=True)
        self.create_polygon(w*.16, h, w*.52, h*.83, w*.83, h*.45, w, h*.32,
                            w, h, fill="#302D32", outline="", smooth=True)
        self.create_line(w*.08, h*.95, w*.42, h*.84, w*.72, h*.44, w, h*.27,
                         fill="#EC2946", width=2.5, smooth=True)
        self.create_line(w*.04, h*.98, w*.43, h*.87, w*.78, h*.52, w, h*.23,
                         fill="#6B6168", width=1, smooth=True)
