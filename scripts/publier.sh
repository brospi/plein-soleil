#!/usr/bin/env bash
# Construit le site et le publie sur la branche gh-pages du dépôt distant « origin ».
set -euo pipefail
cd "$(dirname "$0")/.."
depot="$(git remote get-url origin)"
npm run build
cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C .. config user.name)" -c user.email="$(git -C .. config user.email)" commit -q -m "Publication du site ($(git -C .. rev-parse --short HEAD))"
git push -f -q "$depot" gh-pages
rm -rf .git
echo "Site publié sur la branche gh-pages."
