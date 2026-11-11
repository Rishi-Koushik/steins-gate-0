"""Shared helpers for the SG shell apps (config + paths)."""
import os
import tomllib
from pathlib import Path

HOME = Path.home()
DATA_DIR = Path(os.environ.get("XDG_DATA_HOME", HOME / ".local/share")) / "sg-shell"
CONFIG_FILE = Path(os.environ.get("XDG_CONFIG_HOME", HOME / ".config")) / "sg-shell" / "config.toml"
RUNTIME_DIR = Path(os.environ.get("XDG_RUNTIME_DIR", "/tmp")) / "sg-shell"
APP_DIR = Path(__file__).resolve().parent


def load_config():
    try:
        with open(CONFIG_FILE, "rb") as f:
            return tomllib.load(f)
    except (OSError, tomllib.TOMLDecodeError):
        return {}


def cfg_get(cfg, section, key, default):
    return cfg.get(section, {}).get(key, default)


def media(name):
    return str(DATA_DIR / "media" / name)


def forward_to_running(app_id, argv):
    """Shortcut presses start a new process each time. If the app is already running, hand
    the command line to it straight away, before the slow GTK / WebKit / VTE imports
    (they cost most of a second and made the toggle feel dead)."""
    import sys
    try:
        import gi
        from gi.repository import Gio, GLib
        bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        running = bus.call_sync(
            "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "NameHasOwner",
            GLib.Variant("(s)", (app_id,)), None, Gio.DBusCallFlags.NONE, 500, None).unpack()[0]
    except Exception:
        return
    if running:
        app = Gio.Application(application_id=app_id, flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        sys.exit(app.run(argv))
