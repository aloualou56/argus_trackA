#!/bin/sh
# One-time setup on the Pi, run as root from a folder holding tools/pi (README.md explains it).
set -eu
CADDY=2.11.7
here=$(cd "$(dirname "$0")" && pwd)

# Caddy, from its official release, checked against the published checksums
if [ "$(/usr/local/bin/caddy version 2>/dev/null | cut -d' ' -f1)" != "v$CADDY" ]; then
  tmp=$(mktemp -d)
  base="https://github.com/caddyserver/caddy/releases/download/v$CADDY"
  curl -fsSL -o "$tmp/caddy.tar.gz" "$base/caddy_${CADDY}_linux_arm64.tar.gz"
  curl -fsSL -o "$tmp/sums.txt" "$base/caddy_${CADDY}_checksums.txt"
  want=$(grep " caddy_${CADDY}_linux_arm64.tar.gz\$" "$tmp/sums.txt" | cut -d' ' -f1)
  have=$(sha512sum "$tmp/caddy.tar.gz" | cut -d' ' -f1)
  [ -n "$want" ] && [ "$want" = "$have" ] || { echo "caddy checksum does not match" >&2; exit 1; }
  tar -xzf "$tmp/caddy.tar.gz" -C "$tmp" caddy
  install -m 755 "$tmp/caddy" /usr/local/bin/caddy
  rm -rf "$tmp"
fi
install -d -m 755 /etc/caddy
install -m 644 "$here/Caddyfile" /etc/caddy/Caddyfile
install -d -o www-data -g www-data /var/lib/caddy
install -d -o hakri -g hakri /var/www/guardian
install -m 755 "$here/guardian-update.sh" /usr/local/bin/guardian-update
install -m 644 "$here/caddy-guardian.service" "$here/guardian-update.service" "$here/guardian-update.timer" /etc/systemd/system/
/usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1
systemctl daemon-reload
systemctl enable --now caddy-guardian.service guardian-update.timer
echo "caddy $(/usr/local/bin/caddy version | cut -d' ' -f1): $(systemctl is-active caddy-guardian)"
