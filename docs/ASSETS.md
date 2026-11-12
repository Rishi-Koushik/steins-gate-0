# ASSETS

All media were produced from the owner's own screen recordings (1080p-class captures at 2304×1440 with 72 px black bars top and bottom).
The original recordings are **not** in this zip (≈ 1 GB). Re-cut commands are below if the owner copies them over.

| File | Duration | Source (owner's recording) | Processing |
|---|---|---|---|
| `demo/media/lock_loop.webm` | 3.21 s | `STEINS;GATE RE_BOOT 2026-11-11 05-00-29.mp4`, 0:00.9–0:04.6 | crop bars, 1280×720, 30 fps, **mouse cursor removed** (`delogo`), 0.5 s cross-faded seam → seamless loop, VP9 + Opus |
| `demo/media/boot.webm` | 46.07 s | same recording, 2:31–3:17 | crop bars, 1280×720, 30 fps, VP9 CRF 33 + Opus 112k |
| `demo/media/unlock.webm` | 54.43 s | `2nd vid.mp4`, 0:19–1:27 | crop bars, 1280×720, 30 fps, **1.25× speed** (video `setpts`, audio `atempo`), VP9 CRF 33 + Opus 112k |
| `demo/media/lock_music.ogg` | 22.9 s | `Gate of Steiner • ACN Music. — Lelouch — Mozilla Firefox 2026-11-11 05-39-40.mp4`, 0:07.6–0:32 | audio only, 1.5 s cross-faded loop, Opus 128k |
| `demo/wallpaper.webp` | — | owner's screenshot (Steins;Gate logo with ring), black bars cropped to 2000×1126 | WebP |

Notes
- The **lock loop is only 3.2 s** and silent; the music is separate (22.9 s loop) so the audio doesn't feel looped. A longer idle capture (30–60 s) and a full track would be better — ask the owner.
- The loop uses only the part of the recording where *NEW GAME* is the highlighted item (the baked highlight changes after ≈4.8 s) and where the mouse cursor is static (≥ 0.9 s).
- The game's own `.webm`/`.bin` archives are encrypted and were **not** touched; do not try to decrypt them.

## Re-cutting from the recordings (reference — adjust paths)

```bash
# crop = 2304:1296:0:72 (16:9 inside the 16:10 capture)
# lock loop (cursor removed, 0.5 s cross-fade loop)
ffmpeg -ss 0 -t 4.8 -i "STEINS;GATE RE_BOOT 2026-11-11 05-00-29.mp4" -filter_complex \
 "[0:v]crop=2304:1296:0:72,scale=1280:720,fps=30,delogo=x=657:y=158:w=22:h=28,trim=start=0.9:end=4.6,setpts=PTS-STARTPTS,split=3[a][b][c];\
  [a]trim=start=0.5:end=3.2,setpts=PTS-STARTPTS[m];[b]trim=start=3.2:end=3.7,setpts=PTS-STARTPTS[t];[c]trim=start=0:end=0.5,setpts=PTS-STARTPTS[h];\
  [t][h]xfade=transition=fade:duration=0.5:offset=0[x];[m][x]concat=n=2:v=1:a=0[v]" -map "[v]" -an \
 -c:v libvpx-vp9 -crf 26 -b:v 0 -row-mt 1 lock_loop.webm

# boot / turn-off→lock clip
ffmpeg -ss 151 -t 46 -i "STEINS;GATE RE_BOOT 2026-11-11 05-00-29.mp4" -vf "crop=2304:1296:0:72,scale=1280:720,fps=30" \
 -c:v libvpx-vp9 -crf 33 -b:v 0 -row-mt 1 -c:a libopus -b:a 112k boot.webm

# unlock clip at 1.25x
ffmpeg -ss 19 -t 68 -i "2nd vid.mp4" -filter_complex \
 "[0:v]crop=2304:1296:0:72,scale=1280:720,fps=30,setpts=(PTS-STARTPTS)/1.25[v];[0:a]atempo=1.25[a]" -map "[v]" -map "[a]" \
 -c:v libvpx-vp9 -crf 33 -b:v 0 -row-mt 1 -c:a libopus -b:a 112k unlock.webm
```
Higher quality for a native build: re-encode from the originals at 1920×1080 (or keep native resolution) with H.264/VP9 as the player prefers.

## Reference images (`reference/`)

`menu-lock-screen.webp` (title/menu look) · `menu-outline-text.webp` (outlined menu text) · `menu-continue-submenu.webp` (CONTINUE → LOAD / QUICK LOAD) ·
`phone-send-mail.png`, `phone-in-game.webp` (phone look) · `nixie-tubes.png`, `nixie-meter-photo.png` (divergence meter) · `logo-crop.png` ·
`wallpaper-current.webp`, `wallpaper-previous.webp` · `windows-quick-settings.png` (the panel the phone replaces) · `console-text-bar.webp` (the bar the console imitates).

## Sound pack (optional, yours to supply)

Drop audio files into `~/.local/share/sg-shell/sounds/pack/`. The file name (without extension) decides
where it plays; anything missing falls back to the built-in beep or to silence. Lock-screen and home
sounds go through the desktop's event-sound player, so use **`.ogg` or `.wav`** there; the phone also
plays `.mp3`, `.opus`, `.flac` and `.m4a`.

| File name | Plays |
|---|---|
| `ambience` | looped quietly on the lock screen (cicadas, CRT hum …); volume: `[lock] ambience_volume` |
| `hover`, `select`, `back`, `ok`, `wrong`, `digit1` … `digit4` | replace the lock screen's built-in beeps of the same name |
| `dmail` | a D-Mail appears on the lock screen |
| `crt` | the desktop appears after the first unlock of a session (a Braun-tube click fits) |
| `upa` | an Upa capsule is caught |
| `phone_open`, `phone_close` | the phone rises / drops |
| `mail`, `call` | mail arrives / Amadeus rings, when no ringtone is chosen in the phone's settings |

