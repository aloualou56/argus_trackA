# The game on the Raspberry Pi

The Pi (a Zero 2 W, 512 MB) only serves files; it never builds. GitHub builds and tests the game on
every push to `main` (`.github/workflows/site.yml`) and puts the finished site on the `site` branch.
The Pi checks that branch every minute and copies a new version into place; a playit.gg tunnel
makes it reachable from the internet.

```
push to main ──► GitHub Actions: data tests, web tests, build ──► branch "site" (web/dist only)
                                                                      │  every minute
Raspberry Pi: guardian-update (git fetch) ──► /var/www/guardian ──► nginx :8080 ──► playit tunnel
```

## Pieces on the Pi

| What | Where |
|---|---|
| read-only deploy key for this repository | `~/.ssh/guardian_site` (GitHub: Settings → Deploy keys) |
| one-commit clone of the `site` branch | `~/guardian-site` |
| update script | `/usr/local/bin/guardian-update` (from `guardian-update.sh`) |
| every-minute timer | `/etc/systemd/system/guardian-update.{service,timer}` |
| web server | nginx, `/etc/nginx/sites-available/guardian` (from `nginx-guardian.conf`), port 8080 |
| what is served | `/var/www/guardian` |
| tunnel | playit agent (`playit.service`), a TCP tunnel to `127.0.0.1:8080` |

## Day to day

- Push to `main`: the site is live about two minutes later (Actions → "Build the site" shows the run).
  A failing test stops it; the Pi keeps serving the last good version.
- What is the Pi serving? `cat /var/www/guardian/VERSION` (the commit it was built from).
- Its log: `journalctl -u guardian-update --since today`.
- Update now instead of within a minute: `sudo systemctl start guardian-update`.

## Setting it up again (a fresh Pi)

```sh
sudo apt-get install -y nginx rsync git
ssh-keygen -t ed25519 -N "" -C "raspberrypi guardian site" -f ~/.ssh/guardian_site
# add ~/.ssh/guardian_site.pub to the repository as a read-only deploy key, then:
cat >> ~/.ssh/config <<'EOF'
Host github-guardian
  HostName github.com
  User git
  IdentityFile ~/.ssh/guardian_site
  IdentitiesOnly yes
EOF
git clone --depth 1 --branch site --single-branch git@github-guardian:aloualou56/argus_trackA.git ~/guardian-site
sudo install -m 755 guardian-update.sh /usr/local/bin/guardian-update
sudo install -d -o hakri -g hakri /var/www/guardian
sudo install -m 644 guardian-update.service guardian-update.timer /etc/systemd/system/
sudo install -m 644 nginx-guardian.conf /etc/nginx/sites-available/guardian
sudo ln -sf /etc/nginx/sites-available/guardian /etc/nginx/sites-enabled/guardian
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl daemon-reload && sudo systemctl enable --now guardian-update.timer
sudo systemctl enable --now playit   # then claim the agent and add a TCP tunnel to 127.0.0.1:8080
```

The tunnel's address is plain `http://` (a TCP tunnel), so the game's offline mode, which browsers
allow only over `https://` or on the same computer, is off there; everything else works.
