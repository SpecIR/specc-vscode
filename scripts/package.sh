#!/usr/bin/env bash
# Builds the extension and creates specc-vscode-<version>.vsix in the repo root.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm install
npx tsc -p tsconfig.json
node scripts/build.js --production
npx vsce package --no-dependencies
echo "Install with: code --install-extension $(ls -t *.vsix | head -1)"
