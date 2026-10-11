# Guardian for a Day · Φύλακας για μια μέρα

A plain-language web game for the ARGUS Open Innovation Challenge 2026, Track A (Heritage and Citizen Science).
The game is played on an interactive satellite map. The player picks a monument on a map of Europe, flies in, and
places sensors on the real building on a small budget. Then the real ARGUS sensors appear on the map at their real
positions, a real ARGUS alarm from August–September 2026 lights up the sensor that raised it, and the player gets a
score with a short explanation of each danger.

Status (11 Oct 2026): playable vertical slice for **Sant'Antonio di Ranverso**, in Greek and English.
The other four monuments are listed as "coming soon" and become playable by adding data only.

## Run it

You need Python 3.9+ (standard library only) and Node 20+.

```sh
# 1. Build the data pack from the ARGUS snapshot (reads snapshot/, never writes to it)
python3 -I tools/build_game_data.py            # writes web/public/data/game_data.json and docs/data_notes.md
python3 -I tools/build_game_data.py --check    # validate only
python3 -I tools/fetch_backdrops.py            # once per new monument (needs internet): drawn-plan outlines

# 2. Data tests (counts, plausibility, mappings)
python3 -I -m unittest discover -s tools/tests -t tools -v

# 3. Web app
cd web
npm install
npm run dev          # http://localhost:5173
npm test             # game logic, i18n and community-store tests
npm run build        # static site in web/dist
npm run screenshots  # needs a build: plays the game in Edge, saves docs/screenshots, runs axe a11y checks
```

`web/dist` is a static site with relative paths: upload it to GitHub Pages, Netlify or Vercel as is.
`npm run screenshots` saves what each screen shows (`*.png`) and, for phones, the whole scrolling panel
(`*-panel.png`; the sticky map cannot appear in full-page captures).
Add `?review` to the URL to outline every authored text that still needs human review.

Windows note: the npm scripts call `node node_modules/...` directly because the usual `.bin` shims break when the
project path contains `&` (as in `Projects & code`). Use `BROWSER_CHANNEL=chrome npm run screenshots` to use Chrome.

## How it fits together

```
snapshot/*.json  ──┐                                   (ARGUS data, read-only, not in git)
content/*.json   ──┼─► tools/build_game_data.py ─► web/public/data/game_data.json  ─► web app
                   │                             └► docs/data_notes.md (counts, quirks, assumptions)
                   └─ everything the team writes: cards, costs, mappings, stories, prompts
```

| Path | What it is | Source |
|---|---|---|
| `content/sensor_cards.json` | 16 sensor cards: plain names, one sentence, coin cost, ARGUS instrument types | authored |
| `content/rule_sensor_map.json` | AD-RT rule → sensor cards that detect it, keyed `pilot:rule`, all 37 policies | authored |
| `content/threat_sensor_map.json` | threat → sensor cards that can warn about it (for the score) | authored |
| `content/monuments/<pilot>.json` | story, budget, missions per level, plain threat texts, alarm explanations, discussion prompts | authored |
| `content/map.json` | base maps for the board (satellite and street map, no API key) with attribution | authored |
| `tools/build_game_data.py` | joins snapshot + content, de-duplicates and filters alarms, validates everything | code |
| `web/src/game/logic.ts` | budget, coverage, detection, score, reveal comparison, map distances (pure, tested) | code |
| `web/src/components/GameMap.tsx` | the game board: one Leaflet map kept across screens; screens change what it draws | code |
| `web/src/community/store.ts` | anonymous aggregated choices; `CommunityStore` interface + localStorage fallback | code |
| `web/src/i18n/{el,en}.json` | every UI string; Greek is the default | authored |

The browser loads only `game_data.json` (about 65 KB). It never loads `asset-states.json`.

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
- **Placing:** move the map so the reticle is where you want the sensor, then press + on a card (tap the map to move
  the reticle; drag pins to adjust; tap a pin to remove it). The reticle's centre dot is the exact spot; it sits
  under the pins, lifts while the map moves and "drops" when a sensor is placed. Satellite images get no pin.

### Add a monument (data only)

1. Copy `content/monuments/ranverso.json` over the draft `content/monuments/<pilot>.json` and remove `"draft": true`.
2. Fill in `display_name`, `place`, `story` (with `hook_scenario`), `budget`, `missions` (3 scenario keys per level;
   omit a level to let the script pick by ABC magnitude), `plain_threats` for every scenario, `featured_alarm`,
   `alarm_context` for each featured rule, and `discussion_prompts`.
3. Add scenario overrides to `content/threat_sensor_map.json` if the category defaults do not fit.
4. Run `python3 -I tools/build_game_data.py`. It refuses to build if a text, mapping or mission is missing.

Delos and Baltanás have only deep-learning alarms in the sample (no rule names), so the "real alarm" step has nothing
to replay there yet; the game shows a polite message instead. See next steps.

## Game rules (assumptions, need review)

- **Levels** are the ABC priority labels. Only labels the monument has are offered (Ranverso has no Catastrophic).
- **Mission:** 3 real threats per level; budget 10 coins; cards cost 1–4 coins (game coins, not real prices).
- **Score:** 25 points per threat covered by at least one capable card (75) + up to 25 for the share of coins spent
  on cards that help with a mission threat or the replayed alarm. The replayed alarm itself is not scored.
- **Detection:** the network detects an alarm if it has a card from every group in the rule's `detect_with`.
- **Placement on the map is not scored.** It is used for discussion ("your humidity sensor is 12 m from the
  nearest ARGUS one: why did they put it there?"). There is no real building outline to judge inside/outside:
  the only footprint in the data is a test shape for Baltanás.
- **Reveal:** counts distinct ARGUS instruments (Ranverso: 26 records but 20 instruments), grouped by card.
  Differences become discussion prompts, never penalties.
- **Alarms shown:** expert-rule alarms only, de-duplicated, with plausible values (humidity and soil moisture
  0–100, no exact zeros). For each episode: first, strongest and last alarm, 5–10 per monument.

The full, generated list of assumptions and data quirks is in [docs/data_notes.md](docs/data_notes.md).

## Assumptions that need a human

1. **History and science text:** Ranverso story (facts not in the ARGUS data), all 26 plain-language threat texts,
   alarm explanations, discussion prompts. Native-speaker check of all Greek.
2. **Sensor cards:** names, sentences and costs; merged types (lux + UV + pyranometer; vibration + accelerometer;
   soil moisture + water potential; people counter + barrier sensor).
3. **Mappings:** threat → cards (most entries flagged), rule → cards (8 flagged, e.g. `lucretili:R10_solar_zscore`,
   whose name says "solar" but whose description says "GNSS").
4. **Units:** not in the alarm data. We assume mm for rain and % for humidity and soil moisture. Ask ARGUS.
5. **Ranverso data:** soil moisture flat at about 2.47 for three weeks (stuck sensor?), all indoor humidity values
   above 100, double-registered instruments, the weather station marked `verification_required`.
6. **Game balance:** budget 10, scoring weights, verdict thresholds (85 / 60 / 30). Check in the playtest.
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

## Next steps (to 24 October)

| By | Task |
|---|---|
| 14 Oct | Review authored content (story facts, Greek, mappings, units); fix from feedback |
| 18 Oct | **Slice done:** Ranverso polished; offline support (service worker / PWA) |
| 19–20 Oct | Lucretili and Schenkenberg packs (both have rule alarms: crack, tilt, temperature, vibration) |
| 20–21 Oct | Delos and Baltanás packs; decide the alarm step for DL-only sites (e.g. map top DL features to cards, flagged) |
| 21 Oct | Community stats behind `CommunityStore` (Supabase or Firebase optional, local fallback stays); class code (teacher creates a 6-character code, players join, teacher sees the group's choices next to ARGUS) |
| 21 Oct | Pre/post quiz (5 questions, same before and after, stored anonymously with the play record) |
| 21 Oct | Map: community heat-map of where players put each sensor; decide base-map licences; ask ARGUS for real footprints (then "inside/outside" can teach placement) |
| 22 Oct | **Playtest** with a class or visitors; manual screen-reader and keyboard audit |
| 23 Oct | Fixes, final screenshots, short video, submission text |
| 24 Oct | Submit (deadline 25 Oct, 23:59 Athens) |

## Data and credentials

- `snapshot/` is ARGUS challenge data: read-only and git-ignored. `game_data.json` holds only the fields the game needs.
- The API spec (`specs.json`) and `test_api.py` live outside this folder. Never copy tokens or credentials into this
  repository; `.gitignore` excludes `test_api.py`, `.env` and `*.token` as a safety net.
