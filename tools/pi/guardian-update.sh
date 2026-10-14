#!/bin/sh
# Brings the Pi's copy of the game up to the "site" branch (built by .github/workflows/site.yml).
# Run every minute by guardian-update.timer; does nothing when nothing changed. New files are
# copied before old ones are removed, so a visitor never gets a page whose files are missing.
set -eu

CLONE=/home/hakri/guardian-site   # a one-commit clone of the "site" branch
WEB=/var/www/guardian             # what Caddy serves

cd "$CLONE"
git fetch -q --depth 1 origin site
if [ "$(git rev-parse HEAD)" = "$(git rev-parse FETCH_HEAD)" ] && [ -f "$WEB/index.html" ]; then
  exit 0
fi
git reset -q --hard FETCH_HEAD
rsync -a --delete-after --exclude .git ./ "$WEB/"
echo "guardian: now serving $(cat VERSION 2>/dev/null | cut -c1-7) ($(git log -1 --format=%cd --date=iso))"
