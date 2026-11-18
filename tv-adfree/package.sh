#!/usr/bin/env bash
# Builds the service, stages only the files the TV needs, and signs a .wgt.
# Usage: ./package.sh <certificate-profile-name>
set -euo pipefail
cd "$(dirname "$0")"
PROFILE="${1:?Pass your Samsung certificate profile name (from Tizen Certificate Manager)}"

(cd service && npm install --no-audit --no-fund && npm run build)

rm -rf build && mkdir -p build/service/dist
cp config.xml index.html icon.png build/
cp service/dist/index.js build/service/dist/

tizen package -t wgt -s "$PROFILE" -- build
echo "Done: $(ls build/*.wgt)"
