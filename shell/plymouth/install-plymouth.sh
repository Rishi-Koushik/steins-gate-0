#!/usr/bin/env bash
# Boot splash (Plymouth) — the only part of the SG shell that needs root. Run it yourself:
#     sudo shell/plymouth/install-plymouth.sh
# It asks before each system change and backs up what it edits. Undo: sudo shell/plymouth/uninstall-plymouth.sh
#
# Clip window (defaults: first 10 s of boot.webm at 12 fps, 640 px wide ≈ 18 MB in the initramfs):
#     sudo START=0 DUR=10 FPS=12 WIDTH=640 shell/plymouth/install-plymouth.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
THEME=/usr/share/plymouth/themes/steinsgate
START="${START:-0}"; DUR="${DUR:-10}"; FPS="${FPS:-12}"; WIDTH="${WIDTH:-640}"
ask() { read -r -p "$1 [y/N] " a; [ "$a" = y ] || [ "$a" = Y ]; }

echo "This will:"
echo "  1. install the 'plymouth' package (pacman) if missing"
echo "  2. write the theme to $THEME (frames from demo/media/boot.webm: ${DUR}s from ${START}s at ${FPS} fps)"
echo "  3. add the 'plymouth' hook to /etc/mkinitcpio.conf (backup: /etc/mkinitcpio.conf.sg-backup)"
echo "  4. set the default Plymouth theme and rebuild the initramfs (mkinitcpio -P)"
echo "It does NOT touch your bootloader: you add 'quiet splash' to the kernel command line yourself (printed at the end)."
ask "Continue?" || exit 0

command -v plymouth-set-default-theme >/dev/null || pacman -S --needed plymouth

rm -rf "$THEME"; mkdir -p "$THEME"
ffmpeg -v error -y -ss "$START" -t "$DUR" -i "$REPO/demo/media/boot.webm" -vf "fps=$FPS,scale=$WIDTH:-2" "$THEME/frame-%d.png"
COUNT=$(ls "$THEME"/frame-*.png | wc -l)
[ "$COUNT" -gt 0 ] || { echo "no frames were produced" >&2; exit 1; }
cp "$HERE/steinsgate/steinsgate.plymouth" "$THEME/"
sed -e "s/@COUNT@/$COUNT/" -e "s/@FPS@/$FPS/" "$HERE/steinsgate/steinsgate.script" > "$THEME/steinsgate.script"
echo "theme written: $COUNT frames, $(du -sh "$THEME" | cut -f1)"

if grep -Eq '^HOOKS=.*\bplymouth\b' /etc/mkinitcpio.conf; then
    echo "mkinitcpio.conf already has the plymouth hook"
elif ask "Add the plymouth hook to /etc/mkinitcpio.conf?"; then
    [ -f /etc/mkinitcpio.conf.sg-backup ] || cp -a /etc/mkinitcpio.conf /etc/mkinitcpio.conf.sg-backup
    if grep -Eq '^HOOKS=.*\bsystemd\b' /etc/mkinitcpio.conf; then
        sed -i -E '/^HOOKS=/ s/\bsystemd\b/systemd plymouth/' /etc/mkinitcpio.conf
    else
        sed -i -E '/^HOOKS=/ s/\budev\b/udev plymouth/' /etc/mkinitcpio.conf
    fi
    grep '^HOOKS=' /etc/mkinitcpio.conf
else
    echo "skipped: without the hook the splash only shows late in boot / at shutdown"
fi

if ask "Set 'steinsgate' as the default theme and rebuild the initramfs now?"; then
    [ -f /etc/plymouth/plymouthd.conf ] && [ ! -f /etc/plymouth/plymouthd.conf.sg-backup ] && cp -a /etc/plymouth/plymouthd.conf /etc/plymouth/plymouthd.conf.sg-backup
    plymouth-set-default-theme -R steinsgate
fi

cat <<'N'

Last step (manual, depends on your bootloader): add   quiet splash   to the kernel command line.
  systemd-boot : edit the "options" line in /boot/loader/entries/<entry>.conf
  GRUB         : add to GRUB_CMDLINE_LINUX_DEFAULT in /etc/default/grub, then  grub-mkconfig -o /boot/grub/grub.cfg
  UKI / other  : /etc/kernel/cmdline (then rebuild) or your bootloader's config
Preview without rebooting (on a spare VT, Ctrl+Alt+F3):
  sudo plymouthd; sudo plymouth --show-splash; sleep 12; sudo plymouth quit
N
