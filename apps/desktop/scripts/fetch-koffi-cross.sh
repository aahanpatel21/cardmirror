#!/bin/bash
# Fetch koffi's NON-HOST platform prebuilds into node_modules.
#
# Why: koffi resolves its native module from per-platform
# @koromix/koffi-<platform>-<arch> packages declared as
# optionalDependencies — and npm only installs the HOST platform's one.
# A Windows or Linux artifact cross-built on the mac therefore ships
# without its koffi binary and crashes at startup with "Cannot find the
# native Koffi module" (field error, 2026-07-16, Windows VM).
#
# electron-builder bundles whatever @koromix/* packages exist in
# node_modules (asarUnpack'd), so materializing them here is the whole
# fix. Versions are pinned to the installed koffi's own version.
# Idempotent; run as part of dist/release (see package.json scripts).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f "node_modules/koffi/package.json" ]; then
  echo "koffi not found in apps/desktop/node_modules. Installing desktop dependencies..."
  npm install
fi

if [ ! -f "node_modules/koffi/package.json" ]; then
  echo "Error: apps/desktop/node_modules/koffi/package.json not found." >&2
  echo "Please run 'npm run desktop:install' from the repository root." >&2
  exit 1
fi

KOFFI_VERSION=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/koffi/package.json','utf8')).version")

for pkg in koffi-win32-x64 koffi-linux-x64 koffi-darwin-arm64 koffi-darwin-x64; do
  dest="node_modules/@koromix/$pkg"
  if [ -d "$dest" ]; then
    have=$(node -p "JSON.parse(require('fs').readFileSync('$dest/package.json','utf8')).version" 2>/dev/null || echo none)
    if [ "$have" = "$KOFFI_VERSION" ]; then
      echo "koffi-cross: $pkg@$have present"
      continue
    fi
    rm -rf "$dest"
  fi
  echo "koffi-cross: fetching @koromix/$pkg@$KOFFI_VERSION"
  tmp=$(mktemp -d)
  if (cd "$tmp" && npm pack "@koromix/$pkg@$KOFFI_VERSION" >/dev/null && tar -xzf ./*.tgz); then
    mkdir -p "$dest"
    cp -R "$tmp/package/." "$dest/"
  else
    echo "koffi-cross: warning: failed to fetch @koromix/$pkg@$KOFFI_VERSION (network offline?)" >&2
  fi
  rm -rf "$tmp"
done
echo "koffi-cross: done"
