#!/usr/bin/env bash
# Undo install-boot.sh:  sudo shell/system/uninstall-boot.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
read -r -p "Restore GRUB and GDM settings from their backups and remove the boot splash? [y/N] " a
[ "$a" = y ] || [ "$a" = Y ] || exit 0
[ -f /etc/gdm/custom.conf.sg-backup ] && mv -f /etc/gdm/custom.conf.sg-backup /etc/gdm/custom.conf && echo "restored /etc/gdm/custom.conf (auto-login off)"
if [ -f /etc/default/grub.sg-backup ]; then
    mv -f /etc/default/grub.sg-backup /etc/default/grub && echo "restored /etc/default/grub"
    rm -f /boot/grub/grub.cfg.sg-backup
    grub-mkconfig -o /boot/grub/grub.cfg
fi
if [ -d /usr/share/plymouth/themes/steinsgate ] || [ -f /etc/mkinitcpio.conf.sg-backup ]; then
    "$HERE/../plymouth/uninstall-plymouth.sh"
fi
echo "Done."
