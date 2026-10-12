# Guardian for a Day · Φύλακας για μια μέρα

A plain-language web game for the ARGUS Open Innovation Challenge 2026, Track A (Heritage and Citizen Science).
The game is played on an interactive satellite map. The player picks a monument on a map of Europe, flies in, and
places sensors on the real building on a small budget. Then the real ARGUS sensors appear on the map at their real
positions, a real ARGUS alarm from August–September 2026 lights up the sensor that raised it, and the player gets a
score with a short explanation of each danger. Five questions before and after the game show what was learned, a
checklist turns the player into an observer on their next visit, and a class code lets a teacher see the class's
choices next to what ARGUS really installed.

Status (11 Oct 2026): **all five ARGUS monuments are playable** (Delos, Baltanás, Monti Lucretili, Sant'Antonio di
Ranverso, Schenkenberg), in Greek and English, offline after the first visit. Italian, Spanish and German are
machine translations waiting for native speakers (see Languages). All authored text still needs human
review (see below). For teachers: [docs/teacher_guide.md](docs/teacher_guide.md).

| Monument | Levels | Real alarm replayed |
|---|---|---|
| Delos (GR) | all five | AI alarm: soil moisture under the Theatrical Masks mosaic, daily 31 Aug – 24 Sep |
| Baltanás (ES) | Medium, High, Extreme | none usable (AI alarms with no clear cause); the game says why and does not score that step |
| Monti Lucretili (IT) | High, Extreme, Catastrophic | tilt meter at Sant'Angelo al Morra (31 Aug); wind at Horace's villa (7 Sep) |
| Sant'Antonio di Ranverso (IT) | Low to Extreme | 7-day rain (10 and 16 Sep) |
| Schenkenberg (CH) | Low to Extreme | crack meter (20 Sep); vibration (16 Sep) |

## Run it

You need Python 3.9+ (standard library only) and Node 20+.

```sh
# 1. Build the data pack from the ARGUS snapshot (reads snapshot/, never writes to it)
python3 -I tools/fetch_snapshot.py             # optional: fresh complete copy of the ARGUS API into snapshot_<date>/
python3 -I tools/build_game_data.py            # writes web/public/data/game_data.json and docs/data_notes.md
python3 -I tools/build_game_data.py --check    # validate only
python3 -I tools/fetch_backdrops.py            # once per new monument (needs internet): drawn-plan outlines
python3 -I tools/probe_imagery.py              # once per new monument (needs internet): satellite depth per site

# 2. Data tests (counts, plausibility, mappings)
python3 -I -m unittest discover -s tools/tests -t tools -v

# 3. Web app
cd web
npm install
npm run dev          # http://localhost:5173
npm test             # game logic, i18n and community-store tests
npm run build        # static site in web/dist
npm run class        # after a build: the game and a class's records from this computer only (see Class server)
npm run screenshots  # needs a build: plays the game in Edge, saves docs/screenshots, runs axe a11y checks
```

`npm run screenshots` plays the Ranverso walk-through (with the quiz) on phone and desktop in both languages, every
level of every monument, the class-code and teacher flow, the game offline, the game with map pictures blocked, and
bad data (an older data pack, a crash on a screen: a message, never an empty page), and runs axe (WCAG 2.1 A/AA) on each screen. Options: `BROWSER_CHANNEL=chrome`, `BROWSER_PATH=/path/to/chromium`,
`SCREENSHOT_DIR=...` (save elsewhere), `SCREENSHOT_ONLY=monuments|imagery|class|offline|bad-data` (one part). It also reports when map
tiles cannot load, which is expected in sandboxes without internet.

`web/dist` is a static site with relative paths: upload it to GitHub Pages, Netlify or Vercel as is.
`npm run screenshots` saves what each screen shows (`*.png`) and, for phones, the whole scrolling panel
(`*-panel.png`; the sticky map cannot appear in full-page captures).
Add `?review` to the URL to outline every authored text that still needs human review.

Windows note: the npm scripts call `node node_modules/...` directly because the usual `.bin` shims break when the
project path contains `&` (as in `Projects & code`). Use `BROWSER_CHANNEL=chrome npm run screenshots` to use Chrome.

## How it fits together

```
snapshot/*.json  ──┐                                   (ARGUS data, read-only, in this private repo)
content/*.json   ──┼─► tools/build_game_data.py ─► web/public/data/game_data.json  ─► web app
                   │                             └► docs/data_notes.md (counts, quirks, assumptions)
                   └─ everything the team writes: cards, costs, mappings, stories, prompts
```

| Path | What it is | Source |
|---|---|---|
| `content/sensor_cards.json` | 17 cards (16 instruments + the human observer): plain names, one sentence, coin cost, ARGUS instrument types | authored |
| `content/rule_sensor_map.json` | AD-RT rule → sensor cards that detect it, keyed `pilot:rule`, all 37 policies | authored |
| `content/threat_sensor_map.json` | threat → sensor cards that can warn about it (for the score) | authored |
| `content/monuments/<pilot>.json` | story, budget, missions per level, plain threat texts, alarm explanations, discussion prompts, `no_alarm_note` | authored |
| `content/quiz.json` | the 5 pre/post questions, answers and explanations | authored |
| `content/citizen_checklist.json` | what visitors can watch for and how to report it | authored |
| `content/map.json` | base maps for the board (satellite and street map, no API key) with attribution | authored |
| `content/decisions.json` | the "what would you do next?" options after the alarm, and their feedback | authored |
| `content/translations/<lang>.json` | Italian, Spanish and German content, keyed by the exact English text | machine-translated |
| `tools/build_game_data.py` | joins snapshot + content, de-duplicates and filters alarms, validates everything | code |
| `web/src/game/logic.ts` | budget, coverage, detection, score, reveal comparison, map distances (pure, tested) | code |
| `web/src/components/GameMap.tsx` | the game board: one Leaflet map kept across screens; screens change what it draws | code |
| `web/src/community/` | anonymous records: device store, optional Supabase store with offline queue, class codes | code |
| `supabase/schema.sql` | tables and security rules for the optional shared store | code |
| `tools/class_server.py` | optional class server: the game and a class's records from the teacher's computer, no cloud | code |
| `web/src/runtime.ts` | settings the page gets from where it is served (class server, local-only mode) | code |
| `web/sw-template.js` | offline service worker; `vite.config.ts` writes `dist/sw.js` with the file list | code |
| `web/src/i18n/{el,en}.json` | every UI string; Greek is the default | authored |
| `web/src/i18n/{it,es,de}.json` | the same strings in Italian, Spanish and German | machine-translated |

The browser loads only `game_data.json` (about 255 KB of data, 50 KB compressed) and, for Italian, Spanish or German,
one content pack (`data/i18n/<lang>.json`, 16 KB compressed). It never loads `asset-states.json`.

### The map

- **Positions are real.** Sensor positions are the ARGUS installed-device coordinates (Ranverso: 19 of 20
  instruments, at 11 points within 30 m; the 20th is the satellite layer). Site pins on the overview are the median
  of each monument's sensor positions. ARGUS points closer than 2.5 m share one numbered marker on screen.
- **No API key.** Leaflet with Esri World Imagery (satellite) and OpenStreetMap (street map), set in
  `content/map.json`. Google Maps would need a Google Cloud key with billing; the base maps can be swapped there.
- **Tiles are only a backdrop.** If no picture loads (offline, or a page that blocks outside images, such as a
  sandboxed preview page), the game switches by itself to a drawn **plan**: OpenStreetMap outlines around the monument
  (ODbL, includes the real church outline) and Natural Earth coastlines (public domain), stored in
  `content/backdrops/` by `tools/fetch_backdrops.py` and shipped with the game.
- **Site guide.** During the story and the mission, numbered markers name the main parts of each site (dashed
  outlines where OpenStreetMap has the shape), and the mission panel lists them with "Show on map" buttons that move
  the map and the placement cross there, plus general tips on where each kind of sensor usually goes. Places are
  `places` in `content/monuments/<pilot>.json`: names and notes are authored (need review), positions are real
  (`"osm"`: an outline in `content/backdrops/`, `"sensors"`: the ARGUS sensors whose description contains that text).
  Tips are in `content/site_guide.json`. Labels that would overlap hide until you zoom in; the numbers stay.
- **Satellite depth per site.** Esri has no high-resolution imagery everywhere, and where it has none it sends a
  grey "Map data not yet available" picture instead of an error. `tools/probe_imagery.py` measures the deepest real
  zoom at every ARGUS sensor (Delos 18, Ranverso and Lucretili 19, Baltanás 20, Schenkenberg 21) into
  `content/imagery_zoom.json`. The map never asks deeper than that; it stretches the last real level, and you can
  zoom at most two levels past it. `npm run screenshots` zooms in fully at every site and fails on any such picture.
- **Mission screen (one screen, no scrolling).** The map fills the screen; a dock holds the step, coins, Done, the
  three dangers (tap one to read it), an info line and the sensor tray (17 tiles: two swipeable rows on phones,
  a right-hand column with every tile on wide screens). A "Places" button over the map opens the site guide.
- **Placing:** tap a tile to put the sensor at the reticle, or drag the tile onto the map to put it exactly where you
  drop it (touch: drag upwards; sideways swipes the tray). Tap the map to move the reticle, drag pins to adjust, tap a
  pin or use the tile's "−" to remove one. Keyboard: Tab to a tile, Enter or Space adds it at the reticle. The
  reticle's centre dot is the exact spot; it sits under the pins. Satellite images and the human observer get no pin.

### Add a monument (data only)

All five ARGUS monuments are already playable; this is how a sixth would be added.

1. Copy `content/monuments/ranverso.json` to `content/monuments/<pilot>.json` (or start from `"draft": true` with names only).
2. Fill in `display_name`, `place`, `story` (with `hook_scenario`), `budget`, `missions` (3 scenario keys per level;
   omit a level to let the script pick by ABC magnitude), `plain_threats` for every scenario, `featured_alarm`,
   `alarm_context` for each featured rule, and `discussion_prompts`.
3. Add scenario overrides to `content/threat_sensor_map.json` if the category defaults do not fit (each entry lists
   `cards` that help and the `primary` ones that watch the threat directly).
4. Run `python3 -I tools/fetch_backdrops.py` and `python3 -I tools/probe_imagery.py` (both need internet) for the
   drawn offline plan and the satellite depth, then `python3 -I tools/build_game_data.py`. It refuses to build if a text, mapping, mission or alarm pick is missing.

**AI alarms.** Delos and Baltanás have only deep-learning (AI) alarms in the sample. An AI alarm is replayed only
when one signal has at least 30% of the model's top feature contributions and `content/rule_sensor_map.json`
(`dl_features`) maps that signal to a card. Wind-direction signals are deliberately not mapped. The alarm screen then
shows the main signal and its share, not the anomaly score against its limit.

**Drawn offline plans** exist for all five monuments (`content/backdrops/`). Monuments spread over several sites
(Lucretili) get one OpenStreetMap request per group of sensors within 500 m.

## Game rules (assumptions, need review)

- **Levels** are the ABC priority labels. Only labels the monument has are offered (Ranverso has no Catastrophic).
- **Missions:** the first play of a level uses its hand-picked mission (same for a class). "Play again with new
  dangers" draws 3 other dangers of that level from its own pool (only dangers a card can warn about, one per name,
  never the same set twice in a row, always with the 4 spare coins). 94 of the 99 scenarios can now appear (50 before);
  the other 5 no card can warn about. Levels with fewer than 4 such dangers keep their own mission.
- **Risk model:** ARGUS re-evaluates every scenario daily (probability and state). When a danger linked to the
  replayed alarm was raised within three days after it, the alarm screen says so (Delos, 2 Oct 2026: a wind alarm,
  then "Wind wears the stone, House of the Masks" on watch at 14%, back to normal the next day).
- **Mission:** 3 real threats per level; coins grow with the danger level, the same at every monument (Low 12,
  Medium 13, High 14, Extreme 15, Catastrophic 16, in `content/coins.json`); 17 cards cost 1–4 coins (game coins, not
  real prices). A perfect network costs 2–8 coins depending on the level, so there are always at least 4 spare coins
  to experiment; buying every helpful card (9–24) still does not fit at 12 of the 19 levels (both tested). The real
  ARGUS networks would cost 17–68 coins at these prices; the reveal says so.
- **Score (out of 100):** per threat 20 points with a *primary* card (it watches the threat directly), 8 with only
  supporting cards; 25 if the network would have caught the replayed real alarm; up to 15 for the share of coins
  spent on helpful cards. Parts that do not apply (no replayable alarm, a threat no card can warn about) are left out
  and the total is scaled to 100. One cheap humidity sensor no longer scores 100.
- **Human observer card** (1 coin): stands for guards and volunteers. Watches pests, mould, plants and vandalism
  directly; never detects an alarm (people do not measure day and night); not shown in the ARGUS comparison.
- **Quiz:** the same 5 questions before the first game of a visit (skippable, no feedback) and after a game (with
  feedback and "before X, now Y").
- **Detection:** the network detects an alarm if it has a card from every group in the rule's `detect_with`.
- **What would you do next?** After the replayed alarm the player chooses a first step: send someone to look, check
  the sensor and the other measurements, wait, or close the monument. The game then quotes the decision ARGUS
  recorded for that alarm (real data: every record says "Review alarm evidence and affected asset context before
  intervention"; AI alarms have none) and gives feedback: looking first is where experts start, closing at once is
  too early, and waiting is risky when the alarm came back within its episode or was at least twice its limit,
  otherwise fair (`judgeDecision` in `web/src/game/logic.ts`). Monuments without a replayable alarm (Baltanás) ask
  the same question about their unexplained AI alarms. The choice is never scored; it is stored with the game so a
  teacher sees what the class would do.
- **Placement on the map is not scored.** It is used for discussion ("your humidity sensor is 12 m from the
  nearest ARGUS one: why did they put it there?"). There is no real building outline to judge inside/outside:
  the only footprint in the data is a test shape for Baltanás.
- **Reveal:** counts distinct ARGUS instruments (Ranverso: 26 records but 20 instruments), grouped by card.
  Differences become discussion prompts, never penalties.
- **Alarms never replayed:** a flat signal (probably a stuck sensor, e.g. Ranverso soil moisture, now a discussion
  question instead), implausible values (per-quantity ranges, plus per-rule ranges such as Lucretili's daily
  temperature range of 55–60 °C), and AI alarms without a clear, mapped main signal.
- **Alarms shown:** de-duplicated, with plausible values (humidity and soil moisture
  0–100, no exact zeros). For each episode: first, strongest and last alarm, 5–10 per monument.

The full, generated list of assumptions and data quirks is in [docs/data_notes.md](docs/data_notes.md).

## Assumptions that need a human

1. **History and science text:** the five stories (facts not in the ARGUS data: e.g. the Delos myth, Greek names of
   the Delos houses), all 99 plain-language threat texts, the quiz, the citizen checklist,
   alarm explanations, discussion prompts. Native-speaker check of all Greek.
2. **Sensor cards:** names, sentences and costs; merged types (lux + UV + pyranometer; vibration + accelerometer;
   soil moisture + water potential; people counter + barrier sensor).
3. **Mappings:** threat → cards and which are *primary* (52 of 66 entries flagged), rule → cards (12 of 39 flagged,
   including the AI pseudo-rules for Delos and e.g. `lucretili:R10_solar_zscore`,
   whose name says "solar" but whose description says "GNSS").
4. **Units:** not in the alarm data. We assume mm for rain and % for humidity and soil moisture. Ask ARGUS.
5. **Ranverso data:** soil moisture flat at about 2.47 for three weeks (stuck sensor?), all indoor humidity values
   above 100, double-registered instruments, the weather station marked `verification_required`.
6. **Game balance:** coins per level (12–16), scoring weights (20 / 8 / 25 / 15), observer cost, verdict thresholds (85 / 60 / 30).
   Check in the playtest.
7. **Base-map licences:** Esri World Imagery terms for a free public game (or get a free ArcGIS key); the OSM tile
   policy allows light use only. Open national orthophotos exist for CH (swisstopo), ES (PNOA) and some IT/GR regions.
8. **Ranverso weather station position** is marked temporary by ARGUS (dashed marker in the game).

## Accessibility (WCAG 2.1 AA target)

- Native controls only (radio groups, buttons, a real `<table>`); every step is keyboard-only playable.
- The map is optional for playing: every map action also exists in the panel. The map itself is keyboard
  focusable (arrows pan, +/- zoom), pins are labelled buttons, controls are 44 px, the sticky map never covers the
  focused element (`scroll-padding`), and the camera jumps instead of flying when reduced motion is on.
- Focus moves to each new screen's heading; a polite live region announces sensor changes and budget problems.
- Disabled-looking steppers stay focusable (`aria-disabled`) and say why they cannot be used.
- Colour is never the only signal: icons, words, solid vs dashed borders, circles (you) vs squares (ARGUS).
- Palette checked for contrast (text ≥ 4.5:1, controls ≥ 3:1); Okabe-Ito colours for the two data series.
- 48 px touch targets, mobile-first layout, no sideways scroll at 320 px, `prefers-reduced-motion` and
  forced-colours support, `lang` switches with the language.
- `npm run screenshots` runs axe-core (WCAG 2.1 A/AA) on every screen, in both languages, on phone and desktop.
  It catches about a third of real issues: a manual screen-reader pass (NVDA, VoiceOver, TalkBack) is still needed.

## Languages

Greek and English are written by the team in `content/*.json` and `web/src/i18n/{el,en}.json`. Italian, Spanish
and German (four of the five monuments are in Italy, Spain and Switzerland) are **machine translations that no
native speaker has checked yet**; the game says so in its footer in those languages.

- Interface text: `web/src/i18n/{it,es,de}.json`, same keys as `en.json` (tested). A missing key is shown in English.
- Content: `content/translations/<lang>.json`, keyed by the exact English text. The build writes
  `web/public/data/i18n/<lang>.json` and lists coverage in [docs/data_notes.md](docs/data_notes.md). When an English
  text is edited, its translation no longer matches: the game shows the English text until it is redone (delete
  the old key, add the new one). The build output and the data notes say how many texts each language is missing.
- German uses "ss" instead of "ß" so it also reads naturally in Switzerland, and addresses teachers as "Sie".
- A first visit starts in the browser's language when the game speaks it, otherwise in Greek. The choice in the
  language menu is remembered on the device.
- To add a language: add it to `Lang` in `web/src/game/types.ts`, `LANGS` in `web/src/i18n/index.tsx` and
  `TRANSLATION_LANGS` in `tools/build_game_data.py`, then add the two files above.

## Community stats and class codes

Without any setup, choices and quiz answers stay on each device (and a class can take turns on one device). To share
them across devices:

1. Create a free project at supabase.com and run [supabase/schema.sql](supabase/schema.sql) in its SQL editor.
   It creates two tables and security rules that let the public key add and read anonymous rows, never change or
   delete them.
2. Build with the project's URL and public *anon* key (Project settings → API):
   `VITE_SUPABASE_URL=https://xxxx.supabase.co VITE_SUPABASE_ANON_KEY=... npm run build`
   (or set them as environment variables on Netlify / Vercel / GitHub Actions). The anon key is meant to be public;
   never put the *service_role* key in the build.
3. When the shared store cannot be reached, the game keeps working on the device and sends what it saved later.

Anyone with the public key can add rows, so a public launch should watch for spam (Supabase rate limits, or a small
edge function). Records hold no names, times or device ids.

The teacher page shows, for a class code: what the class chose next to what ARGUS installed, the quiz **question by
question** (share of right answers before and after, over the games that have both quizzes), and what the class
would do first after the alarm.

### Class server (no cloud, no accounts)

`tools/class_server.py` serves the built game and keeps a class's records on the teacher's own computer. It needs
only Python (standard library) and sends nothing anywhere.

```sh
cd web && npm run build
python3 -I tools/class_server.py            # http://127.0.0.1:8765 : this computer only
python3 -I tools/class_server.py --lan      # also for devices on the same network; prints the address to share
python3 -I tools/class_server.py --lan --online-maps   # allow satellite and street-map pictures from the internet
```

- **This computer only by default.** Without `--lan` it listens on 127.0.0.1. With `--lan` other devices on the same
  network can open it (Windows asks once to allow Python through the firewall); the class link on the teacher page
  then uses the network address, not "localhost".
- **Local-only mode.** The page it serves is told to ask for nothing outside this server: the drawn plan replaces
  satellite and street-map pictures, and no cloud store is used. A Content-Security-Policy header makes the browser
  enforce it. `--online-maps` adds the two picture hosts back, nothing else. The same mode works on any host with
  `?local` in the link or a build with `VITE_LOCAL_ONLY=1`.
- **Records** are the same anonymous ones (no names, times or device ids), validated by the same rules as
  `supabase/schema.sql`, one JSON object per line in `class_data/plays.jsonl` and `quizzes.jsonl` (ignored by git).
  Requests are not logged, so no addresses are written anywhere. Delete the folder to start afresh.
- **If the teacher's computer is out of reach**, devices keep their records and send them with the next game.
- Over plain `http://` on a school network browsers offer no service worker, so there the game needs the server
  for each page load (on 127.0.0.1 it still works offline after the first visit).

## Offline

`npm run build` writes `dist/sw.js`, a small service worker with the list of built files. After one visit the game,
its data and the drawn plan work without internet. Map pictures are never stored (their providers do not allow
offline copies). A new build replaces the stored copy on the next visit. Built files have content hashes and are
served from the stored copy first; the data pack (`data/`) has none, so it comes from the network first and from the
stored copy only offline. If the data pack's `schema_version` does not match the game (an earlier version's offline
copy answered), the game removes its service worker and stored files and reloads once; a crash on any screen shows
a message with a reload button instead of an empty page.

## Next steps (to 24 October)

| By | Task |
|---|---|
| 14 Oct | Review authored content (stories, Greek, threat texts, primary cards, quiz, checklist, units); fix from feedback |
| 15 Oct | Keep an eye on the offline check (`npm run screenshots`): it failed in earlier runs and passes now, cause not identified |
| 16 Oct | Set up Supabase (optional) and publish the site (GitHub Pages / Netlify); test a class code across two devices |
| 18 Oct | Decide base-map licences; ask ARGUS about units, the stuck soil sensor and the meaning of the AI alarms |
| 22 Oct | **Playtest** with a class or visitors (pre/post quiz gives the evidence); manual screen-reader and keyboard audit |
| 23 Oct | Fixes, short video, submission text |
| 24 Oct | Submit (deadline 25 Oct, 23:59 Athens) |

## Data and credentials

- `snapshot_2026-10-12/` is a complete fetch of the ARGUS API (`tools/fetch_snapshot.py`: public, read-only, no token);
  the build always uses the newest snapshot folder. `snapshot/` is the first copy (43 MB, fetched 11 Oct 2026, sampled
  events), kept unchanged as the reference for the facts tests, committed so the whole team builds from the same
  data. It is read-only input, and the repository must stay private unless the challenge's data terms allow
  publishing it. `game_data.json` holds only the fields the game needs.
- The API spec (`specs.json`) and `test_api.py` live outside this folder. Never copy tokens or credentials into this
  repository; `.gitignore` excludes `test_api.py`, `.env` and `*.token` as a safety net.
