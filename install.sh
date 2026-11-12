#!/usr/bin/env bash
# Steins;Gate RE:BOOT shell — per-user install. No sudo, nothing outside your home directory.
#   ./install.sh                  install files + apply settings (wallpaper, Alt+C / Alt+P, enable extension)
#   ./install.sh --files-only     install/refresh files, leave GNOME settings alone
#   ./install.sh --apply-settings re-apply settings after editing ~/.config/sg-shell/config.toml
# Undo with ./uninstall.sh.  The boot splash is separate and needs root: see shell/plymouth/README.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/shell"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
BIN_DIR="${SG_BIN_DIR:-$HOME/.local/bin}"
DATA="$DATA_HOME/sg-shell"
UUID="sg-shell@amadeus.local"
MODE="${1:-all}"

install_files() {
    for dep in gnome-shell python3 ffmpeg; do
        command -v "$dep" >/dev/null || { echo "missing dependency: $dep" >&2; exit 1; }
    done
    python3 -I -c 'import gi
for n, v in (("Gtk","4.0"),("Vte","3.91"),("WebKit","6.0"),("Gst","1.0")): gi.require_version(n, v)' \
        || { echo "missing: python-gobject with gtk4, vte4, webkitgtk-6.0, gstreamer" >&2; exit 1; }

    mkdir -p "$DATA"/{media,sounds,sounds/pack,apps,console-bin,drafts,mail/inbox,dmail,phone/wallpapers,phone/ringtones} "$BIN_DIR" "$CONFIG_HOME/sg-shell" \
             "$DATA_HOME/fonts/sg-shell" "$DATA_HOME/gnome-shell/extensions"
    # Media is not part of the public repository (see README → Media): copy what is there, name what is not.
    local missing=()
    for f in "$HERE"/demo/media/{boot.webm,lock_loop.webm,lock_music.ogg,unlock.webm} \
             "$SRC"/media/{lock_still.jpg,wallpaper.jpg}; do
        if [ -f "$f" ]; then cp -f "$f" "$DATA/media/"; else missing+=("${f#"$HERE"/}"); fi
    done
    if [ "${#missing[@]}" -gt 0 ]; then
        echo "media not found (those parts stay black / silent until you add them — see README → Media):"
        printf '    %s\n' "${missing[@]}"
    fi
    cp -f "$SRC"/sounds/*.ogg "$DATA/sounds/"
    rm -rf "$DATA/apps" && cp -r "$SRC/apps" "$DATA/apps" && rm -rf "$DATA/apps/console-bin"
    rm -rf "$DATA/console-bin" && cp -r "$SRC/apps/console-bin" "$DATA/console-bin"
    cp -r "$SRC/tools" "$DATA/apps/"
    cp -f "$SRC"/fonts/*.ttf "$SRC"/fonts/*.otf "$DATA_HOME/fonts/sg-shell/"
    fc-cache -f "$DATA_HOME/fonts" >/dev/null 2>&1 || true
    for app in sg-console sg-phone sg-clip sg-mail; do
        chmod +x "$DATA/apps/$app"
        ln -sfn "$DATA/apps/$app" "$BIN_DIR/$app"
    done
    rm -rf "$DATA_HOME/gnome-shell/extensions/$UUID"
    cp -r "$SRC/extension/$UUID" "$DATA_HOME/gnome-shell/extensions/$UUID"
    if [ ! -f "$CONFIG_HOME/sg-shell/config.toml" ]; then
        cp "$SRC/config.toml" "$CONFIG_HOME/sg-shell/config.toml"
        echo "config → $CONFIG_HOME/sg-shell/config.toml"
    else
        echo "kept existing config: $CONFIG_HOME/sg-shell/config.toml"
    fi
    echo "files installed under $DATA, launchers in $BIN_DIR"
}

apply_settings() {
    "$DATA/apps/tools/sg-settings.py" apply
}

case "$MODE" in
    all) install_files; apply_settings ;;
    --files-only) install_files ;;
    --apply-settings) apply_settings ;;
    *) sed -n '2,7p' "$0"; exit 2 ;;
esac

cat <<'N'

Done. Notes:
  • The lock screen, date badge and window placement live in a GNOME Shell extension.
    On Wayland a new extension loads at the next login: log out and back in once.
  • Lock screen safety net: F12 on the lock screen switches to GNOME's stock unlock prompt.
    To disable the themed lock screen entirely: set  enabled = false  under [lock] in
    ~/.config/sg-shell/config.toml, or run  gnome-extensions disable sg-shell@amadeus.local
    (also works from a TTY: Ctrl+Alt+F3).
N
