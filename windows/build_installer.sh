#!/usr/bin/env bash
# Builds windows/build/MixZhuyin-<version>-setup.exe from output/pime.
# Run `npm run build:pime` first. Needs makensis 3.x (apt install nsis).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f output/pime/index.js ]; then
  echo "output/pime/index.js is missing; run npm run build:pime first." >&2
  exit 1
fi
VERSION=$(node -p "require('./output/pime/ime.json').version")
rm -rf windows/build
mkdir -p windows/build/MixZhuyin
# Same exclusions as PIME's own installer, but keep the bundle's license file.
(cd output/pime && find . -type f \
  ! -name server.js ! -name webpack_check.js ! -name 'run_*.bat' \
  ! -name README.md \( ! -name '*.txt' -o -name 'index.js.LICENSE.txt' \) \
  -exec cp --parents {} ../../windows/build/MixZhuyin/ \;)
makensis -V3 -DVERSION="$VERSION" -DPAYLOAD="build/MixZhuyin" \
  -DOUTFILE="build/MixZhuyin-$VERSION-setup.exe" windows/MixZhuyin.nsi
ls -la "windows/build/MixZhuyin-$VERSION-setup.exe"
