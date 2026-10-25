# Aegis: data-analysis pipeline

How Aegis turns ARGUS's raw records into the dangers, sensor networks and real alarms a player meets in the game.
This is a working pipeline: `tools/build_game_data.py` runs it on every data update, the build checks it, and its
results are published.

- **The output, as the game reads it:** <https://aloualou56.github.io/argus_trackA/data/game_data.json>
- **The analysis report it writes:** `docs/data_notes.md` in the repository (counts, exclusions, data quirks, assumptions)
- **The game that uses it:** <https://aloualou56.github.io/argus_trackA/>

## Standards used

| What | Standard | File |
|---|---|---|
| The phases of the analysis | **CRISP-DM** (Cross-Industry Standard Process for Data Mining) | this file, and the group titles of `1-pipeline` |
| Every step, its rules and thresholds, and the count it produces | **Pipeline DAG** (directed acyclic graph, as used by Airflow and dbt) | `1-pipeline.png` / `.svg` |
| How many alarm records enter, are excluded (and why), and remain | **Participant-flow diagram, CONSORT / PRISMA style** | `2-alarm-funnel.png` / `.svg` |
| What goes in and what comes out | **Data dictionary** | this file, below |
| How to run it again and get the same result | **Reproducibility statement** | this file, below |

The `.mmd` files are the diagrams' Mermaid source. Every count below comes from `docs/data_notes.md`, which the
pipeline writes itself.

## CRISP-DM phases

| Phase | In Aegis |
|---|---|
| **1. Business understanding** | ARGUS's monitoring is written for experts. The question is: which dangers, sensors and real alarms can a student understand and act on? |
| **2. Data understanding** | A complete snapshot of the ARGUS API (12 Oct 2026): 5 monuments, 156 threat records, 1,350 risk evaluations, 1,543 events, 123 installed instruments. Its quirks are listed in `docs/data_notes.md`. |
| **3. Data preparation** | Parse, clean, de-duplicate and exclude implausible data; join instruments to their types and positions (steps 1–4 in `1-pipeline`). |
| **4. Modelling** | Rules, not machine learning: the ABC priority gives the game level, sensor maps say which sensors can warn, and alarms are grouped into episodes with a measured severity (steps 2–5). |
| **5. Evaluation** | `--check` validation stops the build on any unknown category, sensor or rule. 101 Python tests and 197 web tests gate publishing. The assumptions that need a human are listed. |
| **6. Deployment** | `game_data.json` is published with the game. The game analyses the player's network against the real alarms, and live ARGUS data is reduced every 2 hours on a Raspberry Pi. |

## The pipeline, step by step

| Step | Input | Rule | Result |
|---|---|---|---|
| 1. Load and clean | 12 ARGUS resources + our tables | parse each record's embedded metadata (JSON in a string); drop the test record "Katastrofh"; match each monument to its ARGUS asset | 5 monuments |
| 2a. Risk scenarios | 156 `threats` | keep `kind: abc_risk_scenario` | **99** scenarios |
| 2b. Priority | ARGUS's ABC scores (a, b, c, magnitude) | ARGUS's priority label becomes the game level | low 30 · medium 20 · high 16 · extreme 23 · catastrophic 10 |
| 2c. Which sensors can warn | danger → sensor map (ours) | by scenario key, otherwise by risk category; primary (watches it) or supporting | `capable_cards`, `primary_cards` per danger |
| 2d. Risk history | 1,350 `threat-contexts` | `kind: ira_threat_evaluation`; keep periods raised above "inactive" (watch, active, escalated) with peak probability | **1,133** evaluations of 51 scenarios; **1** raised (watch, wind erosion at the House of the Masks) |
| 3. ARGUS's network | installed instruments, devices, instruments, types | instrument → type → game sensor card; position from the device; virtual or unplaced kept aside | **123** records = **117** distinct instruments |
| 4a. Alarms | 1,543 `events` | AD-RT alarms per monument | **337** (expert rule EK 217, AI model DL 120) |
| 4b. De-duplicate | 337 | same type, rule, timestamp and variables | **257** unique (−80) |
| 4c. AI alarms → a rule | 257 | main signal = largest feature contribution; keep only if its share ≥ **30 %** and it maps to a sensor | **191** (−66) |
| 4d. Complete | 191 | exactly one variable, a rule in the alarm-rule → sensor map, a value and a threshold | **167** (−24) |
| 4e. Plausible | 167 | humidity and soil moisture 0–100 %, rain 0–1000 mm, temperature −50 to 60 °C, per-rule ranges, exact 0 humidity or soil moisture = sensor dropout | **90** usable (−77) |
| 4f. Measure | 90 | direction above/below; severity = value ÷ threshold; flag thresholds that differ from the current AD-RT policy | severity per alarm |
| 4g. Episodes | 90 | same rule; a new episode after a **48 h** gap; flat signal when the spread is < **2 %** of the mean over ≥ 3 alarms | episodes per rule |
| 4h. Featured | episodes | first, peak and last of each episode; topped up to ≥ **5** by severity; at most **10** per monument (peaks first) | **33** featured |
| 4i. Link | 33 | the ARGUS instruments that raised each alarm (and where); what ARGUS decided after it | sensors and decisions per alarm |
| 5. Levels and missions | dangers, alarms, coins per level | a level for each priority with dangers; a mission of **3** dangers (curated, or the top 3 by magnitude that a sensor can watch); the alarm to replay (curated, or the strongest peak, never a flat signal) | **19** levels over 5 monuments |
| 6. Validate | everything | every risk category, card, rule, checklist item and text must be known; otherwise the build stops | `game_data.json`, `docs/data_notes.md` |

### The alarm funnel per monument

| Monument | Records | Unique | Excluded | Usable | Featured |
|---|---:|---:|---:|---:|---:|
| Delos | 46 | 37 | 6 | 31 | 8 |
| Baltanás | 41 | 32 | 32 | 0 | 0 |
| Monti Lucretili | 135 | 97 | 81 | 16 | 10 |
| Sant'Antonio di Ranverso | 101 | 81 | 47 | 34 | 7 |
| Schenkenberg | 14 | 10 | 1 | 9 | 8 |
| **Total** | **337** | **257** | **167** | **90** | **33** |

All of Baltanás's alarms are AI alarms with no single clear signal (26) or one not mapped to a sensor (6). So
Baltanás has no alarm to replay, and the game says so and shows its places in 3D instead.

## Analysis in the game (deployment)

| What | Rule |
|---|---|
| A week on duty | day 1 is the level's alarm; the following days are the monument's other featured alarms, a different kind of alarm each day while there is one, oldest first; up to 7 days, the same week for everyone |
| Detection | an alarm rule lists groups of sensors; the player's network catches it if it has at least one sensor from every group |
| Coverage | each mission danger is fully covered by a primary sensor, partly by a supporting one |
| Score (out of 100) | 20 points per fully covered danger and 8 per partly covered one; 25 if the alarm is caught; up to 15 for the share of coins spent on useful sensors. 85 or more = excellent, 60 = good, 30 = learning |
| You vs ARGUS | the player's sensors per card next to ARGUS's real network, with discussion prompts (never a penalty) |
| Live from ARGUS | the same alarm filter as the build (published in `game_data.json`); the dangers raised now (escalated, active, watch) or the one nearest its watch level; risk checks up to 14 days old, alarms up to 2 months old |
| Damage in 3D | years × our authored damage rates per danger, labelled an illustration, never a forecast |

## Data dictionary

**Inputs.** The ARGUS API, through the snapshot.

| Resource | Records | Fields used |
|---|---:|---|
| `assets` | 5 | id, name, pilot key |
| `asset-states` | 47 | asset id, metadata (3D model placements) |
| `threats` | 156 | metadata: `kind`, `scenario_key`, `risk_category`, `abc` (a, b, c, mr, priority_label), `pilot_key`, description |
| `threat-contexts` | 1,350 | metadata: `kind`, `scenario_key`, `evaluated_at`, `evaluation` (state, probability, thresholds) |
| `events` | 1,543 | metadata `alarm`: site, type (EK/DL), rule, timestamp, variables (name, value, threshold), score, `top_feature_contributions` |
| `policies` | 181 | `policy_type_id` 2 (AD-RT): rule, `threshold_overrides` |
| `installed-instruments` | 123 | name (serial, place), instrument id, device id |
| `installed-devices` | 117 | coordinates, position source |
| `instruments` / `instrument-types` | 117 / 40 | instrument type name |
| `decisions` / `decision-contexts` | from the first snapshot | the decision recorded after an alarm |

**Inputs.** Our curated tables (`content/*.json`, written by the team and marked "needs review" where an expert should check them)

| File | What it holds |
|---|---|
| `sensor_cards.json` | the game's sensors: names, prices, what each tells, the ARGUS instrument types each stands for |
| `threat_sensor_map.json` | danger → sensors that can warn (by scenario key or risk category) |
| `rule_sensor_map.json` | ARGUS alarm rule → groups of sensors that detect it; per-rule plausible ranges; AI-signal patterns |
| `coins.json` | coins per level |
| `monuments/*.json` | per monument: plain-language texts, curated missions and featured alarms |

**Outputs**

| File | What it holds |
|---|---|
| `web/public/data/game_data.json` | monuments; dangers with priority, sensor maps and risk history; ARGUS's network (per card and per position); featured alarms with value, threshold, severity, episode, sensors and decision; levels and missions; the alarm filter rules the game reuses for live data |
| `docs/data_notes.md` | per monument: scenario counts by level, levels, installed instruments, the alarm funnel and its exclusions, the featured alarms; data quirks; the list of assumptions that need a human |

## Quality and validation

- **Validation:** `python3 -I tools/build_game_data.py --check` builds everything, writes nothing, and fails on any unknown risk category, sensor, rule or reference.
- **Tests:** 101 Python tests (`tools/tests`) and 197 web tests (Vitest, `web/tests`) run on every build in GitHub Actions. Nothing is published if one fails.
- **Data-quality flags are kept with each alarm:** a threshold that differs from the current policy, duplicate records with different values, and flat (probably stuck) signals. A flat signal is never replayed.
- **No invented data:** what is ARGUS's comes from ARGUS unchanged. What is ours (sensor maps, prices, texts, damage rates) is in clearly named files and marked "needs review".

## Reproducibility

```sh
python3 -I tools/fetch_snapshot.py            # a new, dated snapshot (the original one is never overwritten)
python3 -I tools/build_game_data.py --check   # analyse and validate, write nothing
python3 -I tools/build_game_data.py           # write game_data.json and docs/data_notes.md
python3 -I -m unittest discover -s tools/tests -t tools
cd web && npm ci && npm test
```

- **Deterministic:** the output carries no build timestamp, so running it again on the same snapshot gives byte-identical files.
- **Pinned input:** snapshots are dated folders kept read-only (`snapshot_2026-10-12`). The pipeline uses the newest one.
- **Few dependencies:** Python standard library only (3.9+) for the analysis. Node 20 for the web tests.

## Limitations

- **A dated snapshot:** the analysis covers ARGUS's records up to 12 Oct 2026 (alarms from 28 Aug to 8 Oct 2026). Newer risk checks and alarms reach the game through the live data, not this pipeline.
- **Data quirks found and handled:**
  - Ranverso's indoor-humidity alarms are recorded at 110–558 % against a threshold of 80.
  - Monti Lucretili's temperature-range alarms are physically impossible.
  - The AI alarms at Ranverso are all driven by one NO2 sensor, with scores in the millions.
  - Many events are exact duplicates.

  Each is listed in `docs/data_notes.md` with what the pipeline does about it.
- **Expert review needed:** the sensor maps, sensor prices, plausible ranges, the 30 % AI-signal share and the 48 h episode gap are our choices. They are listed as assumptions for a heritage-monitoring expert to review.
- **Rules, not machine learning:** the pipeline makes no predictions of its own. The only predictive models are ARGUS's (the risk evaluations and the AI alarms), which it reports as given.
