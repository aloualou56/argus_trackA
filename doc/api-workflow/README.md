# Aegis: API-based workflow

How Aegis reads ARGUS's data through the ARGUS API, keeps it current, and delivers it to players.
This is a working workflow, not a design: every step below runs today, and its output can be opened.

- **The game:** <https://aloualou56.github.io/argus_trackA/>
- **The live ARGUS data the workflow publishes:** <https://aloualou56.github.io/argus_trackA/live/argus-now.json>
- **The data pack built from the ARGUS snapshot:** <https://aloualou56.github.io/argus_trackA/data/game_data.json>

## Standards used

| What | Standard | File |
|---|---|---|
| The system and everything it talks to | **C4 model, level 1: system context** | `1-context.png` / `.svg` |
| Every running part, its technology, and each connection (protocol, timing, limits) | **C4 model, level 2: containers** | `2-containers.png` / `.svg` |
| The API calls in time order, with loops, retries and fallbacks | **UML sequence diagram** | `3-sequence.png` / `.svg` |
| Every API endpoint the workflow calls | **Endpoint catalogue** (the inventory an OpenAPI description would hold) | this file, below |

The `.mmd` files are the diagrams' Mermaid source.

**Legend for the C4 diagrams:** green = person · dark blue = the system · blue = container (runs code) ·
light-blue cylinder = data store · orange = ARGUS, the data owner · grey = other external system ·
dashed = optional, not in use today. Every arrow says what is done and, in brackets, the protocol and timing.

## Endpoint catalogue

**ARGUS API**, base URL `http://api.argusservices.athenarc.gr/api`

- **Method:** `GET` only. Aegis never writes to ARGUS.
- **Paging:** `?page=N`, 15 records per page, oldest first. The response is `{ "data": [...], "meta": { "last_page", "total" } }`.
- **Authentication:** none required. An optional `ARGUS_API_TOKEN` is sent as a Bearer token if set, and is never printed or stored.
- **Identification:** every request carries a `User-Agent` that names the game.

| # | Endpoint | Called by | When | What Aegis uses from it |
|---|---|---|---|---|
| 1 | `GET /assets?page=N` | `fetch_snapshot.py` | per data update | the 5 monuments |
| 2 | `GET /asset-states?page=N` | `fetch_snapshot.py` | per data update | monument metadata; 3D model placements (`spatial_representations.model_placements`) |
| 3 | `GET /threats?page=N` | `fetch_snapshot.py` | per data update | risk scenarios (`kind: abc_risk_scenario`): key, risk category, ABC scores, priority |
| 4 | `GET /threat-contexts?page=N` | `fetch_snapshot.py`, **`guardian_live.py`** | per data update; **every 2 hours** | nightly risk checks (`kind: ira_threat_evaluation`): probability, state, thresholds |
| 5 | `GET /events?page=N` | `fetch_snapshot.py`, **`guardian_live.py`** | per data update; **every 2 hours** | AD-RT alarms: type (EK expert rule / DL AI model), rule, timestamp, value, threshold, AI feature contributions |
| 6 | `GET /policies?page=N` | `fetch_snapshot.py` | per data update | AD-RT alarm rules and their current thresholds |
| 7 | `GET /installed-instruments?page=N` | `fetch_snapshot.py` | per data update | each sensor's name (serial number, place) |
| 8 | `GET /installed-devices?page=N` | `fetch_snapshot.py` | per data update | sensor coordinates |
| 9 | `GET /instruments?page=N` | `fetch_snapshot.py` | per data update | instrument → instrument type |
| 10 | `GET /instrument-types?page=N` | `fetch_snapshot.py` | per data update | type names, matched to the game's sensor cards |
| 11 | `GET /decisions?page=N` | `fetch_snapshot.py` | per data update | what ARGUS decided after an alarm |
| 12 | `GET /decision-contexts?page=N` | `fetch_snapshot.py` | per data update | links each decision to its alarm |
| 13 | `GET /monitorings?page=N` | first full snapshot | once | each sensor's position in ARGUS's 3D viewer (`viewer_placement`) |

The current build reads the snapshot of 12 Oct 2026 (`snapshot_2026-10-12`, resources 1–10). Resources 11–13 come
from the first full snapshot (`snapshot/`, all 38 ARGUS resources).

**ARGUS 3D data**, `https://argus.athenarc.gr` (by `fetch_argus_3d.py`, once per place)

| Endpoint | Method | What Aegis uses |
|---|---|---|
| `/terrain/<monument>/layer.json` and its quantized-mesh tiles | `GET` | terrain around each place, resampled to a 2 m grid |
| `/tiles/<model>/tileset.json` and its glTF tiles | `GET`; `HEAD` first for each tile's size | the photogrammetric model around each place, at most 8 MB per place, `robots.txt` respected |

**Aegis's own endpoint**, served by the Raspberry Pi

| Endpoint | Method | Caller | Content |
|---|---|---|---|
| `/live/argus-now.json` (via the playit.gg tunnel) | `GET` | GitHub Actions, on every build | schema 1, about 22 KB: per monument, the latest risk check of each danger and the 10 newest AD-RT alarms |

## The workflow, step by step

The numbers match `3-sequence.png`.

**A. Snapshot, once per data update** (`tools/fetch_snapshot.py`, then `tools/build_game_data.py`)
1–2. Each resource is read page by page until `meta.last_page`. Requests are 0.25 s apart, with up to 4 tries per page (waiting 2, 4 and 6 s).
- **Checks:** records are de-duplicated by `id`, and a resource is marked `complete` only if its count reaches `meta.total`.
- **Safety:** the tool refuses to overwrite an existing snapshot.
- **Next:** the data-analysis pipeline (`../data-analysis/`) turns the snapshot into `game_data.json`.

**B. Live data, every 2 hours** (`tools/pi/guardian_live.py` on a Raspberry Pi, systemd timer)
3–4. Only `threat-contexts` and `events` are read, starting from the page reached last time, and only records with a higher `id` are kept.
- **Limits:** requests are 0.5 s apart, with at most 400 pages per run, 3 tries per request and a 30 s timeout.
- **Restart:** if ARGUS's total shrinks (records were replaced), that resource is read again from page 1.
- **Output:** the latest check of each danger and the 10 newest AD-RT alarms per monument go to `argus-now.json`.
- **On failure:** the last good file is kept.
- **Isolation:** the service runs as its own sandboxed user, which can write only its own folder.

**C. Build and publish** (`.github/workflows/site.yml`, on every push to `main`, every night at 23:00 UTC, or by hand)
5. Data tests (Python), web tests (Vitest), and the build (TypeScript check and Vite). If any of them fails, nothing is published.
6–7. GitHub Actions downloads `argus-now.json` from the Pi and checks it: it must be valid JSON, with `schema: 1` and a `sites` object. If it can't, it keeps the copy from the last build.
8. The built site, data and live file go to the `site` branch as one fresh commit, and GitHub Pages serves them over HTTPS.

**D. A player opens the game**
9–12. The browser loads the app and `data/game_data.json` (network first, with the service worker's offline copy as a fallback).
13–14. It reads `live/argus-now.json` at most every 10 minutes, with an 8 s timeout.
- **Shown:** risk checks up to 14 days old, and alarms up to 2 months old that the game can explain.
- **Otherwise:** the "Live from ARGUS" box is not shown and the game plays as usual.

15. The 3D view loads its scene, model and terrain only when opened.

## Reliability

| Risk | What the workflow does |
|---|---|
| Network error | retries with waiting (snapshot: 4 tries; live: 3 tries, 30 s timeout) |
| Overloading ARGUS | one request at a time, 0.25–0.5 s apart; live runs read only new pages |
| ARGUS replaces records | the live reader detects the shrinking total and re-reads from page 1 |
| ARGUS unreachable | the Pi keeps its last good file; the build keeps the last published copy |
| A broken or foreign file | the build accepts only valid JSON with `schema: 1` |
| A code or data error | the tests gate publishing: nothing is published if one fails |
| Stale live data in the browser | old risk checks (more than 14 days) and old alarms (more than 2 months) are not shown |

## Security and data protection

- **Read-only:** every call to ARGUS is a `GET`. No ARGUS credentials are in the repository or in GitHub Actions.
- **Private source:** the repository is private. Only the built site is public (the `site` branch, served by Pages).
- **Isolated Pi service:** the Pi's live reader runs as a sandboxed system user, with no home folder, no devices and a read-only system.
- **Players' data stays on their device:** choices, answers, scores and observation reports are kept in the browser's local storage. Nothing is sent to ARGUS. An observation card leaves the device only if the player prints it, emails it or saves the file.

## How to reproduce

```sh
python3 -I tools/fetch_snapshot.py                  # A: a new dated snapshot from the ARGUS API
python3 -I tools/fetch_argus_3d.py all              # ARGUS 3D models and terrain
python3 -I tools/build_scenes_3d.py                 # 3D scenes (sensors, dangers per place)
python3 -I tools/build_game_data.py                 # the analysis: game_data.json + docs/data_notes.md
python3 -I tools/pi/guardian_live.py --out ./live   # B: one live run on any computer
cd web && npm ci && npm test && npm run build       # C: tests and build, as GitHub Actions runs them
```

All tools use the Python standard library only (Python 3.9+). The web app needs Node 20.

## Known limits

- **Unencrypted ARGUS API:** the API is served over HTTP, not HTTPS. Aegis only reads public data from it.
- **Freshness on GitHub Pages:** the Pi updates its file every 2 hours, but GitHub Pages gets a new copy only on a push or the nightly build. So the public site's live data can be up to about a day old.
- **The Pi's link:** the live file reaches GitHub Actions through a playit.gg tunnel (HTTP). If the tunnel is down at build time, the last copy is kept.
