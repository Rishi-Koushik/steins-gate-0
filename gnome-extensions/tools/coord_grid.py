#!/usr/bin/env python3
"""Fullscreen coordinate grid for marking the notch, panel and left app-drawer outlines.

Controls
  Left click      add a point to the current shape
  Right click     remove the last point
  Arrow keys      nudge last point by 1px (Shift = 10px)
  Scroll          zoom in/out around the cursor (middle-drag to pan)
  Tab             cycle shape: DRAWER -> NOTCH -> PANEL
  C               clear current shape
  S               save to ~/notch/coords.json (also printed)
  Esc / Q         quit (auto-saves)
"""
import json, os, math
import gi
gi.require_version("Gtk", "4.0")
from gi.repository import Gtk, Gdk, GLib

OUT = os.path.expanduser("~/notch/coords.json")
SHAPES = ["drawer", "notch", "panel"]
COLORS = {"drawer": (0.55, 1.0, 0.45), "notch": (1.0, 0.35, 0.35), "panel": (0.35, 0.75, 1.0)}


class Grid(Gtk.DrawingArea):
    def __init__(self):
        super().__init__()
        self.points = {s: [] for s in SHAPES}
        if os.path.exists(OUT):
            try:
                data = json.load(open(OUT))
                for s in SHAPES:
                    self.points[s] = [tuple(p) for p in data.get(s, [])]
            except Exception:
                pass
        self.cur = "drawer"
        self.mouse = (0, 0)
        self.zoom = 1.0
        self.off = (0.0, 0.0)  # screen = world*zoom + off
        self.pan_start = None
        self.set_draw_func(self.draw)
        self.set_focusable(True)

        m = Gtk.EventControllerMotion()
        m.connect("motion", self.on_motion)
        self.add_controller(m)
        c = Gtk.GestureClick(button=0)
        c.connect("pressed", self.on_click)
        c.connect("released", lambda *a: setattr(self, "pan_start", None))
        self.add_controller(c)
        sc = Gtk.EventControllerScroll(flags=Gtk.EventControllerScrollFlags.VERTICAL)
        sc.connect("scroll", self.on_scroll)
        self.add_controller(sc)
        k = Gtk.EventControllerKey()
        k.connect("key-pressed", self.on_key)
        self.add_controller(k)

    def to_world(self, x, y):
        return ((x - self.off[0]) / self.zoom, (y - self.off[1]) / self.zoom)

    def on_motion(self, _c, x, y):
        if self.pan_start:
            sx, sy, ox, oy = self.pan_start
            self.off = (ox + x - sx, oy + y - sy)
        self.mouse = (x, y)
        self.queue_draw()

    def on_click(self, g, _n, x, y):
        b = g.get_current_button()
        if b == 1:
            wx, wy = self.to_world(x, y)
            self.points[self.cur].append((round(wx), round(wy)))
        elif b == 3 and self.points[self.cur]:
            self.points[self.cur].pop()
        elif b == 2:
            self.pan_start = (x, y, *self.off)
        self.queue_draw()

    def on_scroll(self, _c, _dx, dy):
        mx, my = self.mouse
        wx, wy = self.to_world(mx, my)
        self.zoom = max(1.0, min(16.0, self.zoom * (0.8 if dy > 0 else 1.25)))
        if self.zoom == 1.0:
            self.off = (0.0, 0.0)
        else:
            self.off = (mx - wx * self.zoom, my - wy * self.zoom)
        self.queue_draw()
        return True

    def on_key(self, _c, kv, _code, state):
        name = Gdk.keyval_name(kv)
        step = 10 if state & Gdk.ModifierType.SHIFT_MASK else 1
        pts = self.points[self.cur]
        if name in ("Escape", "q", "Q"):
            self.save(); self.get_root().close()
        elif name == "Tab":
            self.cur = SHAPES[(SHAPES.index(self.cur) + 1) % len(SHAPES)]
        elif name in ("c", "C"):
            pts.clear()
        elif name in ("s", "S"):
            self.save()
        elif pts and name in ("Left", "Right", "Up", "Down"):
            x, y = pts[-1]
            d = {"Left": (-step, 0), "Right": (step, 0), "Up": (0, -step), "Down": (0, step)}[name]
            pts[-1] = (x + d[0], y + d[1])
        self.queue_draw()
        return True

    def save(self):
        w, h = self.get_width(), self.get_height()
        scale = self.get_native().get_surface().get_scale() if self.get_native() else 1
        data = {"logical_screen": [w, h], "scale": scale, **{s: self.points[s] for s in SHAPES}}
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        json.dump(data, open(OUT, "w"), indent=2)
        print(json.dumps(data))
        self.flash = GLib.get_monotonic_time()

    def draw(self, _a, cr, w, h):
        cr.set_source_rgb(0.07, 0.07, 0.09); cr.paint()
        z, (ox, oy) = self.zoom, self.off
        x0, y0 = self.to_world(0, 0); x1, y1 = self.to_world(w, h)

        # pick grid spacing that stays readable at this zoom
        minor = 1 if z >= 8 else 5 if z >= 3 else 10
        for step, alpha, lw in ((minor, 0.10, 1), (50, 0.25, 1), (100, 0.45, 1)):
            cr.set_source_rgba(1, 1, 1, alpha); cr.set_line_width(lw)
            gx = math.floor(x0 / step) * step
            while gx <= x1:
                sx = round(gx * z + ox) + 0.5; cr.move_to(sx, 0); cr.line_to(sx, h); gx += step
            gy = math.floor(y0 / step) * step
            while gy <= y1:
                sy = round(gy * z + oy) + 0.5; cr.move_to(0, sy); cr.line_to(w, sy); gy += step
            cr.stroke()

        # center line (screen middle, where the camera usually is)
        cr.set_source_rgba(1, 0.85, 0.2, 0.7)
        sx = round((w / 2) * z + ox) + 0.5
        cr.move_to(sx, 0); cr.line_to(sx, h); cr.stroke()

        # axis labels every 100 (or 10 when zoomed)
        lab = 10 if z >= 4 else 100
        cr.set_font_size(11); cr.set_source_rgba(1, 1, 1, 0.75)
        gx = math.floor(x0 / lab) * lab
        while gx <= x1:
            cr.move_to(gx * z + ox + 3, 14); cr.show_text(str(int(gx))); gx += lab
        gy = math.floor(y0 / lab) * lab
        while gy <= y1:
            if gy > 0:
                cr.move_to(3, gy * z + oy - 3); cr.show_text(str(int(gy)))
            gy += lab

        # shapes
        for s in SHAPES:
            pts = self.points[s]
            r, g, b = COLORS[s]
            active = s == self.cur
            if len(pts) > 1:
                cr.set_source_rgba(r, g, b, 0.18 if active else 0.08)
                cr.move_to(pts[0][0] * z + ox, pts[0][1] * z + oy)
                for px, py in pts[1:]:
                    cr.line_to(px * z + ox, py * z + oy)
                cr.close_path(); cr.fill_preserve()
                cr.set_source_rgba(r, g, b, 1 if active else 0.4); cr.set_line_width(2); cr.stroke()
            for i, (px, py) in enumerate(pts):
                cr.set_source_rgba(r, g, b, 1 if active else 0.4)
                cr.arc(px * z + ox, py * z + oy, 4, 0, 2 * math.pi); cr.fill()
                if active:
                    cr.set_source_rgb(1, 1, 1); cr.set_font_size(11)
                    cr.move_to(px * z + ox + 6, py * z + oy + 14)
                    cr.show_text(f"{i+1}: {px},{py}")

        # crosshair + readout
        mx, my = self.mouse
        wx, wy = self.to_world(mx, my)
        cr.set_source_rgba(0.3, 1, 0.5, 0.8); cr.set_line_width(1)
        cr.move_to(mx + 0.5, 0); cr.line_to(mx + 0.5, h)
        cr.move_to(0, my + 0.5); cr.line_to(w, my + 0.5); cr.stroke()
        scale = self.get_native().get_surface().get_scale() if self.get_native() else 1
        txt = f"logical {wx:.0f},{wy:.0f}   physical {wx*scale:.0f},{wy*scale:.0f}"
        cr.set_font_size(14); cr.set_source_rgb(0.3, 1, 0.5)
        cr.move_to(mx + 12, my + 24); cr.show_text(txt)

        # HUD
        r, g, b = COLORS[self.cur]
        hud = [f"Drawing: {self.cur.upper()}  (Tab to switch)    zoom {z:.1f}x    screen {w}x{h} logical @ {scale}x",
               "L-click add · R-click undo · arrows nudge (Shift=10) · scroll zoom · middle-drag pan · C clear · S save · Esc quit",
               "DRAWER = left app drawer (click its corners).  NOTCH = closed pill.  PANEL = opened tab.",
               f"drawer pts: {len(self.points['drawer'])}   notch pts: {len(self.points['notch'])}   -> {OUT}"]
        cr.set_source_rgba(0, 0, 0, 0.7); cr.rectangle(w / 2 - 470, h - 100, 940, 88); cr.fill()
        cr.set_font_size(13)
        for i, line in enumerate(hud):
            cr.set_source_rgb(r, g, b) if i == 0 else cr.set_source_rgb(0.9, 0.9, 0.9)
            cr.move_to(w / 2 - 455, h - 78 + i * 20); cr.show_text(line)


def on_activate(app):
    win = Gtk.ApplicationWindow(application=app, title="Notch Grid")
    grid = Grid()
    win.set_child(grid)
    win.fullscreen()
    win.present()
    grid.grab_focus()


app = Gtk.Application(application_id="local.notch.grid")
app.connect("activate", on_activate)
app.run()
