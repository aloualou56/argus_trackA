# Guardian for a Day · Φύλακας για μια μέρα

A plain-language web game for the ARGUS Open Innovation Challenge 2026, Track A (Heritage and Citizen Science). The
game is played on an interactive satellite map. The player picks a monument on a map of Europe, flies in, and places
sensors on the real building on a small budget. Then a real ARGUS alarm from August–September 2026 plays on the map:
waves spread from the sensor that raised it, and the player sees whether their own sensors would have caught it.
Next the real ARGUS sensors appear at their real positions, and the player gets a score with a short explanation of
each danger, and can go on to a week on duty, one real alarm a day. Five questions before and after the game show
what was learned, a checklist turns the player into an observer on their next visit, and a class code lets a teacher
see the class's choices next to what ARGUS really installed.

Status (13 Oct 2026): **all five ARGUS monuments are playable** (Delos, Baltanás, Monti Lucretili, Sant'Antonio di
Ranverso, Schenkenberg), in Greek and English, offline after the first visit, with sound, and with a full-screen map
for placing sensors on phones, and a "Live from ARGUS" box on the first screen with ARGUS's newest checks of each
danger (see Publishing). **Play it: <http://pi-address.invalid/>**, a public copy on a
Raspberry Pi that updates itself on every push to `main` (see Publishing). Italian, Spanish and German are machine
translations waiting for native speakers (see Languages). All authored text still needs human review (see below). For
teachers: [docs/teacher_guide.md](docs/teacher_guide.md).

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

`npm run screenshots` plays, in both languages:

- the Ranverso walk-through (with the quiz) on phone and desktop, including the alarm replay after "Done" (only the
  map on a phone, the panel kept on a desktop, "Skip" there) and, on a phone, the full-screen board and its card;
- every level of every monument, and the class-code and teacher flow;
- a week on duty: each later day's alarm plays on the map too, full screen on a phone;
- sound, counted as the notes the page starts (no speaker needed): none before a tap, one for each action, the
  replay's, and none once turned off, which a reload remembers;
- the game offline, the game with map pictures blocked, and bad data (an older data pack, a crash on a screen: a
  message, never an empty page).

It runs axe (WCAG 2.2 A/AA) on each screen and checks that no focused control is hidden under a bar or a card (WCAG 2.4.11). Options: `BROWSER_CHANNEL=chrome`, `BROWSER_PATH=/path/to/chromium`,
`SCREENSHOT_DIR=...` (save elsewhere), `SCREENSHOT_ONLY=play|monuments|imagery|class|week|sound|history|read-aloud|a11y|offline|bad-data` (one
part). It also reports when map tiles cannot load, which is expected in sandboxes without internet.

`web/dist` is a static site with relative paths: any static host serves it as is. The public copy is on a
Raspberry Pi and follows `main` by itself (see Publishing).
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
| `content/monuments/<pilot>.json` | story, missions per level, plain threat texts, alarm explanations, discussion prompts, `no_alarm_note` | authored |
| `content/coins.json` | coins per danger level (Low 12 to Catastrophic 16), the same at every monument | authored |
| `content/history/<pilot>.json` | the whole story of each site, in chapters, read from the story screen; `check` lists the facts to verify | authored |
| `content/quiz.json` | the 5 pre/post questions, answers and explanations | authored |
| `content/citizen_checklist.json` | what visitors can watch for and how to report it | authored |
| `content/map.json` | base maps for the board (satellite and street map, no API key) with attribution | authored |
| `content/decisions.json` | the "what would you do next?" options after the alarm, and their feedback | authored |
| `content/translations/<lang>.json` | Italian, Spanish and German content, keyed by the exact English text | machine-translated |
| `tools/build_game_data.py` | joins snapshot + content, de-duplicates and filters alarms, validates everything | code |
| `web/src/game/logic.ts` | budget, coverage, detection, score, reveal comparison, map distances (pure, tested) | code |
| `web/src/game/live.ts` | "Live from ARGUS" on the first screen: what of the Pi's newest ARGUS file to show (pure, tested) | code |
| `web/src/components/GameMap.tsx` | the game board: one Leaflet map kept across screens; screens change what it draws, including the alarm replay | code |
| `web/src/audio/sounds.ts` | the game's sounds, made in the browser with the Web Audio API (no audio files) | code |
| `web/src/community/` | anonymous records: device store, optional Supabase store with offline queue, class codes | code |
| `web/src/game/report.ts` | the citizen observation report: its rules and its export in ARGUS's format (pure, tested) | code |
| `web/src/screens/Observe.tsx` | the report form and the printable card | code |
| `supabase/schema.sql` | tables and security rules for the optional shared store | code |
| `tools/class_server.py` | optional class server: the game and a class's records from the teacher's computer, no cloud | code |
| `web/src/runtime.ts` | settings the page gets from where it is served (class server, local-only mode) | code |
| `web/sw-template.js` | offline service worker; `vite.config.ts` writes `dist/sw.js` with the file list | code |
| `.github/workflows/site.yml` | tests and builds every push to `main`; puts the built site on the `site` branch | code |
| `tools/pi/` | the Raspberry Pi that serves the public copy: update script, timers, Caddy, setup | code |
| `tools/pi/guardian_live.py` | on the Pi, every 15 minutes: the newest checks and alarms from the ARGUS API, as one small file | code |
| `docs/brand/logo.png` | the original logo; the icons and the mark are made from it | brand |
| `web/src/i18n/{el,en}.json` | every UI string; Greek is the default | authored |
| `web/src/i18n/{it,es,de}.json` | the same strings in Italian, Spanish and German | machine-translated |

The browser loads only `game_data.json` (about 255 KB of data, 50 KB compressed) and, for Italian, Spanish or German,
one content pack (`data/i18n/<lang>.json`, 16 KB compressed). On the public copy it also reads `live/argus-now.json`
(about 20 KB, 3 KB compressed), written by the Pi. It never loads `asset-states.json`.

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
- **Mission screen (the map never scrolls away).** The map fills the screen; a dock holds the step, coins, Done,
  the three dangers (tap one to read it), an info line and the sensor tray (17 tiles, each showing its price as
  coins; hollow coins mean more than is left). An upright phone has no dock: the map is the whole screen and the
  coins and the sensors float over it (see Small screens). On wide screens the dock
  is a right-hand column: the dangers are a list (a click opens one in place), the tiles are sorted under their
  four group names in full rows (three to a row; a last row of two shares the width, and a group of four is two
  rows of two, so no tile stands alone beside a gap), and below them "Your network" lists what was bought and
  what it cost. A tile shows its sensor's whole name, on up to three lines. Nothing in that column
  moves while the pointer passes over the tiles: the info line is a window of a fixed size (four lines, the
  longest description in any language) and the column keeps room for its scrollbar. On a short screen the column
  scrolls and the info line stays in view. A "Places" button over the map opens the site guide.
- **Placing:** tap a tile to put the sensor at the reticle, or drag the tile onto the map to put it exactly where you
  drop it (touch: drag upwards; sideways swipes the tray). Tap the map to move the reticle, drag pins to adjust, tap a
  pin or use the tile's "−" to remove one. Keyboard: Tab to a tile, Enter or Space adds it at the reticle. The
  reticle's centre dot is the exact spot; it sits under the pins. Satellite images and the human observer get no pin.

### Add a monument (data only)

All five ARGUS monuments are already playable; this is how a sixth would be added.

1. Copy `content/monuments/ranverso.json` to `content/monuments/<pilot>.json` (or start from `"draft": true` with names only).
2. Fill in `display_name`, `place`, `story` (with `hook_scenario`), `missions` (3 scenario keys per level;
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

- **The whole story:** under the story text, "Read the whole story" opens the site's history, one chapter at a
  time (4–5 per site); a chapter about one part of the site moves the map there. The last chapter, or "Back to the
  dangers" on any chapter, returns to the story screen at its danger, focused, so the mission is one step away.
  The chapters are written by the game team from general knowledge and every fact needs checking (`check` in each
  file); the build refuses a chapter without its Greek or English, or one that points the map at an unknown place.
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
  to experiment; buying every helpful card (9–24) still does not fit at 9 of the 19 levels (both tested). The real
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
- **Sound** (`web/src/audio/sounds.ts`): made in the browser with the Web Audio API, so there are no audio files to
  load or license and it works offline. Placing a sensor (a coin tick and two notes; a soft landing when dropped),
  removing one, "not enough coins", the alarm replay (a whoosh, a sonar ping per wave, then a rising chime when the
  sensors caught it or two falling notes when they missed it) and the score. Nothing plays before the player taps,
  nothing is said only by sound, and the accessibility menu turns it off (remembered on the device).
- **Vibration** (`web/src/audio/haptics.ts`): phones vibrate with each sound (a tick for a sensor, a double buzz for
  "not enough coins", a pulse per wave of the alarm replay, then three quick pulses when the sensors caught it or
  one long one when they missed it). Android browsers only; iPhones have no vibration in the browser. It has its
  own switch in the accessibility menu, so a class can play silently and still feel it.
- **Read aloud** (`web/src/audio/narration.ts`, `speech.ts`, `ReadAloud.tsx`): on the story screen (the story and
  the mission's danger), on each chapter of the whole story and on the alarm screen (what was measured and the
  answer). All five languages play **recorded voices** (see "Recorded narration" below), line by line; any line
  without a recording uses the device's own voice (the Web Speech API), a little slower than usual. A device with neither offers no "Read aloud" rather than reading Greek with an English voice.
  It stops on a second press, on a new chapter and on leaving the screen.
- **Order and the alarm replay:** story → mission → a real alarm → reveal → score. After "Done" (and after "Go on to
  day N" in a week on duty, for each later day) the day's real alarm plays on the map for about three seconds (less
  than one without motion): waves spread from the ARGUS sensor that raised it, then the player's sensors that would
  have caught it light up and the rest fade (a cross when none would have). It then waits on that picture, with no
  time limit, until the player presses "See the answer" ("Skip" while it plays). Phones and small tablets show only
  the map meanwhile; wide screens keep the panel, unusable until it ends. The alarm's screen then opens on the
  answer, and its map shows only the ARGUS sensor that raised the alarm, so the reveal still comes after it.
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
- **Alarms never replayed:** implausible values (per-quantity ranges, plus per-rule ranges such as Lucretili's daily
  temperature range of 55–60 °C) and AI alarms without a clear, mapped main signal. A flat signal (probably a stuck
  sensor, e.g. Ranverso soil moisture) is never a level's own alarm; it can come up on a later day of a week on
  duty, where the alarm screen says the sensor may be stuck.
- **Improve my network:** the score screen offers a second turn. The player goes back to the mission with the same
  sensors, coins and three dangers, changes the network, and comes straight back to the score, which then says
  "Before your changes: 75 out of 100. Now: 100." The class and community records keep the first attempt, so
  classes stay comparable.
- **A week on duty (optional, day by day):** after each score the player may go on to the next day, up to 7, or stop.
  Day 1 is the level's own alarm; each later day replays another real alarm of the monument (`weekAlarms` in
  `web/src/game/logic.ts`): a different kind of alarm each day while there is one, oldest first within a kind, the
  same week for everyone. They are real alarms from different dates, not seven days in a row, and the game says
  so. The network can be improved between any two days. Each day is scored like day 1 with that day's alarm, and
  a sensor bought for an earlier day's alarm still counts as coins well spent. A strip shows which days were
  caught. Baltanás has no alarm to replay, so it offers only the second turn.
- **Challenge link:** "Share your result" sends a link such as `?m=delos&l=high&d=65.69.82&s=68`: the monument, the
  level, the ARGUS threat ids of the three dangers, and the score to beat. Opening it offers "Take the challenge"
  and the score screen says who won. Only a mission the game could have dealt is accepted (the level's own or one
  from its pool), and the link never carries a class code or anything about the sender.
- **Alarms shown:** de-duplicated, with plausible values (humidity and soil moisture
  0–100, no exact zeros). For each episode: first, strongest and last alarm, 5–10 per monument.

The full, generated list of assumptions and data quirks is in [docs/data_notes.md](docs/data_notes.md).

## Assumptions that need a human

0. **The five photo captions** (`content/photos/credits.json`): each says what its photo shows; check them, and
   the Greek. The photos themselves and their credits come from Wikimedia Commons (see Photographs).
1. **History and science text:** the five whole stories (`content/history/`, 22 chapters, every fact to check), the five stories (facts not in the ARGUS data: e.g. the Delos myth, Greek names of
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

## Photographs

One real photograph per monument, from Wikimedia Commons under a free licence. The game shows the author and the
licence under each photo and in "Photo credits" at the foot of every screen. The photos are bundled with the game
(`content/photos/`, copied to `web/public/data/photos/` by the build), so nothing is fetched while playing.

| Monument | What it shows | Author | Licence | Source |
|---|---|---|---|---|
| Delos | The House of the Masks on Delos, seen from above. The modern roof covers its mosaic floors. | Bernard Gagnon | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) | [Commons](https://commons.wikimedia.org/wiki/File:House_of_the_Masks_01.jpg) |
| Baltanás | The cellar hill of Baltanás: doors and stone chimneys on the slope, and the church tower on the right. | Carmen García Fdez | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Panor%C3%A1mica_de_las_bodegas_de_Baltan%C3%A1s_con_la_torre.jpg) |
| Monti Lucretili | Dry-stone walls on the high meadow of Monte Gennaro, in the Monti Lucretili. | V.lattanzi | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Parco_dei_Monti_Lucretili_il_Pratone_di_M._Gennaro.jpg) |
| Sant'Antonio di Ranverso | Sant'Antonio di Ranverso from behind: the brick apse of the church and its bell tower. | Elio Pallard | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Buttigliera_Alta_-_Abbazia_di_Sant%27Antonio_di_Ranverso_003.jpg) |
| Schenkenberg | The ruins of Schenkenberg Castle on their hill, with the valley below. | Gabrielle Merk | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Commons](https://commons.wikimedia.org/wiki/File:Ruine-Schenkenberg.jpg) |

- Checked on 12 October 2026 from each file's Commons page. All are shown resized (960 px and 330 px wide).
- The share-alike licences (CC BY-SA) ask that copies of a photo stay under the same licence and keep the credit.
  Keep `content/photos/credits.json` with the photos wherever they go.
- The Monti Lucretili photo shows the dry-stone walls of the landscape (one of the ARGUS scenarios there): no
  freely licensed photograph of the monitored buildings was found. Replace it if the park can provide one.
- To change a photo: put the new files in `content/photos/`, update its entry in `credits.json` from the photo's
  own page, and run the build. The build refuses a photo without an author, a licence and a source.

## Look: the survey sheet

The game is played on a map of real monuments, so it looks like one: a survey sheet with its margin notes.

- **Colour:** paper white and survey green, green-black ink, brass for coins. The two data colours are unchanged
  (blue for the player, vermilion for ARGUS). Tokens are at the top of `web/src/styles.css`; the section
  "identity: the survey sheet" at its end sets how each part wears them (type, colour, borders and corners only,
  never layout).
- **Type:** titles in the capitals of map lettering (Sofia Sans Extra Condensed), text in Commissioner, and
  coordinates, codes and counters in JetBrains Mono. All three are SIL Open Font License 1.1, cover Greek and the
  four other languages, and are bundled with the build from the `@fontsource-variable` packages
  (`web/src/fonts.css`): no font service is contacted, so the class server's local-only mode still holds. Only the
  Greek, Latin and extended-Latin parts ship (about 220 KB in all; a browser fetches the parts it needs).
- **Map furniture is real:** a true scale bar, the coordinates of the centre of the view (in the mission, the spot
  under the cross), and each monument's position on its story screen, from the ARGUS sensor positions. The cross
  itself is a surveyor's mark in ink on a white casing (no blue: blue is a sensor); it lies above the names of
  places and below the sensors, and its note hangs from its lower arm.
- **Blocks, not cards:** notes are tinted blocks on the white sheet. Inverted (survey green) blocks are kept for
  the player's next move: the mission on the story screen and the week on duty.
- **Notes with a rule above, never a stripe at the side:** the danger on the story screen and every note that
  carries a verdict (what each danger needed, quiz answers, the decision) sit under a rule. The rule's line says
  the verdict as well as its colour: solid = yes, dashed = no, double = partly. The alarm's answer is the exception:
  a tinted block with no rule, whose tick or cross and first word ("Yes" / "No") say it.
- **A rating is a scale, not a badge:** what is rated in small capitals, then five rising steps and the level in
  words (`web/src/components/LevelBadge.tsx`). The experts' rating wears the ARGUS vermilion, because it is ARGUS
  data like the vermilion pins on the map.
- **The mission shows its coins:** the budget is drawn as brass coins in fives, to count before spending them.
- **Real photographs** of the five monuments, on the story screen and beside each name on the first screen, each
  with its author and licence (see Photographs).
- **Instrument icons** (`web/src/components/Icon.tsx`): the sensor icons are drawings of the instruments
  themselves (a thermometer with its scale, a rain gauge with its funnel, a crack meter bridging a crack); the
  thin marks are measuring ticks.
- **Four kinds of choice, four shapes:** the monuments are an index with photographs and coordinates, the danger
  levels and the report's "what did you see" are rows joined into one ladder, quiz answers are lettered (Α Β Γ in
  Greek), and the decision after the alarm is four action tiles. All are still real radio buttons underneath.
- **The first screen** puts the two choices first and keeps Start in a bar pinned to the bottom of the panel, which
  says what it will start. **The score screen** puts the next steps first (the week, the questions again), folds
  the checklist, "what others chose" and the week's fine print ("How it works"), and keeps the rest in one scroll.
  In "What each danger needs" a danger that was fully covered shows only its name and the sensors that covered it;
  the others repeat what the danger is, because those are the ones to reread.
- **Names of places on the map** step aside for the map's own furniture: a name that would lie under the scale,
  the coordinates, the legend or a button is hidden (its number stays, and the site guide lists every name).
- **No browser-default controls left in view:** the language menu and the monument of a report use the game's own
  drop-down (`web/src/components/Dropdown.tsx`), the report's photo is chosen with a normal button (the browser's
  file control does the work behind it), and the map shows the credits for its data without the library's badge.
  The date of a report is still the browser's date field, styled: its calendar is the most reliable one on phones.
- **The mark:** a guardian's shield over a classical temple on the survey grid. The original is
  `docs/brand/logo.png` (1024 px, white on green). The app icons (`icon-*.png`, `apple-touch-icon.png`) are that
  picture scaled down, the favicon (`favicon.png`) is cropped closer around the shield so it reads at 16 px, and the
  mark in the top band and on the report card is the white emblem cut out as a mask
  (`web/src/assets/brand-mark.png`), painted in the text colour: white on the band, green on the card
  (`web/src/components/BrandMark.tsx`).
- **Language menu:** a button that opens a list of buttons, each language under its own name, styled like the
  rest (`web/src/components/LangMenu.tsx`). Arrow keys move through it, Escape closes it.

### Small screens (under 60rem wide)

Phones and upright tablets have their own rules, all inside `max-width` queries in the last section of
`web/src/styles.css` ("small screens"), so the wide layout is not touched by them.

- **The map is sized by what the screen is for.** Where the map is used (choosing a monument, placing sensors,
  comparing the two networks, marking a spot) it keeps 42% of the height. Where the screen is read (story, alarm,
  score) it gets 30%, and on the questions and the teacher page 20%. On those shorter maps the map picker and the
  coordinates are hidden; the chosen map stays. `App.tsx` marks the screen with `data-screen`.
- **Placing sensors on an upright phone** (under 40rem wide): the map is the whole screen and the top band goes.
  The coins, a "?" button and Done float in a bar at the top; the sensors float in one swipeable strip at the
  bottom, dragged up onto the map (or tapped, for the cross); what a sensor does shows above the strip for a few
  seconds. A card opens when a mission starts (not when improving the network) and again from "?": how to place,
  move and remove sensors, the coins, and the mission's three dangers, which no longer take a row of their own.
  It is a modal `<dialog>`: focus stays inside, Escape closes it. Wider screens keep the dock (`Mission.tsx`, PHONE;
  `styles.css`, "phone board").
- **While the real alarm plays** (after "Done", or on the next day of a week on duty) the map takes the whole screen,
  whichever screen it starts from; the top band and the panel come back with the answer.
- **The top band** on a phone (under 30rem) puts the game's name on two short lines, so the sound and language
  buttons fit beside it.
- **A short upright screen wider than a phone** (under 44rem high) shows one row of tiles in the mission, so the
  map keeps its room.
- **A phone on its side** (landscape, under 32rem high) puts the map beside the page instead of above it. In the
  mission the dock is a column: the coins and Done stay in view, then the line that says what a sensor tells, and
  the tiles scroll under them. A tile is dragged towards the map: upwards on an upright phone, to the left on its
  side (`Mission.tsx`).
- **A narrow phone** (under 26rem) drops the globe from the language button so the language's name is never cut.
- **The first screen** does not repeat the game's name under the band that already says it: the heading is kept
  for screen readers and the page starts with what the game is, so the list of monuments comes sooner.
- **Tiles** are a little wider and their icon a little smaller than before, so a name has room for three lines.

## Accessibility (WCAG 2.2 AA target)

**The accessibility menu** (the figure button in the top band, `web/src/components/A11yMenu.tsx`,
`web/src/a11y/settings.ts`): text size (normal, large 125%, larger 150%), high contrast (darker text and outlines,
solid map labels), less motion (the map jumps instead of flying, nothing animates; shown on and locked when the device
already asks for it), wider text spacing (letters, words, lines and paragraphs, the WCAG 1.4.12 kind), sound and
vibration (each with its own switch). Each choice is remembered on the device and applied before the page is drawn.
The text size grows the page's text, not the map's own furniture (labels, legend, buttons, pins): on a phone the map
is a strip, and furniture half as big again would bury it, so its sizes are divided by `--text-scale`; what the map's
labels say is also in the panel, which does grow. The top band puts its buttons below the title when the title needs
the room. On phones and small tablets the game's name shows in the top band only on the first screen (it is in the
tab title everywhere, and stays the mark button's name for screen readers); wide screens keep it.

**Full screen on phones** (`web/src/a11y/fullscreen.ts`): pressing Start on a phone or small tablet puts the game in
full screen (the browser's address bar and buttons step aside; the phone's back button leaves it). Browsers allow it
only from a tap, hence Start. The menu's "Full screen" switch, shown only where the browser can do it, turns it off or
on. Android browsers can; iPhones do not let a web page go full screen, so nothing changes there.
It is a button and a panel of native controls: Escape closes it and gives the focus back, and tabbing out of it closes
it too. While placing sensors on a phone the top band is hidden, so the "?" card has the sound and vibration
switches.

- Native controls only (radio groups, buttons, a real `<table>`); every step is keyboard-only playable.
- The map is optional for playing: every map action also exists in the panel. The map itself is keyboard
  focusable (arrows pan, +/- zoom), pins are labelled buttons, controls are 44 px, the sticky map never covers the
  focused element (`scroll-padding`), and the camera jumps instead of flying when reduced motion is on.
- Focus moves to each new screen's heading; a polite live region announces sensor changes and budget problems.
- **No time limits** (WCAG 2.2.1): nothing moves on by itself. The alarm replay waits on its final picture until the
  player presses "See the answer" ("Skip" while it plays; the button keeps the focus, and screen readers hear when it
  is over). On a phone, the card that says what a sensor does stays until the next tap or its close button.
- **Nothing moves for long** (WCAG 2.2.2): the replay's waves play once, and the alarm ring on the alarm screen
  pulses three times and then stands still. With reduced motion nothing moves at all.
- **Read aloud** on the story, each chapter and the alarm screen, in the game's language only (see Game rules), for
  younger players and anyone who reads slowly. **Vibration** on phones repeats what the sounds say.
- Sound and vibration are never the only signal (what they say is on screen too), start only after a tap, and each
  can be turned off: in the accessibility menu, and in the "?" card while placing sensors on a phone.
- **WCAG 2.2 additions:** a focused control is never hidden (2.4.11): the menu closes when focus leaves it, the skip
  link shows above the phone's floating bars, pin popups open clear of them, and the harness checks every control of
  every screen. A sensor on the map can be moved without dragging (2.5.7): "Move it to the cross" in its popup, with
  the cross moved by a tap on the map. Targets are at least 24 px and never covered (2.5.8): map pins that would
  overlap when zoomed out are drawn a few pixels apart (their true place comes back as you zoom in).
- **Large text** (1.4.4, 1.4.10): at 150% from the menu, or a phone's own font size, buttons and badges grow with
  their text (sizes in em), the phone's top bar wraps and the map's controls stay between the floating bars, the
  sensor card shows its whole text, and map pins stay centred on their spot.
- The phone's "how to" card is a modal `<dialog>`: focus moves into it, Escape closes it, and focus returns to "?"
  or to the screen's heading.
- Disabled-looking steppers stay focusable (`aria-disabled`) and say why they cannot be used.
- Colour is never the only signal: icons, words, solid vs dashed borders, circles (you) vs squares (ARGUS).
- Palette checked for contrast (text ≥ 4.5:1, controls ≥ 3:1), again after the redesign; Okabe-Ito colours for the
  two data series.
- 48 px touch targets, mobile-first layout, no sideways scroll at 320 px, `prefers-reduced-motion` and
  forced-colours support, `lang` switches with the language.
- `npm run screenshots` runs axe-core (WCAG 2.2 A/AA) and the hidden-focus check on every screen, in both languages,
  on phone and desktop, and the phone screens again at the largest text with high contrast and wide spacing.
  It catches about a third of real issues: a manual screen-reader pass (NVDA, VoiceOver, TalkBack) is still needed.

## The guardian and what happens if nobody notices

Each monument has an **imaginary guardian** (`guardian` in `content/monuments/<pilot>.json`): Manolis, a guard on
Delos; Tomás, whose family keeps a cellar in Baltanás; Franco, a ranger in the Monti Lucretili park; Giulio, who opens
the church of Ranverso to visitors; Urs, a volunteer at Schenkenberg. On the story screen the guardian hands the watch
over to the player; on the score screen (first day) they come back: thanks when the player's sensors caught the real
alarm, comfort when ARGUS caught it alone, a quiet day where no alarm can be replayed. The game says plainly under
each guardian that the character is imaginary and that the monument, the dangers and the alarms are real.

Under it, **"If nobody had noticed"** (`consequences` in the same file, one per alarm rule): what that kind of
damage does over the years when nobody ever notices, with two drawings side by side, today and years later
(`web/src/components/Consequence.tsx`: mosaic, floor, stone, lean, tree, fresco, crack). The drawings explain; the
caption says they are not pictures of the site. Both are read aloud with the recorded voices once recorded (until
then, with the device's voice). Needs review: the guardians' words and the science of each consequence (listed in
`docs/data_notes.md`).

## Citizen observation report

The checklist at the end of the game tells visitors what to look out for. The observation report lets them act on
it: "Report something you saw", on the first screen and on the score screen.

- **The form:** which monument, what they saw (the six checklist items or "something else"), a short note, where,
  the day, and an optional photo.
- **Where** is a pin on the same map: tap to place it, drag to adjust, or choose a named part of the site (the
  keyboard and screen-reader path). The card says "near <place>" when the pin is within 120 m of one.
- **The card** can be printed (only the card prints) or shown on the phone to a guard. It says plainly that it is
  a visitor's observation, not an expert's diagnosis.
- **Nothing is sent.** The report is kept on the visitor's device only (the last 30, in `localStorage`), never in
  the class or community store, because it holds the visitor's own words. The photo is not stored at all: it is on
  the card while the page is open and gone after a reload.
- **The data file** ("Save the data file") is the report as an ARGUS cultural-documentation record: the same
  schema (`argus_cultural_documentation_v1`, CIDOC CRM E14 Condition Assessment) as the visual condition
  assessment in the snapshot (a Delos test record). `web/tests/report.test.ts` checks our export field by field
  against that real record. What a visitor cannot know stays empty (severity, asset state); the spot and the
  checklist item sit under an added `citizen_observation` key. The photo is not in the file.
- **Who to tell** (`report_to` in `content/monuments/<pilot>.json`): under the card, the bodies responsible for
  the monument, with the contact details from their own official websites (each with its source page and the day
  it was checked, 13 Oct 2026): the Ephorate of Antiquities of Cyclades (Delos), the town council of Baltanás, the
  Monti Lucretili park body, the Fondazione Ordine Mauriziano (Ranverso), and the Aargauer Heimatschutz (owner)
  with the cantonal heritage office of Aargau (Schenkenberg). "Send it by email" opens the visitor's own email app
  with the card written in (a `mailto:` link): the visitor reads it, adds a photo and sends it, or not. The game
  still sends nothing itself. Where official pages give different phone numbers, only the email is shown. A safety
  line says to call 112 first if someone could get hurt. Needs review: one call or email to each body to confirm.
- **Open question for ARGUS:** nothing loads these files into ARGUS. Whether ARGUS would accept citizen records,
  and through which channel, is theirs to decide; the file is a proposal in their own format.

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
- A word in a sensor's name that is wider than a tile carries a soft hyphen, written `­` in the content
  files so it can be seen (one Greek word, one Spanish, eleven German compounds). It is invisible until the word
  has to break, and then it breaks there with a hyphen ("Μετεωρο-λογικός") instead of being cut or spilling out.
  A new long name needs its own. One name is still cut on phone tiles in Greek, Italian and Spanish: the
  satellite position receiver (GNSS), which would need four lines; its full name shows in the info line.
- A first visit starts in the browser's language when the game speaks it, otherwise in Greek. The choice in the
  language menu is remembered on the device.
- The whole story's chapters (`content/history/`) are translated too (all 424 content texts in each language).
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

## Recorded narration (ElevenLabs or Azure)

"Read aloud" plays natural recorded voices in all five languages, recorded once and shipped as MP3 files in
`web/public/audio/` (with `manifest.json`). The team records with **ElevenLabs** (paid account): Greek and English
with `eleven_multilingual_v2` (best quality, 1 credit per character), Italian, Spanish and German with
`eleven_flash_v2_5` (half a credit), about **90,000 credits** for all five. **Microsoft Azure Speech** is the free
alternative (`"provider": "azure"`). The words come from `web/src/audio/narration.ts`, the same code the screens use,
so a recording always matches the screen. Each line is one clip named by a hash of its words: when a text changes,
only that line is recorded again, and until then it is read by the device's voice. 231 lines per language.

```sh
cd web
npm run narration -- --dry-run                       # lines, characters and credits (free, no key)
# Windows PowerShell:  $env:ELEVENLABS_API_KEY="..."     macOS/Linux:  export ELEVENLABS_API_KEY=...
npm run narration -- --library --lang el             # the most used Greek library voices, with free preview links
npm run narration -- --add <owner>:<voice> --name "Greek narrator"   # add one to the account; prints its voice_id
npm run narration -- --lang it,es,de --auto-voice   # pick a calm male narrator per language, save it, record
npm run narration -- --redo-list scripts/narration-redo.txt   # record again the clips a listening check found faulty
npm run narration -- --voices                        # the voices in the account (incl. ElevenLabs' own)
npm run narration -- --sample "Καλώς ήρθες, φύλακα!" --voice <voice_id>   # one test clip (web/narration-samples/)
#   put the chosen voice_id per language in content/narration.json (elevenlabs.voices)
npm run narration -- --lang el --limit 5             # five Greek lines first: listen in web/public/audio/el/
npm run narration                                    # everything that is missing, all five languages
npm run narration -- --prune                         # remove recordings no text uses any more
```

- Before recording, the account's ElevenLabs credits are checked; the run stops if they are too few (`--force`
  records anyway, as far as they go).
- Keys are read from environment variables only (`ELEVENLABS_API_KEY`, or `AZURE_SPEECH_KEY` and
  `AZURE_SPEECH_REGION`); never put them in a file of this repository.
- `content/narration.json`: the service, models, one voice per language, voice settings and `say_as` pronunciation
  fixes used only in the recording (e.g. ARGUS → «Άργκους» in Greek; needs review). Invisible hyphenation marks and
  " · " are cleaned before recording. After changing the service, a model, a voice or the settings, run with `--redo`.
- Italian, Spanish and German use the translated content in `web/public/data/i18n/`, as the game does.
- Progress is saved after every clip, so an interrupted run continues where it stopped; failed lines are retried
  on the next run. Then commit `web/public/audio/`.
- Offline: clips are not downloaded up front; each one is kept by the service worker the first time it plays.
- Licence: a paid ElevenLabs plan includes a commercial licence; check the terms of the voices you choose from the
  library (some owners set conditions) before publishing.

## Offline

`npm run build` writes `dist/sw.js`, a small service worker with the list of built files. After one visit the game,
its data and the drawn plan work without internet. Map pictures are never stored (their providers do not allow
offline copies). A new build replaces the stored copy on the next visit. Built files have content hashes and are
served from the stored copy first; the data pack (`data/`) has none, so it comes from the network first and from the
stored copy only offline. If the data pack's `schema_version` does not match the game (an earlier version's offline
copy answered), the game removes its service worker and stored files and reloads once; a crash on any screen shows
a message with a reload button instead of an empty page.

## Publishing: the public copy on a Raspberry Pi

**The game online: <http://pi-address.invalid/>**

Every push to `main` goes live by itself, about two minutes later, and only if the tests pass.

```
push to main ──► GitHub Actions (.github/workflows/site.yml): data tests, web tests, build
                    └─► branch "site": the built site only (web/dist, about 3 MB), one commit, replaced each time
Raspberry Pi: every minute guardian-update fetches "site" ──► /var/www/guardian ──► Caddy :8080 ──► playit.gg tunnel
ARGUS API ──► every 15 minutes guardian-live ──► /var/lib/guardian-live/public ──► Caddy, as /live/argus-now.json
```

- **The repository stays private.** The Pi has a read-only deploy key and fetches only the `site` branch, so the
  snapshots never leave GitHub. The public copy holds what any player's browser gets anyway: the game,
  `game_data.json`, the drawn plans and the photos.
- **A failing test stops a release:** nothing is published and the Pi keeps serving the last good version. Actions →
  "Build the site" shows each run, and `/VERSION` on the site gives the commit being served.
- **The Pi only serves files.** It is a Zero 2 W (512 MB), too small to build. The web server is Caddy rather than
  nginx: the Pi's Debian 11 no longer gets security updates, so its nginx would be an old one, while Caddy is a
  current official release, checked against its published checksums.
- **The tunnel** is playit.gg (the agent runs as `playit.service`): a TCP tunnel to `127.0.0.1:8080`, created in the
  playit.gg dashboard; its address is <http://pi-address.invalid/>. It is plain `http://`,
  so the offline mode, which browsers allow only over `https://`, is off there; the game itself works fully.
- **Live from ARGUS.** The snapshot stops in October 2026, but ARGUS keeps watching. Every 15 minutes the Pi
  (`tools/pi/guardian_live.py`, its own sandboxed user) asks the ARGUS API, read-only, for the records added since
  its last run, and writes the latest check of each danger and the newest sensor alarms to one small file. The first
  screen shows, for the chosen monument, last night's check (the dangers above "quiet", or the one nearest its
  limit) and the newest alarm the game can explain, picked by the same rules as the game's own alarms
  (`web/src/game/live.ts`). The Pi reads ARGUS, not the players' browsers: one reader for every visitor, and the
  game keeps working if ARGUS is down. With no file, a check older than two weeks or offline, the box is not shown.
- Setup, logs and how to set up a new Pi: [tools/pi/README.md](tools/pi/README.md).

## Next steps (to 24 October)

| By | Task |
|---|---|
| 14 Oct | Review authored content (stories, Greek, threat texts, primary cards, quiz, checklist, units); fix from feedback |
| 15 Oct | Keep an eye on the offline check (`npm run screenshots`): it failed in earlier runs and passes now, cause not identified |
| 13 Oct | Done: the public copy on the Raspberry Pi, updated on every push, at <http://pi-address.invalid/> (see Publishing) |
| 16 Oct | Set up Supabase (optional); test a class code across two devices |
| 20 Oct | Plan the Pi's operating-system upgrade (Debian 11 no longer gets security updates) |
| 18 Oct | Decide base-map licences; ask ARGUS about units, the stuck soil sensor, the meaning of the AI alarms, and whether showing their newest checks and alarms on the public copy is fine |
| 22 Oct | **Playtest** with a class or visitors (pre/post quiz gives the evidence); manual screen-reader and keyboard audit |
| 23 Oct | Fixes, short video, submission text |
| 24 Oct | Submit (deadline 25 Oct, 23:59 Athens) |

## Data and credentials

- `snapshot_2026-10-12/` is a complete fetch of the ARGUS API (`tools/fetch_snapshot.py`: public, read-only, no token);
  the build always uses the newest snapshot folder. `snapshot/` is the first copy (43 MB, fetched 11 Oct 2026, sampled
  events), kept unchanged as the reference for the facts tests, committed so the whole team builds from the same
  data. It is read-only input, and the repository must stay private unless the challenge's data terms allow
  publishing it. `game_data.json` holds only the fields the game needs.
- The public copy holds only the built site (see Publishing); the Pi's deploy key can read this repository and
  nothing else, and cannot write to it. The Pi's live file holds only what the ARGUS API gives anyone (no token):
  the latest risk checks and sensor alarms, as ARGUS gave them.
- The API spec (`specs.json`) and `test_api.py` live outside this folder. Never copy tokens or credentials into this
  repository; `.gitignore` excludes `test_api.py`, `.env` and `*.token` as a safety net.
