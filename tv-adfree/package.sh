#!/usr/bin/env bash
# Builds both apps, stages only the files the TV needs, and signs them.
# Usage: ./package.sh <certificate-profile-name>
# Output: build/AdFreeTube.wgt and build/AdFreePluto.wgt
set -euo pipefail
cd "$(dirname "$0")"
PROFILE="${1:?Pass your Samsung certificate profile name (from Tizen Certificate Manager)}"

(cd service && npm install --no-audit --no-fund && npm run build)
rm -rf build stage && mkdir -p build

# sign <stage-dir> <output-name>: Samsung's installer fails on names with spaces, so rename.
sign() {
  tizen package -t wgt -s "$PROFILE" -- "$1"
  mv "$1"/*.wgt "build/$2"
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

rm -rf stage
