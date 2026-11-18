#!/usr/bin/env bash
# The project lives on the Windows drive (slow for Node in WSL). Build/deploy from a Linux-side mirror.
# Usage: scripts/sync.sh            -> sync source to ~/hindsight-build and install deps if needed
#        scripts/sync.sh <forge args> -> sync, then run forge there (e.g. scripts/sync.sh deploy)
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="$HOME/hindsight-build"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use 22 >/dev/null
[ -f "$HOME/.forge-env" ] && . "$HOME/.forge-env"
mkdir -p "$DST"
rsync -a --delete --exclude node_modules --exclude .git "$SRC/" "$DST/"
cd "$DST"
if [ ! -d node_modules ] || [ package.json -nt node_modules/.installed ]; then
  npm install --no-audit --no-fund --omit=dev >/dev/null && touch node_modules/.installed
fi
# Copy back files Forge writes (app id after register) so the Windows copy stays canonical.
sync_back() { cp "$DST/manifest.yml" "$SRC/manifest.yml"; }
trap sync_back EXIT
if [ $# -gt 0 ]; then forge "$@"; fi
