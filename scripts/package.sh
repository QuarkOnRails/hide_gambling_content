#!/usr/bin/env bash
# Builds two archives in dist/:
#   hide-gambling-content-<version>-chrome.zip   for the Chrome Web Store
#   hide-gambling-content-<version>-firefox.zip  for addons.mozilla.org
# They differ only in the manifest: the Chrome one drops the Firefox-only
# browser_specific_settings key, which Chrome reports as unrecognised.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./manifest.json').version")
chrome="dist/hide-gambling-content-${version}-chrome.zip"
firefox="dist/hide-gambling-content-${version}-firefox.zip"

node --test test/*.test.js > /dev/null || { echo "Unit tests failed; not packaging." >&2; exit 1; }

mkdir -p dist
rm -f "$chrome" "$firefox"
zip -r -q -X "$firefox" manifest.json src data icons -x '*.DS_Store'

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
node -e "const m = require('./manifest.json'); delete m.browser_specific_settings; process.stdout.write(JSON.stringify(m, null, 2) + '\n')" > "$stage/manifest.json"
cp -R src data icons "$stage/"
(cd "$stage" && zip -r -q -X - manifest.json src data icons -x '*.DS_Store') > "$chrome"

echo "Wrote $chrome ($(du -h "$chrome" | cut -f1))"
echo "Wrote $firefox ($(du -h "$firefox" | cut -f1))"
