#!/usr/bin/env bash
# Local development: starts pairing server + system agent (dev mode, changes nothing) and serves the shell.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/Shared/pairing-server.js" &
node "$ROOT/Computer-OS/agent/agent.js" &
trap 'kill 0' EXIT
cd "$ROOT" && python3 -m http.server 8080 --bind 127.0.0.1 &
echo "Shell:      http://127.0.0.1:8080/Computer-OS/shell/index.html"
echo "Installer:  http://127.0.0.1:8080/Installer/installer.html  (display only unless the installer backend runs in the live ISO)"
wait
