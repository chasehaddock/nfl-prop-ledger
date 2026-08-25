#!/bin/zsh
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 is required. Opening the official download page."
  open "https://nodejs.org/en/download"
  echo "Install Node.js, then double-click SETUP-MAC.command again."
  read -r "?Press Return to close."
  exit 1
fi

npm run operator:install -- --local
echo
echo "Setup finished. Complete the Chrome Load unpacked step shown above."
read -r "?Press Return to close."
