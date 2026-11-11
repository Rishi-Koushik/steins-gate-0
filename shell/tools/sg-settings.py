#!/usr/bin/python3 -I
"""Apply / restore the GNOME settings the SG shell touches (wallpaper, shortcuts, extension).

  sg-settings.py apply     back up current values once, then apply config.toml
  sg-settings.py restore   put the backed-up values back and remove our shortcuts
"""
import json
import os
import sys
import tomllib
from pathlib import Path

import gi
from gi.repository import Gio, GLib

HOME = Path.home()
DATA = Path(os.environ.get("XDG_DATA_HOME", HOME / ".local/share")) / "sg-shell"
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", HOME / ".config")) / "sg-shell" / "config.toml"
STATE = Path(os.environ.get("XDG_STATE_HOME", HOME / ".local/state")) / "sg-shell"
BACKUP = STATE / "settings-backup.json"
UUID = "sg-shell@amadeus.local"
KB_SCHEMA = "org.gnome.settings-daemon.plugins.media-keys"
KB_BASE = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/"
BINDINGS = {
    "sg-console": ("SG console", "console", "<Alt>c"),
    "sg-console-c": ("SG console (second key)", "console_alt", ""),
    "sg-phone": ("SG Phone Trigger", "phone", "<Alt>p"),
}
# The Copilot key is not a key of its own: the keyboard sends Shift+Super+F23. Depending on the
# keyboard-layout data that arrives as XF86Assistant or as the raw combination, so all three
# spellings are bound (an unknown one is simply ignored). Switched by [shortcuts] copilot_key.
COPILOT = ["XF86Assistant", "<Shift><Super>XF86TouchpadOff", "<Shift><Super>F23"]
for _i, _accel in enumerate(COPILOT, 1):
    BINDINGS[f"sg-phone-copilot{_i}"] = (f"SG Phone Trigger (Copilot key {_i})", "copilot_key", _accel)
BG_KEYS = ("picture-uri", "picture-uri-dark", "picture-options")


def cfg():
    try:
        return tomllib.loads(CONFIG.read_text())
    except (OSError, tomllib.TOMLDecodeError):
        return {}


def apply():
    c = cfg()
    bg = Gio.Settings.new("org.gnome.desktop.background")
    shell = Gio.Settings.new("org.gnome.shell")
    keys = Gio.Settings.new(KB_SCHEMA)
    STATE.mkdir(parents=True, exist_ok=True)
    if not BACKUP.exists():
        BACKUP.write_text(json.dumps({
            "background": {k: bg.get_string(k) for k in BG_KEYS},
            "extension_was_enabled": UUID in shell.get_strv("enabled-extensions"),
        }, indent=2))
        print(f"backed up current settings → {BACKUP}")

    wall = c.get("home", {}).get("wallpaper") or str(DATA / "media" / "wallpaper.jpg")
    wall = os.path.expanduser(wall)
    if os.path.exists(wall):
        uri = GLib.filename_to_uri(wall, None)
        bg.set_string("picture-uri", uri)
        bg.set_string("picture-uri-dark", uri)
        bg.set_string("picture-options", "zoom")
        print(f"wallpaper → {wall}")
    else:
        print(f"wallpaper not found, left unchanged: {wall}")

    paths = keys.get_strv("custom-keybindings")
    for name, (title, key, default) in BINDINGS.items():
        path = f"{KB_BASE}{name}/"
        b = Gio.Settings.new_with_path(f"{KB_SCHEMA}.custom-keybinding", path)
        binding = c.get("shortcuts", {}).get(key, default)
        if key == "copilot_key":
            binding = default if binding is not False else ""
        if not binding:
            # optional shortcut left empty: make sure no stale binding stays behind
            for k in ("name", "command", "binding"):
                b.reset(k)
            paths = [p for p in paths if p != path]
            continue
        b.set_string("name", title)
        cmd = "sg-console" if "console" in name else "sg-phone"
        b.set_string("command", str(HOME / ".local/bin" / cmd))
        b.set_string("binding", binding)
        if path not in paths:
            paths.append(path)
        print(f"shortcut {b.get_string('binding')} → {cmd}")
    keys.set_strv("custom-keybindings", paths)

    enabled = shell.get_strv("enabled-extensions")
    if UUID not in enabled:
        shell.set_strv("enabled-extensions", enabled + [UUID])
    disabled = [u for u in shell.get_strv("disabled-extensions") if u != UUID]
    shell.set_strv("disabled-extensions", disabled)
    print(f"extension {UUID} enabled (takes effect at next login)")
    Gio.Settings.sync()


def restore():
    bg = Gio.Settings.new("org.gnome.desktop.background")
    shell = Gio.Settings.new("org.gnome.shell")
    keys = Gio.Settings.new(KB_SCHEMA)
    try:
        saved = json.loads(BACKUP.read_text())
    except (OSError, ValueError):
        saved = None
    if saved:
        for k, v in saved.get("background", {}).items():
            bg.set_string(k, v)
        print("wallpaper restored")
    else:
        for k in BG_KEYS:
            bg.reset(k)
        print("no backup found: wallpaper reset to the GNOME default")
    paths = keys.get_strv("custom-keybindings")
    for name in BINDINGS:
        path = f"{KB_BASE}{name}/"
        b = Gio.Settings.new_with_path(f"{KB_SCHEMA}.custom-keybinding", path)
        for k in ("name", "command", "binding"):
            b.reset(k)
        paths = [p for p in paths if p != path]
    keys.set_strv("custom-keybindings", paths)
    print("shortcuts removed")
    shell.set_strv("enabled-extensions", [u for u in shell.get_strv("enabled-extensions") if u != UUID])
    print("extension disabled")
    Gio.Settings.sync()
    if saved:
        BACKUP.unlink()


if __name__ == "__main__":
    op = sys.argv[1] if len(sys.argv) > 1 else ""
    if op == "apply":
        apply()
    elif op == "restore":
        restore()
    else:
        sys.exit(__doc__)
