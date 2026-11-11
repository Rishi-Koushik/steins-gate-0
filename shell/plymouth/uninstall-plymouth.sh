#!/usr/bin/env bash
# Undo install-plymouth.sh:  sudo shell/plymouth/uninstall-plymouth.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
read -r -p "Restore mkinitcpio.conf / plymouthd.conf backups, remove the steinsgate theme and rebuild the initramfs? [y/N] " a
[ "$a" = y ] || [ "$a" = Y ] || exit 0
for f in /etc/mkinitcpio.conf /etc/plymouth/plymouthd.conf; do
    [ -f "$f.sg-backup" ] && mv -f "$f.sg-backup" "$f" && echo "restored $f"
done
rm -rf /usr/share/plymouth/themes/steinsgate
mkinitcpio -P
echo "Done. You can also remove 'quiet splash' from the kernel command line and the plymouth package (pacman -Rs plymouth)."
