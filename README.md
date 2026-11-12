# Steins;Gate 0

A Steins;Gate themed desktop for **Arch Linux + GNOME**: a nixie-tube lock screen, a home screen that is
only the wallpaper and a date badge, a drop-down console, the in-game phone as a quick-settings panel, and
**Amadeus** — Makise Kurisu as an AI you can talk to from the phone, who can read and fix your files.

> Unofficial fan project, not affiliated with or endorsed by the makers of Steins;Gate. The code is original;
> no game footage, music or artwork is included (see [Media](#media-not-included)).

## What you get

| Piece | What it does |
|---|---|
| **Lock screen** | Boot clip, then eight nixie tubes that spin to the worldline number and open the session, then the unlock movie. A title menu and a real password / 4-digit PIN mode are config switches. |
| **Home** | Wallpaper + date badge. Nothing else. |
| **Console** (Alt+C) | Drop-down terminal styled like the game's text bar. A real shell (VTE). |
| **Phone** (Alt+P or the Copilot key) | Rises from the bottom with a flip. Mail drafts, contacts, Wi-Fi / Bluetooth / airplane mode, brightness, volume, accessibility, WhatsApp Web. |
| **Amadeus** (phone → Amadeus) | Chat with Kurisu. Her mood shows as a picture and a label. She keeps long-term notes about you, and can list, search, read and correct files — every change is shown as a diff you allow or refuse, and the original is backed up. |
| **D-Mail** (Tab on the lock screen) | Type a short message on the lock screen; it is shown there the next time the laptop boots, then filed in the phone's inbox. |
| **Inbox** (phone → MAIL) | Desktop notifications, D-Mails and mails from your contacts. Highlighted words in a contact's mail are your replies. |
| **Calls** | Amadeus rings the phone when a long command in the console ends, when the battery is nearly empty, and if you are still up at 3 a.m. |
| **Gadgets** (phone → Gadgets) | Quick toggles under their Future Gadget numbers, the Upa collection, lock / suspend / power off. |
| **Boot** (optional, root) | Plymouth splash, hidden GRUB menu, GDM auto-login. |

**Also in this repo** (`gnome-extensions/`, installed separately): a dynamic-island **notch** that replaces the
top bar (Quick Settings, media, open windows, and an **AFK** black screen that keeps the laptop awake), and a
**microwave-oven app drawer** on the Super key. See `gnome-extensions/README.md`.

## Requirements

Built and tested on Arch Linux with GNOME Shell 50 on Wayland. Other GNOME versions may need changes to the
shell extension.

**System**

- Arch Linux (or another distro with the same packages), **GNOME Shell 50**, **Wayland** session, GDM
- A 16:9 or 16:10 display (the clips are 16:9; a 16:10 panel gets black bars or a crop, your choice)

**Packages**

```bash
sudo pacman -S --needed gnome-shell gdm python python-gobject gtk4 vte4 webkitgtk-6.0 \
    gstreamer gst-plugins-base gst-plugins-good gst-plugin-gtk4 ffmpeg \
    networkmanager wireplumber bluez-utils power-profiles-daemon
```

| Needed for | Packages |
|---|---|
| Everything | `gnome-shell`, `python` (3.11 or newer), `python-gobject`, `gtk4`, `ffmpeg` |
| Lock-screen video and music | `gstreamer`, `gst-plugins-base`, `gst-plugins-good`, `gst-plugin-gtk4` (VP9 / Opus / Vorbis playback) |
| Console | `vte4` |
| Phone, WhatsApp, Amadeus screen | `webkitgtk-6.0` |
| Phone toggles | `networkmanager` (`nmcli`), `wireplumber` (`wpctl`), `bluez-utils`, `power-profiles-daemon`, `util-linux` (`rfkill`) |
| Boot splash (optional) | `plymouth`, GRUB, root access |

**For Amadeus**

- An internet connection
- Your **own** Google AI Studio API key — free at <https://aistudio.google.com/apikey>. The free tier is
  rate-limited; you can add several keys and they are rotated.
- No Python packages beyond the standard library.

No API key is included in this repository, and none is ever written into it: keys live only in
`~/.config/sg-shell/amadeus/keys` on your machine.

## Media (not included)

This repository is code only. The video clips, music, wallpaper and character art belong to the games'
rights holders and are not distributed here. Everything runs without them — those parts are just black
or silent — and you can add your own files:

| Put this file here | Used for |
|---|---|
| `demo/media/boot.webm` | Clip played before the lock screen at power-on |
| `demo/media/unlock.webm` | Movie played after unlocking |
| `demo/media/lock_loop.webm`, `demo/media/lock_music.ogg` | Title-screen background loop and music (only with `title_screen = true`) |
| `shell/media/lock_still.jpg` | Title-screen still frame (1280×720) |
| `shell/media/wallpaper.jpg` | Home wallpaper (or set `[home] wallpaper` to any image) |
| `shell/apps/amadeus/emotions/neutral.webp` | Amadeus' default face (more faces go in `~/.local/share/sg-shell/amadeus/emotions/`) |

`docs/ASSETS.md` describes the format of each clip and the ffmpeg commands used to cut them from your own
recordings. Add the files, then run `./install.sh` again.

## Install

```bash
git clone https://github.com/Rishi-Koushik/steins-gate-0.git && cd steins-gate-0
./install.sh            # no sudo; installs under ~/.local/share/sg-shell, ~/.local/bin, ~/.config/sg-shell
```

Then **log out and back in once** — on Wayland a new shell extension only loads at login.

Optional, needs root, each step asked separately and backed up:

```bash
sudo shell/system/install-boot.sh            # boot splash, GRUB, auto-login
sudo shell/system/install-boot.sh autologin  # only auto-login
```

Remove everything with `./uninstall.sh` (and `sudo shell/system/uninstall-boot.sh` for the boot parts).

## Setting up Amadeus

1. Open the phone (Alt+P) → **Amadeus** → ⚙.
2. Paste your API key and press Enter.
3. Go back and talk to her.

- **Faces**: only a neutral portrait ships. Add pictures named after the emotion — `smile.webp`,
  `angry.png`, `embarrassed.webp`, … — to `~/.local/share/sg-shell/amadeus/emotions/`.
- **Personality**: edit `~/.config/sg-shell/amadeus/personality.md`.
- **Files**: under ⚙ choose *ask before changing* (default), *change freely*, *read only* or *no file access*.
- **Privacy**: whatever she reads is sent to Google as part of the conversation. SSH / GPG keys, password
  stores, browser profiles, `.env` files and her own key file are always refused. She cannot run programs.

Her three parts live in `shell/apps/amadeus/`: `personality.py`, `memory.py`, `thinking.py`.

## D-Mail, inbox and the people who write to you

- **D-Mail**: on the lock screen press **Tab** (or choose **EXTRA** on the title menu), type up to 36 bytes,
  press Enter. Nothing happens until the laptop is started again: then the message is shown on the lock
  screen before anything else, and afterwards kept in the phone's inbox. No password is needed to write
  one, so anyone at the keyboard can leave you a note; `[dmail] enabled = false` turns it off.
- **Inbox**: every desktop notification is also filed as a mail (stored only on this machine, under
  `~/.local/share/sg-shell/mail/`; `[phone] notifications_as_mail = false` turns that off). The phone
  buzzes and rings when mail arrives while it is open. Right-click deletes a mail.
- **Contacts with character**: contacts named Mayuri, Daru and Faris write on their own: Mayuri at
  login, Daru when a build fails in the SG console, Faris when the battery drops to 20 %. The highlighted
  words in their mails are your possible replies; pick one and they answer. The texts are in
  `shell/apps/phone/characters.json`. Your own scripts can send mail too: `sg-mail send FROM SUBJECT BODY`.
- **Calls from Amadeus**: a command in the SG console that ran for two minutes or more
  (`[amadeus] long_job_seconds`), 10 % battery, and 3 a.m. A declined or unanswered call becomes a
  "Missed call" mail. `[amadeus] calls = false` turns them off.
- **Phone wallpaper and ringtone**: put pictures in `~/.local/share/sg-shell/phone/wallpapers/` and audio
  files in `~/.local/share/sg-shell/phone/ringtones/`, then pick them under phone → Settings.
- **RINE skin**: Amadeus → ⚙ → Chat skin switches the chat between the Amadeus look and green chat
  bubbles; ☺ next to the text field sends a sticker.
- **Salieri**: if Amadeus cannot be reached (no network or no API key) and [Ollama](https://ollama.com)
  is running on the laptop with a model installed, that local model answers in her place, without file
  access. See `[amadeus.salieri]`.
- **Home screen**: a line under the date badge counts down to the next of a few dates from the story
  (`[home] canon_list` takes your own); now and then an Upa capsule drops onto the screen: click it and
  it joins the collection under phone → Gadgets.
- **Sound pack**: files you put in `~/.local/share/sg-shell/sounds/pack/` replace the built-in beeps and
  add a looped room tone to the lock screen. The names are listed in `docs/ASSETS.md`.

## Configuration

Everything is in `~/.config/sg-shell/config.toml` (template: `shell/config.toml`): shortcuts, wallpaper,
lock-screen mode (`auth_mode`, `title_screen`, `boot_clip`, `fit`), the Lab Member badge, D-Mail, console,
contacts, Amadeus. A config written by an older version keeps working: missing options use their defaults
(the template `shell/config.toml` lists them all).
After changing shortcuts or the wallpaper run `./install.sh --apply-settings`.

## If the lock screen misbehaves

- **F12** on the lock screen shows GNOME's stock unlock prompt.
- From a text console (Ctrl+Alt+F3): `gnome-extensions disable sg-shell@amadeus.local`, then Ctrl+Alt+F2.
- More in `BUILD-NOTES.md` → Recovery.

## Repository map

| Path | What |
|---|---|
| `shell/` | The real GNOME build: extension, apps (console, phone, Amadeus, clip player), config, boot scripts |
| `install.sh`, `uninstall.sh` | Per-user install and removal |
| `BUILD-NOTES.md` | How each piece is built, the decisions taken, recovery |
| `demo/` | The original browser demo of the experience (`python -m http.server` inside it) |
| `docs/` | Spec, Linux integration notes, asset list |
| `CLAUDE.md` | Instructions for Claude Code when working on this project |
