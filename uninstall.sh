#!/usr/bin/env bash
# Remove the Steins;Gate RE:BOOT shell and restore the previous wallpaper / stock lock screen.
#   ./uninstall.sh            restore settings, remove files (keeps config, drafts and the WhatsApp profile)
#   ./uninstall.sh --purge    also remove config, drafts and the WhatsApp profile
set -euo pipefail
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
BIN_DIR="${SG_BIN_DIR:-$HOME/.local/bin}"
DATA="$DATA_HOME/sg-shell"
UUID="sg-shell@amadeus.local"
HERE="$(cd "$(dirname "$0")" && pwd)"

for app in sg-console sg-phone sg-clip; do pkill -f "apps/$app" 2>/dev/null || true; done
if [ -x "$DATA/apps/tools/sg-settings.py" ]; then "$DATA/apps/tools/sg-settings.py" restore
else "$HERE/shell/tools/sg-settings.py" restore; fi

rm -rf "$DATA_HOME/gnome-shell/extensions/$UUID" "$DATA_HOME/fonts/sg-shell"
for app in sg-console sg-phone sg-clip; do
    [ -L "$BIN_DIR/$app" ] && rm -f "$BIN_DIR/$app"
done
rm -rf "$DATA"/{media,sounds,apps,console-bin}
fc-cache -f "$DATA_HOME/fonts" >/dev/null 2>&1 || true
if [ "${1:-}" = "--purge" ]; then
    rm -rf "$DATA" "$CONFIG_HOME/sg-shell" "${XDG_STATE_HOME:-$HOME/.local/state}/sg-shell"
    echo "purged config, drafts and the WhatsApp profile"
else
    echo "kept: $CONFIG_HOME/sg-shell (config), $DATA/drafts, $DATA/whatsapp"
fi
echo "Removed. The stock GNOME lock screen is back; the extension unloads fully at the next login."
echo "If you ran shell/system/install-boot.sh (splash, GRUB, auto-login), undo it with: sudo shell/system/uninstall-boot.sh"
