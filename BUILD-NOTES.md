# BUILD-NOTES — the real GNOME build (`shell/`)

Built and tested on this machine: Arch Linux, GNOME Shell 50.5 on Wayland, GDM 50.3, 2560×1600 @ 1.33×.

## Install / remove

    ./install.sh                 # files + wallpaper + Alt+C / Alt+P + enable the extension (no sudo)
    ./install.sh --apply-settings  # after editing ~/.config/sg-shell/config.toml
    ./uninstall.sh               # restore wallpaper, shortcuts and the stock lock screen

**Log out and back in once after installing**: on Wayland a new shell extension only loads at login.
Until then the wallpaper, console and phone work, but the date badge, window docking and lock screen do not.

## What is where

| Piece | Implementation |
|---|---|
| Lock screen | `shell/extension/sg-shell@amadeus.local` (`lock.js`, `video.js`, `nixie.js`). Runs in `unlock-dialog` mode and draws on top of GNOME's own `UnlockDialog`. |
| Date badge, window docking | same extension (`badge.js`, `windows.js`) |
| Console (Alt+C) | `shell/apps/sg-console` — GTK4 + VTE, a real shell |
| Phone (Alt+P) | `shell/apps/sg-phone` + `shell/apps/phone/index.html` — GTK4 + WebKitGTK |
| Unlock movie | `shell/apps/sg-clip` — started by the extension after a successful unlock |
| Power-on (root) | `shell/system/install-boot.sh` — Plymouth splash, GRUB `splash` + hidden menu, GDM auto-login. **Prepared, not installed**: run it with sudo |
| Config | `~/.config/sg-shell/config.toml` (template: `shell/config.toml`) |

## Decisions taken (change them in config.toml)

- **Lock strategy A** from LINUX-INTEGRATION.md. PAM, GDM and `/usr/share/gnome-shell` are untouched: the
  nixie panel hands what you type to GNOME's stock `AuthPrompt`, so the account password is still the secret.
- **`auth_mode = "password"`** by default: type the account password on the nixie panel and press Enter;
  digits show on the tubes as you type them (other characters glow as a dot; a longer password shows
  its last four). For the 4-digit experience, change the account password to the PIN
  (`passwd`) and set `auth_mode = "pin"` — digits then show on the tubes and submit after the 4th.
  Nothing is stored by the SG shell in either mode.
- **`auth_mode = "none"`** (the owner's choice, now set): the lock screen asks for nothing. Selecting the
  save spins the tubes to 1.048596 and the extension opens the session itself (`screenShield.deactivate`).
  The account password is unchanged, so sudo, text consoles and the F12 stock prompt still ask for it;
  the lock screen is then a title screen, not protection.
- **`title_screen = false`** (now set): the title menu is gone. Lock screen = boot clip (at login / `lock`)
  → nixie panel on black, tubes spin to 1.048596 → unlock movie → home. `true` brings the menu back.
- **faillock**: this machine uses the Arch default (`pam_faillock`, 3 wrong tries → 10 minutes). That already
  covers the "cheap safeguard" in CLAUDE.md; with a 4-digit PIN keep it on.
- **Users**: the LOAD list shows the logged-in account as SAVE DATA 01 (only it can unlock its own session).
  **NEW GAME shows a notice instead of creating a Linux account** — that needs your approval and root.
- **Power-on flow** (`on_login = "always"`): the extension locks the session the moment it starts, so
  every login runs boot clip → title screen → nixie panel → unlock movie → home, like the demo. GDM
  still asks for the password first unless auto-login is on (`sudo shell/system/install-boot.sh`, step 3);
  `on_login = "autologin"` locks at login only in that case, `"never"` turns it off.
- **Shortcuts**: Alt+C console, Alt+P phone, as in the spec. The **Copilot key** toggles the phone too
  (`copilot_key` under `[shortcuts]`); it is really Shift+Super+F23, bound in three spellings. (Super+P cannot be bound — GNOME reserves
  it for display switching — which is why the phone never opened while it was set to that.)
- **Boot clip** (`boot_clip = "manual"`): plays on the lock screen at login, after the console `lock`
  command and after EXIT GAME → POWER ON; an idle auto-lock goes straight to the title screen. The clip plays *inside* the
  lock screen rather than before locking, so the session is never left unlocked behind a movie.
- **Mail**: Send hands the draft to the default `mailto:` handler (no mail client is installed here yet);
  drafts are `.eml` files in `~/.local/share/sg-shell/drafts/`.
- **Brightness** goes through logind (`SetBrightness` on `intel_backlight`): GNOME 50 has no public D-Bus
  brightness API, so GNOME's own slider does not follow the phone's.
- **Console Esc**: not bound to "close", because a real terminal needs Esc (vim, readline). Alt+C or SKIP closes it.
- EXTRA / CONFIG stay "not wired", as in the spec. Studio effects has no GNOME equivalent and says so.
- GNOME's top bar and quick-settings menu are left in place; the phone is an addition, not a replacement.

## Amadeus (phone → Amadeus)

Makise Kurisu as an AI you can talk to, in `shell/apps/amadeus/`, one file per section:

| Section | File | What it holds |
|---|---|---|
| Personality | `personality.py` | Character sheet (editable copy: `~/.config/sg-shell/amadeus/personality.md`), emotion → picture |
| Memory | `memory.py` | Long-term notes she saves herself + the running conversation (`~/.local/share/sg-shell/amadeus/memory.json`) |
| Thinking | `thinking.py` | Google Gemini Flash over HTTPS (free-tier keys, rotated when one is rate-limited) and the file tools |

- **API keys**: paste them on the phone (Amadeus → ⚙). Stored in `~/.config/sg-shell/amadeus/keys` (mode 600), never in the repo.
- **Emotions**: every reply carries `[emotion:NAME]` tags; the phone shows the picture with that name and the
  name as a label. Only `neutral` ships. Add `smile.webp`, `angry.png`, … to
  `~/.local/share/sg-shell/amadeus/emotions/`; a missing picture falls back to the nearest one, then neutral.
- **Full-size view** (default skin): opening Amadeus drops the phone out of sight (`phoneOut`) and a glass
  panel (`#amx` in `phone/index.html`) rises in the same column — big picture of her, THINKING / PERSONALITY /
  MEMORY pills, the emotion as English + Japanese label, frosted chat card. ‹ or Esc brings the phone back up;
  ⚙ / THINKING / MEMORY go to the phone's settings / memory views. While it is up the window's input region is
  the panel (`region` command in `sg-phone`). The RINE skin keeps the old in-phone chat. The Japanese labels use
  `shell/fonts/NotoSansCJKjp-AmadeusSubset.otf` (only those ~30 glyphs, cut from Noto Sans CJK JP, SIL OFL).
- **Faces** were copied from the owner's Android Amadeus app (`/sdcard/Android/data/dev.amadeus/files/emotions/`,
  13 PNGs) into `~/.local/share/sg-shell/amadeus/emotions/` — personal copies, not in the repo. `FALLBACK` in
  `personality.py` maps emotions without a picture (smile, annoyed, worried, …) onto the nearest one.
- **Files**: she can list, search and read under `[amadeus] folders` (default: home) and change files.
  With `files = "ask"` (default) each change is shown on the phone as a diff with Allow / Refuse; the
  original is copied to `~/.local/share/sg-shell/amadeus/backups/<time>/` first. She cannot run programs.
- **Privacy**: what she reads is sent to Google as part of the conversation. ssh/gpg keys, password
  stores, browser profiles, `.env`, `*.pem`/`*.key` and her own key file are refused (`DENY_*` in `thinking.py`).
- Tested here against a local stand-in for the API (tool loop, approval, backup, key rotation, model
  fallback); not yet run against Google's servers, because no key was available.

## D-Mail, inbox, calls, Upa (what talks to what)

| Piece | Implementation |
|---|---|
| D-Mail | `lock.js` stages `dmail` (compose: Tab or EXTRA) and `dmail-in` (shown before the menu / nixie panel). Stored as `dmail/ID.json` with the kernel boot id; "arrived" = written under a different boot id. `mailbox.js` holds the file helpers. |
| Inbox | One JSON file per mail in `~/.local/share/sg-shell/mail/inbox/`, so the extension (`mailbox.js`) and the phone (`sg_mailbox.py`) both add mail without sharing a file. The phone watches the folder and buzzes. |
| Notifications as mail | `home.js` connects to every `MessageTray` source's `notification-added` (unlocked session only). |
| Character mails | `sg-mail event login|build-failed|battery-low`, texts in `phone/characters.json`, cool-downs in `mail/state.json`. Login and battery come from `home.js`, build failures from the console's `sg-bashrc` prompt hook. |
| Calls | `sg-phone --call REASON [DETAIL]`. `home.js` (battery ≤ 10 %, 3 a.m. while not idle) and `sg-bashrc` (command ran ≥ `long_job_seconds`). Lines are canned (`personality.CALL_LINES`); answering adds the line to the conversation. |
| Upa | `home.js` rolls once a minute, shows a capsule as chrome above the windows (hidden under fullscreen), writes `upa/collection.json`. |
| Screenshot gadget | The phone writes `screenshot` to `$XDG_RUNTIME_DIR/sg-shell/shell-cmd`; `home.js` watches that file and opens the shell's screenshot tool. |
| Salieri | `thinking.Salieri`: Ollama's `/api/chat` on 127.0.0.1, used when Gemini raises `NetworkError` or there is no key. |

The login lock screen shows arrived D-Mails itself; D-Mails it never showed (stock lock screen, F12) are
filed into the inbox by `home.js` a minute into the session.

Tested the same way as the rest (isolated headless shell, own D-Bus session and XDG dirs): D-Mail compose,
byte limit, save, arrival and hand-over to the inbox; Lab Member badge; wrong-PIN worldline; canon line on
the badge; notification → mail; Upa drop, catch and collection; the command file; every new phone view,
replies, mail arrival, calls answered / declined / closed; Amadeus nickname, rate-limit, offline and Salieri
paths against local stand-ins for both APIs; the console hooks with stubbed `sg-mail` / `sg-phone`.
Not exercised: sound output (ringtones, sound pack, ambience), a real Ollama server, real battery and
3 a.m. triggers (the code paths were called directly), and the real 2560×1600 panel.

## Animations

Lock screen: scene cross-fades (boot ↔ title), dialogs fade/settle in, toast fades, POWER ON blinks,
lit nixie tubes flicker, wrong-secret shake. Console: slides up on open, slides down on close, rises
when switching to tall. Phone: rise + 360° flip (in `phone/index.html`). Date badge: slides in.
The console animations move the surface *inside* the window actor: GNOME's own window-open effect
resets the window actor's translation when it ends, which is what silently cancelled the old slide-in.
They follow GNOME's "Reduce motion" setting.

## Aspect ratio

The clips and the title screen are 16:9; this panel is 16:10. `fit = "contain"` (default) shows the
whole picture with black bars above and below; `"cover"` fills the screen and crops 5 % per side. When the title screen is cropped it stays
centred like the clips; EXIT GAME and the Enter / Back pills, which the right edge would cut, are
redrawn a little further in. The unlock movie follows the same setting; the Plymouth splash covers.

## Recovery (lock screen)

- **F12 on the lock screen** hides the themed overlay and shows GNOME's stock unlock prompt.
- If the overlay fails to build, it is dropped and the stock lock screen is what you get.
- Disable it: `enabled = false` under `[lock]` in config.toml (read the next time the screen locks), or
  `gnome-extensions disable sg-shell@amadeus.local`. Both also work from a TTY (Ctrl+Alt+F3) if you are
  stuck at the lock screen; switch back with Ctrl+Alt+F2 and unlock with the stock prompt.
- `./uninstall.sh` removes everything and restores the previous wallpaper.
- Boot: `sudo shell/system/uninstall-boot.sh` restores GRUB, GDM and mkinitcpio from their `*.sg-backup`
  copies. If the splash ever blocks booting: Esc at power-on → `e` on the Arch entry → add
  `plymouth.enable=0` to the `linux` line → Ctrl+X.

## How it was tested

In an isolated headless shell (`gnome-shell --headless --virtual-monitor 1920x1200` under its own D-Bus
session and XDG dirs), not in the live session: locking, wake-up, menu and sub-menu navigation, user list,
nixie panel in both modes, wrong-secret animation, boot clip and skip, POWER ON, F12 fallback, unlock movie
hand-off, console docking / tall / float, phone docking and its settings bridge.

Also there: lock-at-login (boot clip starts ~1 s after the shell does), the fades, and the console
slide-in / slide-out / grow (sampled mid-transition).

Not exercised: `shell/system/install-boot.sh` (needs root), a real password submission (success and failure were simulated at the verifier-signal level,
to avoid failed PAM attempts against the account), audio output, WhatsApp login, the Plymouth theme, and
everything on the real 2560×1600 panel.
