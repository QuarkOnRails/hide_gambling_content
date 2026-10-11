#!/usr/bin/env bash
# Builds dist/hide-gambling-content-<version>.zip. The same archive works for Chrome
# (Web Store / "Load unpacked" after unzipping) and Firefox (AMO signing).
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./manifest.json').version")
out="dist/hide-gambling-content-${version}.zip"

node --test test/*.test.js > /dev/null || { echo "Unit tests failed; not packaging." >&2; exit 1; }

mkdir -p dist
rm -f "$out"
zip -r -q -X "$out" manifest.json src data icons -x '*.DS_Store'
echo "Wrote $out ($(du -h "$out" | cut -f1))"
