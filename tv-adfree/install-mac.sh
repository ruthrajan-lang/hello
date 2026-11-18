#!/usr/bin/env bash
# One-command installer for AdFree Tube (macOS).
# Usage:  ./install-mac.sh <TV_IP> [--new-cert]
set -euo pipefail
cd "$(dirname "$0")"

TS="$HOME/tizen-studio"
TS_VER="6.1"
TS_URL="https://download.tizen.org/sdk/Installer/tizen-studio_${TS_VER}/web-cli_Tizen_Studio_${TS_VER}_macos-64.bin"
export PATH="$TS/tools:$TS/tools/ide/bin:$TS/package-manager:$PATH"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
pause() { read -r -p "$1 Press Return to continue… " _; }

TV_IP=""; NEW_CERT=0
for arg in "$@"; do
  case "$arg" in
    --new-cert) NEW_CERT=1 ;;
    *) TV_IP="$arg" ;;
  esac
done
if [ -z "$TV_IP" ]; then
  echo "TV IP: on the TV, open Settings → General → Network → Network Status → IP Settings."
  read -r -p "Enter your TV's IP address: " TV_IP
fi
[ -n "$TV_IP" ] || die "A TV IP address is required."

MAC_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 'unknown')"

bold "Step 1/6: Checking prerequisites"
if [ "$(uname -m)" = "arm64" ] && ! /usr/bin/pgrep -q oahd; then
  echo "Installing Rosetta (Samsung's tools are Intel-only)…"
  softwareupdate --install-rosetta --agree-to-license
fi
if ! command -v node >/dev/null; then
  if command -v brew >/dev/null; then brew install node
  else die "Node.js is missing. Install the LTS version from https://nodejs.org, then run this again."; fi
fi
echo "OK"

bold "Step 2/6: Installing Samsung's Tizen command-line tools (first run only, about 5–10 minutes)"
if [ ! -x "$TS/tools/ide/bin/tizen" ]; then
  # Samsung's .bin runs a bundled arm64e `unzip` that macOS kills on Apple Silicon,
  # so unpack it by hand with the system unzip and run its Java installer directly.
  tmp="$(mktemp -d)"
  curl -fL --progress-bar -o "$tmp/tizen-cli.bin" "$TS_URL"
  skip="$(grep -a -m1 '^ORI_FILE_LEN=' "$tmp/tizen-cli.bin" | tr -dc '0-9')"
  mkdir -p "$tmp/x"
  tail -n +"$skip" "$tmp/tizen-cli.bin" | tar xmz -C "$tmp/x"
  rm -rf "$HOME/.package-manager/jdk" && mkdir -p "$HOME/.package-manager"
  /usr/bin/unzip -qq -o "$tmp/x/tizen-sdk.zip" 'jdk/*' -d "$HOME/.package-manager"
  JAVA="$HOME/.package-manager/jdk/Contents/Home/bin/java"
  [ -x "$JAVA" ] || die "Couldn't unpack Samsung's Java runtime."
  (cd "$tmp/x" && "$JAVA" -jar -XstartOnFirstThread installer.jar --accept-license "$TS" -path "$tmp/x")
  rm -rf "$tmp"
fi
PM="$(find "$TS" -maxdepth 4 \( -name 'package-manager-cli.bin' -o -name 'package-manager-cli' \) -type f 2>/dev/null | head -1)"
[ -n "$PM" ] || die "Tizen install failed: package manager not found in $TS."
# Certificate Manager plus Samsung's certificate add-on (needed to sign apps for real TVs).
"$PM" install --accept-license certificate-manager-product cert-add-on || \
  die "Couldn't install Samsung Certificate Manager. Re-run this script; if it fails again, open $PM's GUI and install 'Samsung Certificate Extension'."
./fix-certmgr.sh --no-open
echo "OK"

bold "Step 3/6: Connecting to the TV at $TV_IP"
echo "The TV must be in Developer Mode with Host PC IP set to this Mac: $MAC_IP"
echo "(On the TV: Apps → press 1 2 3 4 5 → Developer mode On → enter $MAC_IP → restart TV.)"
sdb disconnect "$TV_IP" >/dev/null 2>&1 || true
until sdb connect "$TV_IP" 2>&1 | grep -qi "connected"; do
  pause "Couldn't reach the TV. Check Developer Mode and that the TV is on."
done
sdb devices
echo "OK"

bold "Step 4/6: Samsung certificate"
# Assumes the certificate profile already exists. Run with --new-cert to create one.
SAVED="$HOME/.adfree-cert-profile"
PROFILE="$(cat "$SAVED" 2>/dev/null || echo adfree)"
if [ "$NEW_CERT" = "1" ]; then
  CM="$(find "$TS/tools/certificate-manager" -maxdepth 1 -iname 'certificate-manager.app' 2>/dev/null | head -1)"
  [ -n "$CM" ] || die "Certificate Manager wasn't found in $TS/tools/certificate-manager."
  cat <<EOF
Certificate Manager is opening. In it:
  1. Click + to create a profile and choose Samsung.
  2. Choose TV as the device type and give the profile any name (for example: adfree).
  3. Create a new author certificate (any name and password), then sign in with your Samsung account.
  4. Create a new distributor certificate. Keep your TV's DUID in the list (it's filled in because the TV is connected).
  5. Click Finish, then quit Certificate Manager (Cmd+Q) to continue here.
EOF
  open -W "$CM"
  read -r -p "Type the profile name you just created: " PROFILE
  [ -n "$PROFILE" ] || die "A profile name is required."
fi
echo "Using certificate profile: $PROFILE"

bold "Step 5/6: Building and signing the apps"
./package.sh "$PROFILE" || die "Signing failed. If the profile name isn't \"$PROFILE\", run: ./install-mac.sh $TV_IP --new-cert"
echo "$PROFILE" > "$SAVED"

bold "Step 6/6: Installing on the TV"
install_wgt() { # install_wgt <file> <package-id>
  if ! tizen install -n "build/$1" -s "$TV_IP:26101"; then
    echo "Install of $1 failed. Details from the TV:"
    sdb -s "$TV_IP:26101" shell 0 vd_appinstall "$2" "/home/owner/share/tmp/sdk_tools/tmp/$1" 2>&1 | tail -15 || true
    die "Paste the lines above into the chat."
  fi
}
install_wgt AdFreeTube.wgt AdFreeTube
install_wgt AdFreePluto.wgt AdFreePlut

bold "Installed. One last step on the TV:"
cat <<EOF
  1. Open Apps → Settings and press 1 2 3 4 5.
  2. Change Host PC IP from $MAC_IP to 127.0.0.1. (AdFree Tube needs this; AdFree Pluto works either way.)
  3. Restart the TV (unplug it for 30 seconds).
  4. Open "AdFree Tube" or "AdFree Pluto" from Apps.

To update later, set Host PC IP back to $MAC_IP and run this script again.
EOF
