#!/usr/bin/env bash
# Serve the reference demo and open it.   Usage: scripts/serve-demo.sh [port]
cd "$(dirname "$0")/../demo" && PORT="${1:-8765}"
echo "Demo: http://localhost:$PORT/index.html  (click once to enable sound)"
exec python -m http.server "$PORT"
