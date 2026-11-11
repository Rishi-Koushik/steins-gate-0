#!/usr/bin/env bash
# Re-create the demo clips from the owner's ORIGINAL recordings (not included in the zip).
# Usage: REC1="/path/STEINS;GATE RE_BOOT 2026-11-11 05-00-29.mp4" REC2="/path/2nd vid.mp4" REC_SONG="/path/Gate of Steiner ... .mp4" scripts/recut-from-recordings.sh
# Optionally: OUTW=1920:1080 for higher resolution. Exact filter graphs are documented in docs/ASSETS.md.
set -euo pipefail
: "${REC1:?}" "${REC2:?}"; OUT="$(cd "$(dirname "$0")/.." && pwd)/demo/media"; W="${OUTW:-1280:720}"
V="crop=2304:1296:0:72,scale=$W,fps=30"
ffmpeg -y -ss 151 -t 46 -i "$REC1" -vf "$V" -c:v libvpx-vp9 -crf 33 -b:v 0 -row-mt 1 -c:a libopus -b:a 112k "$OUT/boot.webm"
ffmpeg -y -ss 19 -t 68 -i "$REC2" -filter_complex "[0:v]$V,setpts=(PTS-STARTPTS)/1.25[v];[0:a]atempo=1.25[a]" -map "[v]" -map "[a]" -c:v libvpx-vp9 -crf 33 -b:v 0 -row-mt 1 -c:a libopus -b:a 112k "$OUT/unlock.webm"
echo "boot.webm + unlock.webm re-cut. The lock loop (cursor removal + cross-fade) and the music loop need the longer filter graphs in docs/ASSETS.md."
