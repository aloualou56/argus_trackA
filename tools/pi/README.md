# The game on the Raspberry Pi

The Pi (a Zero 2 W, 512 MB) only serves files; it never builds. GitHub builds and tests the game on
every push to `main` (`.github/workflows/site.yml`) and puts the finished site on the `site` branch.
The Pi checks that branch every minute and copies a new version into place; a playit.gg tunnel
makes it reachable from the internet.

```
push to main ──► GitHub Actions: data tests, web tests, build ──► branch "site" (web/dist only)
                                                                      │  every minute
Raspberry Pi: guardian-update (git fetch) ──► /var/www/guardian ──► Caddy :8080 ──► playit tunnel
ARGUS API ──► every 15 minutes: guardian-live ──► /var/lib/guardian-live/public ──┘  (as /live/)
```

The Pi also keeps the game's first screen up to date with ARGUS ("Live from ARGUS"): see
[The newest from ARGUS](#the-newest-from-argus) below.

## Pieces on the Pi

| What | Where |
|---|---|
| read-only deploy key for this repository | `~/.ssh/guardian_site`, used through the `github-guardian` host in `~/.ssh/config` (GitHub: Settings → Deploy keys) |
| one-commit clone of the `site` branch | `~/guardian-site` |
| update script | `/usr/local/bin/guardian-update` (from `guardian-update.sh`) |
| every-minute timer | `/etc/systemd/system/guardian-update.{service,timer}` |
| web server | Caddy (`/usr/local/bin/caddy`, official release), `/etc/caddy/Caddyfile` (from `Caddyfile`), `caddy-guardian.service`, port 8080 |
| what is served | `/var/www/guardian` |
| the newest from ARGUS | `/usr/local/bin/guardian-live` (from `guardian_live.py`), run every 15 minutes by `/etc/systemd/system/guardian-live.{service,timer}` as the system user `guardian-live`; writes `/var/lib/guardian-live/state.json` and `public/argus-now.json`, which Caddy serves as `/live/argus-now.json` |
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
- The newest from ARGUS: `curl -s http://localhost:8080/live/argus-now.json | head -c 300`; its log:
  `journalctl -u guardian-live --since today` (a line when ARGUS has something new); read now:
  `sudo systemctl start guardian-live`.

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
sudo sh setup.sh            # from a copy of this folder: Caddy, its config, the services and timers
sudo systemctl enable --now playit   # then claim the agent and add a TCP tunnel to 127.0.0.1:8080
```

The tunnel's address is plain `http://` (a TCP tunnel), so the game's offline mode, which browsers
allow only over `https://` or on the same computer, is off there; everything else works.

## The newest from ARGUS

The game's data is a snapshot (October 2026), but ARGUS keeps watching: every evening its risk model
checks each danger at each monument again, and its sensors raise an alarm when a reading crosses a
limit. The first screen shows the newest of this for the chosen monument ("Live from ARGUS").

- **The Pi reads ARGUS, not the visitors' browsers.** `guardian-live` (Python, standard library)
  asks the ARGUS API (`http://api.argusservices.athenarc.gr`, read-only, no key) only for the
  records added since its last run: a page or two every 15 minutes, all of them on the very first
  run (about two minutes). It keeps the latest check of each danger and the ten newest sensor
  alarms per monument, and writes them, as ARGUS gave them, to one small file (about 20 KB).
- **The game decides what to show** (`web/src/game/live.ts`), so a new version of the game never
  needs a change on the Pi: last night's check (the dangers above "quiet", or the one nearest its
  limit), and the newest alarm the game can explain, picked by the same rules as the game's own
  alarms (`alarm_filter` in the data pack). A check older than two weeks, an alarm older than two
  months, or no file at all, and the box is not shown. Nothing is ever made up.
- **Its own user, nothing else.** It talks to the internet, so it runs as `guardian-live`, which
  can write only `/var/lib/guardian-live` (systemd sandboxing: no home, no devices, read-only
  system); the site, the deploy key and Caddy are out of its reach. If ARGUS is down it logs the
  error and the last good file stays.
- **Outside the site's folder.** Every new version of the site replaces `/var/www/guardian`, so the
  file lives in `/var/lib/guardian-live/public` and Caddy serves it as `/live/` (`Caddyfile`).
- The game's offline copy never stores it (`web/sw-template.js`): offline, the box just is not there.
