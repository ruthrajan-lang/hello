#!/usr/bin/env bash
# Builds both apps, stages only the files the TV needs, and signs them.
# Usage: ./package.sh <certificate-profile-name>
# Output: build/AdFreeTube.wgt, build/AdFreePluto.wgt, build/AdFreeUpdater.wgt, build/adfree.json
set -euo pipefail
cd "$(dirname "$0")"
PROFILE="${1:?Pass your Samsung certificate profile name (from Tizen Certificate Manager)}"

(cd service && { [ -d node_modules ] || npm install --no-audit --no-fund; } && npm run build)
rm -rf stage && mkdir -p build

# sign <stage-dir> <output-name>: Samsung's installer fails on names with spaces, so rename.
# Signing starts Samsung's slow Java tool, so skip it when the app's files haven't changed.
sign() {
  local sum
  sum="$( (cd "$1" && find . -type f | LC_ALL=C sort | xargs shasum; echo "$PROFILE") | shasum | cut -d' ' -f1)"
  if [ -f "build/$2" ] && [ "$(cat "build/$2.sum" 2>/dev/null)" = "$sum" ]; then
    echo "Unchanged: build/$2"
    return
  fi
  tizen package -t wgt -s "$PROFILE" -- "$1"
  mv "$1"/*.wgt "build/$2"
  echo "$sum" > "build/$2.sum"
  echo "Built build/$2"
}

# YouTube app
mkdir -p stage/tube/service/dist
cp config.xml index.html icon.png stage/tube/
cp service/dist/index.js stage/tube/service/dist/
sign stage/tube AdFreeTube.wgt

# Pluto app (its service has no dependencies, so no build step)
mkdir -p stage/pluto/service
cp -R pluto/config.xml pluto/index.html pluto/app.js pluto/icon.png pluto/vendor stage/pluto/
cp pluto/service/index.js stage/pluto/service/
sign stage/pluto AdFreePluto.wgt

# Updater app (installs updates from the Mac so Host PC IP can stay 127.0.0.1)
mkdir -p stage/updater/service
cp updater/config.xml updater/index.html updater/icon.png stage/updater/
cp updater/service/index.js updater/service/sdb.js stage/updater/service/
sign stage/updater AdFreeUpdater.wgt

# Manifest the Updater reads when the Mac shares these files (./install-mac.sh --serve)
ver() { sed -n 's/.*<widget[^>]* version="\([0-9.]*\)".*/\1/p' "$1" | head -1; }
cat > build/adfree.json <<JSON
{ "built": "$(date '+%Y-%m-%d %H:%M')",
  "apps": [
    { "name": "AdFree Tube",    "file": "AdFreeTube.wgt",    "pkg": "AdFreeTube", "appId": "AdFreeTube.AdFreeTube",    "version": "$(ver config.xml)" },
    { "name": "AdFree Pluto",   "file": "AdFreePluto.wgt",   "pkg": "AdFreePlut", "appId": "AdFreePlut.AdFreePluto",   "version": "$(ver pluto/config.xml)" },
    { "name": "AdFree Updater", "file": "AdFreeUpdater.wgt", "pkg": "AdFreeUpdt", "appId": "AdFreeUpdt.AdFreeUpdater", "version": "$(ver updater/config.xml)" }
  ] }
JSON

rm -rf stage
