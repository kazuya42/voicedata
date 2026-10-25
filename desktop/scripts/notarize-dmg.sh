#!/usr/bin/env bash
# Signiert, notarisiert und „staplet“ die DMG(s) in release/ – electron-builder notarisiert nur die App.
# Damit akzeptiert Gatekeeper auch die heruntergeladene DMG-Datei selbst.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${APPLE_KEYCHAIN_PROFILE:-voicedata-notary}"
IDENTITY="Developer ID Application: Ilja Naroska (QCXF9R86DK)"
VERSION="$(node -p "require('$ROOT/package.json').version")"

shopt -s nullglob
dmgs=("$ROOT/release/"*"-$VERSION-arm64.dmg")
if [[ ${#dmgs[@]} -eq 0 ]]; then
  echo "Keine DMG für Version $VERSION in release/ gefunden" >&2
  exit 1
fi

for dmg in "${dmgs[@]}"; do
  codesign --force --timestamp --sign "$IDENTITY" "$dmg"
  xcrun notarytool submit "$dmg" --keychain-profile "$PROFILE" --wait
  xcrun stapler staple "$dmg"
  spctl -a -t open --context context:primary-signature -v "$dmg"
done
