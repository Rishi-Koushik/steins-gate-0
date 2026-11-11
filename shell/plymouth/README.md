# Boot splash (Plymouth)

Not installed by `install.sh`: it needs root, edits `/etc/mkinitcpio.conf` and rebuilds the initramfs,
so it is a separate, confirm-each-step script.

    sudo shell/plymouth/install-plymouth.sh          # default: first 10 s of boot.webm, 12 fps, 640 px wide
    sudo START=30 DUR=8 shell/plymouth/install-plymouth.sh   # another window of the 46 s clip
    sudo shell/plymouth/uninstall-plymouth.sh        # restore backups, rebuild initramfs

Plymouth plays frames only (no audio), and the frames live in the initramfs, so keep the window short.
If boot ever fails after this, pick the fallback initramfs entry in the boot menu, or boot with
`plymouth.enable=0` on the kernel command line, then run the uninstall script.
