# CLAUDE.md — instructions for Claude Code (Arch Linux + GNOME)

You are building a **personal Steins;Gate RE:BOOT themed desktop shell** for the owner's laptop.
`demo/index.html` is a working reference of the intended UX; `docs/SPEC.md` is the precise spec;
`docs/LINUX-INTEGRATION.md` lists the Linux approaches and their trade-offs. Read all three before coding.

## Ground rules (important)

1. **Do not lock the owner out.** A broken lock screen, PAM change or GDM change can leave the machine unusable.
   - Develop and test in a **nested session / VM / second user account**, and keep a TTY (Ctrl+Alt+F3) path working.
   - Before touching `/etc/pam.d`, GDM, Plymouth initramfs hooks or `/usr/share/gnome-shell`, **tell the owner what you will change, keep a backup, and ask**. Never use `sudo` without saying why.
2. **Authentication: the owner has explicitly accepted a weak 4-digit PIN** (as the account password / lock-screen PIN) — don't argue it again.
   Still: mention `pam_faillock` (e.g. 5 tries → 5 min lockout) as a cheap safeguard and apply it if the owner agrees, never store PINs in plain text
   (the demo stores them in browser localStorage purely as a mock), and still back up PAM/GDM files and keep a TTY fallback before editing them (see LINUX-INTEGRATION.md §Auth).
3. **Assets are personal-use game recordings.** Keep them local, don't upload or publish them, don't add them to a public repo.
4. **Verify, don't assume.** GNOME versions differ (extension API, Wayland features, `ext-session-lock` is **not** supported by Mutter).
   First run the environment checks below and adapt.
5. Ask the owner when a choice is theirs (e.g. which Plymouth length, PIN vs password, which mail client). Otherwise pick sensible defaults and say so.

## Step 0 — environment check (report results before building)

```bash
gnome-shell --version; echo $XDG_SESSION_TYPE; pacman -Q gdm plymouth webkitgtk-6.0 gtk4 vte4 python-gobject gst-plugins-good gst-plugin-gtk4 ffmpeg 2>&1
loginctl show-session $XDG_SESSION_ID -p Type -p Class
ls /usr/lib/plymouth/ 2>/dev/null | head
```
Decide the lock-screen strategy from the results (see LINUX-INTEGRATION.md §Lock screen).

## Build order (milestones — commit after each, show the owner)

1. **Home screen**: set `wallpaper.webp` as the GNOME background (`gsettings`), plus the date badge (top-left, slide-in) — **no buttons on the home screen**.
2. **Console app**: drop-down terminal (VTE) styled like the game's text bar; Alt+C toggles; extend up/down, drag top edge, pop-out; commands from SPEC §Console.
3. **Phone Trigger app**: Alt+P; rises from the bottom with a 360° X-axis flip; MAIL / Contacts / Network / Settings; WhatsApp (WebKitGTK web view, persistent profile); mail compose + drafts.
4. **Lock / login experience**: title screen with the looping video + overlay buttons, NEW GAME (create user), CONTINUE → LOAD / QUICK LOAD, nixie PIN, unlock movie (skippable with Ctrl+Shift+Esc), music. Strategy depends on Step 0.
5. **Boot**: Plymouth theme from `boot.webm` frames (the owner decides the length; default first ~10 s then fade).
6. **Packaging**: an install script or PKGBUILD that installs everything for the current user, and an uninstall/restore script.

## How to reuse the demo

`demo/index.html` is the visual/behavioural source of truth: copy CSS values, SVG paths (nixie digit glyphs in `GL`, phone icons in `I`),
state machine (`stage()`, `go()`), coordinates of the overlay buttons (`IT`), timings and key bindings. Hosting the same HTML in a
**WebKitGTK** window is a legitimate way to reuse it for the phone/lock UI; the console should be a real terminal (VTE), not HTML.
Fonts used: *IM Fell English*, *Archivo Black*, *Special Elite*, *Nixie One* (all SIL OFL on Google Fonts — install via `ttf-*` packages or bundle locally; don't rely on the network at lock time).

## Definition of done

- Everything in SPEC.md works on the owner's real GNOME session (not just in the demo).
- A recovery path exists and is documented (how to restore stock lock screen/boot splash).
- The owner can change PIN/users, wallpaper and shortcuts without editing code (config file is fine).
