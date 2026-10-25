#!/usr/bin/env bash
# Baut whisper-cli aus whisper.cpp als eigenständiges Binary (statisch gelinkt, Metal-Shader eingebettet)
# für Apple Silicon, damit die App ohne Homebrew läuft. Ergebnis: vendor/whisper-cli
# Voraussetzungen: Xcode Command Line Tools, cmake, ninja (brew install cmake ninja)
set -euo pipefail

WHISPER_VERSION="v1.9.5"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.whisper-build/whisper.cpp-$WHISPER_VERSION"
BUILD="$SRC/build-arm64"
OUT="$ROOT/vendor/whisper-cli"

if [[ ! -d "$SRC" ]]; then
  mkdir -p "$ROOT/.whisper-build"
  git clone --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp "$SRC"
fi

# GGML_NATIVE=OFF: nicht auf die CPU dieses Macs optimieren, sonst läuft das Binary evtl. nicht auf älteren M-Chips.
cmake -S "$SRC" -B "$BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF \
  -DWHISPER_SDL2=OFF
cmake --build "$BUILD" --target whisper-cli -j

mkdir -p "$(dirname "$OUT")"
cp "$BUILD/bin/whisper-cli" "$OUT"
chmod +x "$OUT"

# Darf nur System-Bibliotheken/-Frameworks referenzieren (kein /opt/homebrew).
if otool -L "$OUT" | tail -n +2 | grep -v -E '^\s+(/usr/lib/|/System/Library/)'; then
  echo "Fehler: whisper-cli hängt von Nicht-System-Bibliotheken ab" >&2
  exit 1
fi
echo "OK: $OUT ($WHISPER_VERSION)"
