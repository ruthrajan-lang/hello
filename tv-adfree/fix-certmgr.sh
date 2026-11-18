#!/usr/bin/env bash
# Installs Samsung's Certificate Manager app directly when the package manager
# only installed the certificate add-on (leaving an app with no executable).
set -euo pipefail
TS="$HOME/tizen-studio"
CM_DIR="$TS/tools/certificate-manager"
URL="https://download.tizen.org/sdk/tizenstudio/official/binary/certificate-manager-product_1.3.11_macos-64.zip"

APP="$(find "$CM_DIR" -maxdepth 1 -iname 'certificate-manager.app' 2>/dev/null | head -1)"
if [ -n "$APP" ] && [ -x "$APP/Contents/MacOS/CertificateManager" ]; then
  echo "Certificate Manager is already installed."; exit 0
fi

echo "Downloading Certificate Manager from Samsung…"
tmp="$(mktemp -d)"
curl -fL --progress-bar -o "$tmp/cm.zip" "$URL"
/usr/bin/unzip -qq -o "$tmp/cm.zip" 'data/*' -d "$tmp"
mkdir -p "$CM_DIR"
# macOS folders ignore upper/lower case, so this merges into the existing app folder.
APP="${APP:-$CM_DIR/certificate-manager.app}"
mkdir -p "$APP"
cp -R "$tmp/data/tools/certificate-manager/certificate-manager.app/." "$APP/"
chmod +x "$APP/Contents/MacOS/"*

# Make sure Eclipse loads Samsung's add-on: the dropins folder is scanned at startup.
ECL="$APP/Contents/Eclipse"
if ls "$ECL"/plugins/org.tizen.common.cert_*.jar >/dev/null 2>&1; then
  mkdir -p "$ECL/dropins/cert-addon/plugins" "$ECL/dropins/cert-addon/features"
  cp "$ECL"/plugins/org.tizen.common.cert_*.jar "$ECL/dropins/cert-addon/plugins/"
  cp -R "$ECL"/features/org.tizen.common.certaddon.feature_* "$ECL/dropins/cert-addon/features/" 2>/dev/null || true
fi

# Its launcher looks for Java at ~/tizen-studio/jdk; point that at Samsung's bundled runtime.
[ -e "$TS/jdk" ] || ln -s "$HOME/.package-manager/jdk" "$TS/jdk"

rm -rf "$tmp"
[ "${1:-}" = "--no-open" ] && exit 0
echo "Done. Opening Certificate Manager…"
open "$APP"
