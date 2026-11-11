#!/usr/bin/env bash
# Power-on experience — the parts that need root. Run it yourself:
#     sudo shell/system/install-boot.sh
# Three independent steps, each asked separately, each with a backup (*.sg-backup):
#   1. Plymouth boot splash from boot.webm            (shell/plymouth/install-plymouth.sh)
#   2. GRUB: add "splash", hide the boot menu          (/etc/default/grub, /boot/grub/grub.cfg)
#   3. GDM auto-login for your user                    (/etc/gdm/custom.conf)
# With 3, the SG shell locks the session the moment it starts (on_login in config.toml), so
# power-on goes: splash → boot clip → title screen → nixie panel → unlock movie → home,
# and the password is typed once, on the nixie panel.
# One step only, without questions:  sudo shell/system/install-boot.sh splash|grub|autologin
# Undo everything: sudo shell/system/uninstall-boot.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="${SUDO_USER:-}"
# started through pkexec (graphical password prompt) instead of sudo
[ -z "$USER_NAME" ] && [ -n "${PKEXEC_UID:-}" ] && USER_NAME="$(id -nu "$PKEXEC_UID")"
ONLY="${1:-}"
case "$ONLY" in ""|splash|grub|autologin) ;; *) echo "usage: $0 [splash|grub|autologin]" >&2; exit 2;; esac
want() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }
ask() { [ -n "$ONLY" ] && return 0; read -r -p "$1 [y/N] " a; [ "$a" = y ] || [ "$a" = Y ]; }
backup() { [ -f "$1" ] && [ ! -f "$1.sg-backup" ] && cp -a "$1" "$1.sg-backup" && echo "backup: $1.sg-backup"; return 0; }

echo "== 1/3  Plymouth boot splash =="
if want splash && ask "Install the Steins;Gate boot splash (installs plymouth, edits mkinitcpio.conf, rebuilds the initramfs)?"; then
    "$HERE/../plymouth/install-plymouth.sh"
fi

echo
echo "== 2/3  GRUB =="
GRUB=/etc/default/grub
CFG=/boot/grub/grub.cfg
if ! want grub; then
    echo "skipped"
elif [ ! -f "$GRUB" ] || [ ! -f "$CFG" ]; then
    echo "no $GRUB or $CFG here — skipped (add 'quiet splash' to your kernel command line by hand)"
elif ask "Add 'splash' to the kernel command line and hide the GRUB menu (hold Shift or tap Esc at power-on to get it back)?"; then
    backup "$GRUB"; backup "$CFG"
    if ! grep -Eq '^GRUB_CMDLINE_LINUX_DEFAULT=.*\bsplash\b' "$GRUB"; then
        sed -i -E 's/^(GRUB_CMDLINE_LINUX_DEFAULT="[^"]*)"/\1 splash"/' "$GRUB"
    fi
    grep -Eq '^GRUB_CMDLINE_LINUX_DEFAULT=.*\bquiet\b' "$GRUB" || sed -i -E 's/^(GRUB_CMDLINE_LINUX_DEFAULT="[^"]*)"/\1 quiet"/' "$GRUB"
    if grep -q '^GRUB_TIMEOUT_STYLE=' "$GRUB"; then sed -i -E 's/^GRUB_TIMEOUT_STYLE=.*/GRUB_TIMEOUT_STYLE=hidden/' "$GRUB"; else echo 'GRUB_TIMEOUT_STYLE=hidden' >> "$GRUB"; fi
    if grep -q '^GRUB_TIMEOUT=' "$GRUB"; then sed -i -E 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=1/' "$GRUB"; else echo 'GRUB_TIMEOUT=1' >> "$GRUB"; fi
    grep -E '^GRUB_(CMDLINE_LINUX_DEFAULT|TIMEOUT|TIMEOUT_STYLE)=' "$GRUB"
    grub-mkconfig -o "$CFG"
fi

echo
echo "== 3/3  GDM auto-login =="
GDM=/etc/gdm/custom.conf
if ! want autologin; then
    echo "skipped"
elif [ -z "$USER_NAME" ] || [ "$USER_NAME" = root ]; then
    echo "run through sudo from your own account so the user name is known — skipped"
elif [ ! -f "$GDM" ]; then
    echo "no $GDM — skipped"
elif grep -Eqi '^\s*AutomaticLoginEnable\s*=\s*true' "$GDM"; then
    echo "auto-login is already on"
elif ask "Log '$USER_NAME' in automatically at boot? (The session locks itself at once and the SG lock screen asks for the password.)"; then
    backup "$GDM"
    sed -i -E '/^\s*AutomaticLogin(Enable)?\s*=/d' "$GDM"
    if grep -q '^\[daemon\]' "$GDM"; then
        sed -i "/^\[daemon\]/a AutomaticLoginEnable=True\nAutomaticLogin=$USER_NAME" "$GDM"
    else
        printf '\n[daemon]\nAutomaticLoginEnable=True\nAutomaticLogin=%s\n' "$USER_NAME" >> "$GDM"
    fi
    sed -n '/^\[daemon\]/,/^\[security\]/p' "$GDM"
fi

cat <<'N'

Done — reboot to see it.
If anything goes wrong at boot: tap Esc at power-on for the GRUB menu, press e on the Arch entry, add
  plymouth.enable=0   to the line starting with "linux", then Ctrl+X.  Then: sudo shell/system/uninstall-boot.sh
N
