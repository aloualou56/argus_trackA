# The game on the Raspberry Pi

The Pi (a Zero 2 W, 512 MB) only serves files; it never builds. GitHub builds and tests the game on
every push to `main` (`.github/workflows/site.yml`) and puts the finished site on the `site` branch.
The Pi checks that branch every minute and copies a new version into place; a playit.gg tunnel
makes it reachable from the internet.

```
push to main ──► GitHub Actions: data tests, web tests, build ──► branch "site" (web/dist only)
                                                                      │  every minute
Raspberry Pi: guardian-update (git fetch) ──► /var/www/guardian ──► Caddy :8080 ──► playit tunnel
```

## Pieces on the Pi

| What | Where |
|---|---|
| read-only deploy key for this repository | `~/.ssh/guardian_site`, used through the `github-guardian` host in `~/.ssh/config` (GitHub: Settings → Deploy keys) |
| one-commit clone of the `site` branch | `~/guardian-site` |
| update script | `/usr/local/bin/guardian-update` (from `guardian-update.sh`) |
| every-minute timer | `/etc/systemd/system/guardian-update.{service,timer}` |
| web server | Caddy (`/usr/local/bin/caddy`, official release), `/etc/caddy/Caddyfile` (from `Caddyfile`), `caddy-guardian.service`, port 8080 |
| what is served | `/var/www/guardian` |
| tunnel | playit agent (`playit.service`), a TCP tunnel to `127.0.0.1:8080` |

Caddy rather than nginx: the Pi runs Debian 11, whose security updates have ended, so its nginx
would be an old one; Caddy is a single current program from its own releases (`setup.sh` checks
it against the published checksums).

## Day to day

- Push to `main`: the site is live about two minutes later (Actions → "Build the site" shows the run).
  A failing test stops it; the Pi keeps serving the last good version.
- What is the Pi serving? `cat /var/www/guardian/VERSION` (the commit it was built from).
- Its log: `journalctl -u guardian-update --since today` (a line each time a new version arrives).
- Update now instead of within a minute: `sudo systemctl start guardian-update`.
- Is the web server up? `systemctl status caddy-guardian`; locally: `curl -I http://localhost:8080/`.

## Setting it up again (a fresh Pi)

```sh
sudo apt-get install -y rsync git curl
ssh-keygen -t ed25519 -N "" -C "raspberrypi guardian site" -f ~/.ssh/guardian_site
# add ~/.ssh/guardian_site.pub to the repository as a read-only deploy key, then:
cat >> ~/.ssh/config <<'EOF'
Host github-guardian
  HostName github.com
  User git
  IdentityFile ~/.ssh/guardian_site
  IdentitiesOnly yes
EOF
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts
git clone --depth 1 --branch site --single-branch git@github-guardian:aloualou56/argus_trackA.git ~/guardian-site
sudo sh setup.sh            # from a copy of this folder: Caddy, the config, the services, the timer
sudo systemctl enable --now playit   # then claim the agent and add a TCP tunnel to 127.0.0.1:8080
```

The tunnel's address is plain `http://` (a TCP tunnel), so the game's offline mode, which browsers
allow only over `https://` or on the same computer, is off there; everything else works.
