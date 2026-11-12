# Extra GNOME Shell extensions

Two extensions that go with the Steins;Gate shell. They are separate from `sg-shell@amadeus.local` and
`install.sh` does not install them. Built for GNOME Shell 50 on Wayland.

| Extension | What it does |
|---|---|
| `notch@local` | Replaces the top bar with a black dynamic-island notch under the camera. Compact: now playing or the clock. Click: it opens into Quick Settings (Wi-Fi, Bluetooth, sliders, power) on the left and the focused app, media controls and every open window on the right. **☾ AFK** next to CONTROLS blanks the screen to pure black and keeps the laptop awake (idle and suspend are inhibited, the cursor is hidden); any key or click comes back. |
| `drawer@local` | Takes over the Super key: a microwave oven slides in from the left, its door swings open, and the apps are inside, most used first. The green LCD is the search box; arrows move, Enter launches, Esc clears or closes, and Super closes it again. |

## Install

Link them into place, log out and back in (Wayland only loads new extension code at login), then enable them:

```bash
for e in notch@local drawer@local; do
    ln -sfn "$PWD/gnome-extensions/$e" ~/.local/share/gnome-shell/extensions/$e
done
gnome-extensions enable notch@local
gnome-extensions enable drawer@local
```

## Geometry

The notch and the oven are positioned on a 1920×1200 logical reference screen and scaled to the real
monitor. `tools/coord_grid.py` is the full-screen grid used to measure the shapes (it saves to `~/notch/coords.json`); `tools/coords.json` holds the measurements they were built from.
