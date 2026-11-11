# SPEC — Steins;Gate RE:BOOT shell (matches `demo/index.html`)

Reference canvas: **1280×720** (16:9), scaled to fit the screen, letterboxed black. All coordinates below are in that space.
When in doubt, `demo/index.html` wins — search for the names in `code font`.

## 0. Flow / state machine

```
POWER ON (click/key) ─► BOOT clip (46 s, audio) ─► LOCK
   skip: Ctrl+Shift+Esc (demo also: Esc)            │
                                                    ├─ NEW GAME ─► create-user dialog ─► user list
LOCK (loop video + music + overlay buttons)         ├─ CONTINUE ─► LOAD / QUICK LOAD
   EXIT GAME ─► black "POWER ON" screen             │       LOAD ─► user list ─► PIN
                                                    │       QUICK LOAD ─► PIN for last user
PIN (nixie tubes) ── correct ─► UNLOCK clip (54.4 s, audio) ─► HOME
                  └─ wrong ─► shake + flicker, clear
HOME = wallpaper + date badge only (no buttons)
   Alt+C console app · Alt+P phone app · `lock` (console) ─► BOOT clip ─► LOCK
```
Demo stage ids: `boot lock users pw unlock home phone console` (`stage()`/`go()` in the script).

## 1. Media

| Clip | Use | Notes |
|---|---|---|
| `boot.webm` 46.07 s, audio | "turn off → lock screen" transition: power-on, and when locking from home | from the game's intro (space, quote, logo flare). Skippable. |
| `lock_loop.webm` 3.21 s, **muted in use** | lock-screen background, looped | satellite + title art with the game's menu **baked in** (NEW GAME highlighted). Cross-faded seam. Mouse cursor removed. |
| `lock_music.ogg` 22.9 s | lock-screen music ("Gate of Steiner"), looped, volume 0.85 | cross-faded loop. Plays on LOCK, user list, PIN. Stops when the unlock clip starts. |
| `unlock.webm` 54.43 s, audio | after correct PIN, "lock → home" movie | original range 0:19–1:27 played at **1.25×**. Skippable. |
| `wallpaper.webp` 2000×1126 | home wallpaper | black-and-white Steins;Gate logo with ring |

Browsers/OSes need a user gesture before audio plays; on Linux this is not an issue for a native player.

## 2. Lock screen (stage `lock`)

The video already contains the game's menu art; **transparent hit areas** sit on top and draw highlights over it.

Main items (`IT` in the script) — `[label, x, y, w, h]`:
`NEW GAME 143,517,180,34` · `CONTINUE 394,517,178,34` · `EXTRA 640,517,122,34` · `CONFIG 824,517,130,34` ·
`HELP 1017,517,96,34` · `EXIT GAME 1070,16,196,40`. Baked "Enter" pill ≈ `1062,655,85,34` (activates), "Back" ≈ `1150,655,85,34` (closes dialogs/sub-menu).

Look: font **Archivo Black** 31 px (EXIT GAME 38 px), letter-spacing −0.045em.
- selected: background **#f7a600**, text black, 2 px black outline box.
- NEW GAME is *baked highlighted* → when something else is selected, cover it with a dark patch (`#06080a`, text `#eee`, 4 px black stroke + 2 px offset shadow).
- Default selection: NEW GAME. Arrow ←/→ cycle the five, ↑ = EXIT GAME, ↓ back, Enter activates, Esc closes.
- Menu text elsewhere has a thin hard black outline + 2 px offset shadow (game style).

**CONTINUE → sub-menu** (`openSub()`): CONTINUE becomes a black box with 2 px `#e8e8e8` border and `#666` text; NEW GAME/EXTRA/CONFIG/HELP become dim black boxes with `#555` text;
EXIT GAME unchanged. Two sub-items appear below with a white bracket line (`372,532 22×2`, `372,532 2×60`, `372,591 22×2`, colour `#e8e8e8`):
`LOAD 394,577,96,32` (default, orange) and `QUICK LOAD 540,577,206,32` (black box, `#d4d4d4` text, 2 px border). ←/→ switch, Enter/click activate, Esc closes.
EXTRA / CONFIG / HELP currently only show a "not wired" toast.

**NEW GAME → create user**: dialog (580 px wide, `rgba(8,22,20,.94)`, 3 px white top line with magenta/cyan hairlines) with *user name* (≤14 chars) and *4-digit PIN*.
Validation: name required, PIN exactly 4 digits, no duplicate names. On success → user list.

**LOAD → user list**: "SAVE DATA 01 / name" slots (face tile with the initial). Click one → PIN.
**QUICK LOAD**: last user who opened the PIN screen (`sg_last`), else the first user → PIN.
Default user: `okabe` / `4094`.

## 3. PIN screen (nixie meter)

Panel centred over the lock screen. **Eight tubes** read `0 . d1 d2 d3 d4 3 1`: tube 0 = `0`, tube 1 = lit decimal dot (low-left), tubes 2–5 = the PIN digits as they are typed, tubes 6–7 = `3`,`1`.
Unlit tubes show faint overlapping "ghost" digits and a diagonal mesh. Digits are **wire-filament glyphs** drawn as SVG paths (`GL` object, viewBox 60×100): stroke `#ffc15a` 2.4 px, round caps, plus a blurred `#ff6a00` 6 px under-stroke (opacity .45) and `drop-shadow` glow; subtle flicker animation.
Keys: 0–9 add a digit (beep rising per digit), Backspace removes, Enter submits, **auto-submit 350 ms after the 4th digit**, Esc back.
Wrong PIN: panel shakes (0.4 s), message "Wrong PIN. The worldline did not change.", the four digit tubes flicker random digits for 8×60 ms, then clear.
Correct PIN: "Reading Steiner … authenticated" → unlock clip.

## 4. Unlock clip → Home

`unlock.webm` full-screen (object-fit: cover), audio on, lock music stopped. Hint chip bottom-right "Ctrl+Shift+Esc — skip". On end or skip → HOME.

## 5. Home screen

Wallpaper (`cover`) + **date badge** top-left: `#f4f4f4`, radius 0/12/12/0, text `M.D` (38 px, 800) + small `(DDD)`; slides in from the left (0.7 s, 0.2 s delay, `cubic-bezier(.2,.9,.25,1)`).
**No buttons, no console, no phone** until opened. (Demo-only top bar with stage buttons and a BG switcher is a *debug aid*, not part of the product.)

## 6. Console app (Alt+C)

Game text-bar look: bar at the bottom, 200 px high, `rgba(8,22,20,.80)`, 3 px white top line with magenta (above) / cyan (below) 1 px fringe, circuit-line decoration bottom-centre.
Bottom-left chips `SYSTEM · AUTO · SKIP` (cyan 2 px border + magenta 2 px offset shadow), right-hand white skewed `➔AUTO` tab. Output text Bahnschrift/sans 24 px with typewriter effect (tiny tick sound), orange `>` prompt echo.
States: normal 200 px · **tall** 480 px · small 56 px · **float** (pop-out window 760×300 at left 150, bottom 90) · free resize by dragging the top edge (56–640 px). Buttons ▲ (extend up) ▼ (minimise) ⧉ (pop out/dock). Alt+C toggles, Esc closes.
Commands: `help date whoami worldline phone tall small float clear lock` and `el psy kongroo`.
In the real build the console is a **real terminal** (VTE) with this skin; the owner asked for it to extend up or down, inside or outside (docked vs floating).

## 7. Phone Trigger (Alt+P)

**Animation**: rises from the bottom edge, does a **360° flip around the X axis**, settles on the right: `translateY(1100px) → (55%) translateY(150px) rotateX(-360deg) → translateY(0)`, 1.2 s, `cubic-bezier(.2,.75,.25,1)`, `perspective(1400px)`. Final: right edge 51 px from the screen edge, top 10 px, scaled ×1.18 (so ≈ 354×730 px; the bottom is cropped by the screen edge, like the game).
**Look** (see `reference/phone-*.webp`): navy truss on top (zig-zag + posts, `#1b2352`), coral body `#f45b5e` with camera dot + speaker slot, black screen frame, status row (signal · mail · battery), screen, grey strip with blue lens, 4 keys (mail · gear · book · camera), dark lower part with d-pad outline shapes.
**Screen home** (`window.phHome`): blue gradient (160°, `#2f72e6 → #0c3ca4 → #0a2c86`), big "MENU" (Archivo Black 54 px, `rgba(160,185,215,.88)`), faint "E=mc²", cyan circuit lines, 2×2 icons (60 px dark circles, orange ring on hover): **MAIL, Contacts, Network, Settings**.
Apps: *MAIL* = "Send Mail" compose (blue title bar, orange To/Sub labels `#e8761c`, body, Save draft / Send) · *Contacts* = list (orange selected row `#f7a600`) → chat view · *Network* = Wi-Fi (shows SSID), Bluetooth, Airplane mode toggles + **WhatsApp** · *Settings* = Energy saver toggle, brightness + volume sliders, Accessibility, Studio effects.
Keys: ✉ → mail, gear → settings, book → contacts, camera → MENU home.
The owner's original intent: replace the GNOME quick-settings panel (Wi-Fi, Bluetooth, airplane, energy saver, accessibility, brightness/volume) with this phone, plus **draft/send mail and use WhatsApp from it**.

## 8. Fonts & colours

Fonts: *IM Fell English* (logo/serif), *Archivo Black* (menu, MENU), *Special Elite* (typewriter quote), *Nixie One* (not used for the final digits — they are SVG paths), Bahnschrift/Segoe → `Inter`/`DejaVu Sans` fallback on Linux.
Colours: orange `#f7a600`, cyan `#35e0e6`, magenta `#e83f8f`, UI panel `rgba(8,22,20,.80–.94)`, phone coral `#f45b5e`, truss navy `#1b2352`, nixie `#ffc15a / #ff6a00`.

## 9. Sounds (WebAudio beeps in the demo)

Short square-wave blips for hover/select (~1.1 kHz), digit entry (rising 980 Hz+), wrong PIN (160 Hz saw), phone open (1.5 kHz) / close (600 Hz), console typewriter ticks (~1.5 kHz, 12 ms). Replace with a small sound set if desired.
