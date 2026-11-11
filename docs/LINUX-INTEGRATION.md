# LINUX-INTEGRATION — how to realise each screen on Arch + GNOME

Everything here must be **verified on the owner's machine** (GNOME version, Wayland vs X11). Treat it as a starting plan, not a guarantee.

## Lock screen — the hard part

Facts to know:
- GNOME's lock screen is drawn **inside gnome-shell** (`js/ui/unlockDialog.js`, `authPrompt.js`) and authenticates via PAM (`gdm-password`).
- Mutter does **not** implement `ext-session-lock-v1`, so ordinary Wayland "locker" apps (swaylock-style) cannot be used on GNOME.
- A fullscreen app painted over the desktop is **not a secure lock** (crashes, VT switching, focus tricks).

Options, best first:

**A. GNOME Shell extension with `"session-modes": ["user", "unlock-dialog"]`** (recommended base)
Extensions can run on the lock screen and add/replace actors in the unlock dialog. Use this to draw the title-screen look, the overlay buttons
(NEW GAME / CONTINUE / LOAD / QUICK LOAD), the user list and the nixie PIN pad, and **feed the PIN to the real PAM conversation** via GNOME's `AuthPrompt`/`Gdm.UserVerifier` APIs.
Open problem to solve first: *video inside gnome-shell*. Try, in order: (1) `Gst` + `appsink` → `Clutter.Image` frame upload for the 3 s silent loop (check CPU use);
(2) pre-rendered, down-scaled frame sequence for the loop; (3) a still frame + animated St widgets as fallback. Audio can use `Gst` playbin in the shell process.
Prototype in a **nested shell** (`dbus-run-session gnome-shell --nested --wayland` or `--devkit` on newer GNOME) before touching the real session.

**B. The two long clips as normal fullscreen windows (not part of the security boundary)**
- *Unlock movie* (54 s): once PAM has succeeded the session is already unlocked, so play `unlock.webm` in a small GTK4 app (GStreamer `gtk4paintablesink`) covering the screen, then fade to the desktop. Ctrl+Shift+Esc closes it. 
- *Lock transition* (46 s boot clip): trigger it from the console `lock` command / a shortcut: play the clip fullscreen, then run `loginctl lock-session`. Idle auto-lock can skip the clip.

**C. Switch compositor** (only if the owner agrees): Hyprland/Sway support `ext-session-lock-v1`, which allows a *proper* fully custom locker (e.g. Quickshell with video). Mention it as an alternative, don't do it unasked.

**D. Cosmetic fullscreen "locker" app on top of GNOME's own lock** — works visually but is insecure and double-authenticates. Don't do this unless the owner insists and understands.

## Login (GDM)

GDM runs before the session and its UI is hard to replace. Options: leave GDM stock; or enable **auto-login** and make the custom lock screen the entry point
(only sensible with full-disk encryption — ask the owner). Never replace GDM files without a backup and a TTY fallback.

## Auth — the "4-digit PIN"

- Simplest: PIN = the account password (weak; with LUKS + `pam_faillock` it is tolerable but still weak).
- Better: keep the real password for GDM/sudo; add a **separate PAM service for the lock screen** that verifies a salted hash of the PIN (root-owned file) with `pam_faillock` (e.g. 5 tries → 5 min).
  Wiring this into the gnome-shell unlock path means editing `/etc/pam.d/gdm-password` — **risky; back up, test from a TTY, ask the owner.**
- The demo's user list (NEW GAME creates users, LOAD lists them) maps to *Linux accounts* in the real build; "creating a user" must call the proper tools (`useradd`/AccountsService via polkit) and **needs the owner's explicit approval** — or keep it as a mock list and use the real account.

## Boot splash (Plymouth)

- Plymouth shows **frames, not video, and has no audio**. Convert `boot.webm` (or a trimmed part) to PNG frames: `scripts/make-plymouth-frames.sh`, then write a `script`-module theme that plays them at 30 fps and holds the last frame.
- Install to `/usr/share/plymouth/themes/steinsgate/`, add the `plymouth` hook to `/etc/mkinitcpio.conf` (`HOOKS=(base udev plymouth …)`), kernel params `quiet splash`, then `sudo plymouth-set-default-theme -R steinsgate`. Test first with `sudo plymouthd; sudo plymouth --show-splash` on a spare VT.
- 46 s is far too long for a boot splash — ask the owner which seconds to use (default: first ~10 s, then fade).

## Home screen

- Wallpaper: `gsettings set org.gnome.desktop.background picture-uri file:///…/wallpaper.webp` (also `picture-uri-dark`, `picture-options 'zoom'`). Convert to PNG/JPG if the loader rejects WebP.
- Date badge: an actor added by the same extension to `Main.layoutManager.uiGroup`/`backgroundGroup` (above wallpaper, below windows), with the slide-in animation.

## Phone Trigger app

- **Not** inside the shell (needs web content): a GTK4 app hosting **WebKitGTK** (`webkitgtk-6.0`) with a transparent, frameless window that loads the phone UI (reuse the demo's HTML/CSS/JS), toggled by a GNOME custom shortcut (Alt+P) that runs `sg-phone --toggle`.
- Wayland clients can't position themselves or stay on top → add a tiny shell-extension helper that places the phone window at the right edge and calls `make_above()`; or implement the phone as St widgets entirely inside the extension (no WhatsApp then).
- **WhatsApp**: a second WebKitGTK web view of `https://web.whatsapp.com` with a **persistent** `NetworkSession` (cookies/localStorage in `~/.local/share/sg-shell/whatsapp`), a Chrome-like user agent, notifications enabled. (Alternative: embed/launch an existing WhatsApp Web wrapper.)
- **Mail**: the compose screen writes drafts to `~/.local/share/sg-shell/drafts/*.eml`; "Send" hands off to the owner's mail client (`xdg-open mailto:…`) or an SMTP/IMAP account the owner configures. Ask which client they use (Thunderbird/Evolution/other).
- **Network / Settings**: Wi-Fi via NetworkManager (`nmcli`/D-Bus), Bluetooth via BlueZ (`bluetoothctl`/D-Bus), airplane mode via `rfkill`/NM, power-saver via `powerprofilesctl`, brightness via `org.gnome.SettingsDaemon.Power.Screen` D-Bus, volume via PipeWire (`wpctl`), accessibility toggles via `gsettings org.gnome.desktop.a11y.*`.
  These are what the stock GNOME quick-settings panel does; the phone replaces its UI (hide the stock panel's quick-settings via an extension if wanted).

## Console app

- Use a real terminal: GTK4 + `vte4`, styled with the game bar, **or** start from the **ddterm** GNOME extension (drop-down terminal with top/bottom edge, resizing, and pop-out) and theme it.
- Requirements from the owner: toggles with Alt+C, can **extend up or down**, **docked or floating**, drag-resize on the edge, bottom decoration lines/buttons as in SPEC §6.

## Global shortcuts

Register through GNOME custom keybindings (`org.gnome.settings-daemon.plugins.media-keys custom-keybindings`) or the extension: **Alt+C** console, **Alt+P** phone.
**Ctrl+Shift+Esc** skips the boot/unlock clips (only while a clip is playing; GNOME does not bind it by default).

## Packaging

Provide `install.sh` (user-level where possible; clearly separated sudo steps with confirmations), `uninstall.sh`/restore (stock lock screen, Plymouth theme, wallpaper), and a `config.toml` for users, shortcuts and paths.
