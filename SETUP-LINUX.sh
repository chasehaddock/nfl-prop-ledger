#!/bin/sh
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 is required. Install it from https://nodejs.org/en/download and run this file again."
  exit 1
fi

npm run operator:install -- --local
echo "Setup finished. Complete the Chrome Load unpacked step shown above."
