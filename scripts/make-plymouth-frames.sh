#!/usr/bin/env bash
# Turn part of boot.webm into PNG frames for a Plymouth "script" theme (Plymouth plays frames, not video, and has no audio).
# Usage: START=0 DUR=10 FPS=30 SCALE=1920:-1 scripts/make-plymouth-frames.sh [outdir]
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HERE/plymouth-theme/steinsgate}"; mkdir -p "$OUT"
START="${START:-0}"; DUR="${DUR:-10}"; FPS="${FPS:-30}"; SCALE="${SCALE:-1920:-1}"
ffmpeg -y -ss "$START" -t "$DUR" -i "$HERE/demo/media/boot.webm" -vf "fps=$FPS,scale=$SCALE" "$OUT/frame-%04d.png"
echo "Frames written to $OUT ($(ls "$OUT"/frame-*.png | wc -l) files)."
echo "Next: write steinsgate.plymouth + steinsgate.script (see docs/LINUX-INTEGRATION.md)."
