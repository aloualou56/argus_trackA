#!/usr/bin/env python3
"""Build the game's data pack from the ARGUS snapshot and our authored content.

    python3 -I tools/build_game_data.py           # write the outputs
    python3 -I tools/build_game_data.py --check   # build and validate, write nothing

Inputs (read-only):
  snapshot/*.json   ARGUS API snapshot, each {resource, count, complete, fetched_at, records[]}
  content/*.json    files authored by the game team (cards, mappings, monument texts)
Outputs:
  web/public/data/game_data.json   small file the browser loads
  docs/data_notes.md               counts, data quirks and the assumptions list

Standard library only, Python 3.9+. The output has no build timestamp so reruns are
diff-clean. A monument becomes playable by adding content/monuments/<pilot_key>.json.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
ORIGINAL_SNAPSHOT = ROOT / "snapshot"  # the first snapshot (11 Oct 2026), kept read-only as the facts reference


def latest_snapshot() -> Path:
    """The snapshot folder (snapshot/ or snapshot_<date>/ from tools/fetch_snapshot.py) fetched last."""
    found = []
    for folder in ROOT.glob("snapshot*"):
        assets = folder / "assets.json"
        if folder.is_dir() and assets.exists():
            found.append((json.loads(assets.read_text(encoding="utf-8")).get("fetched_at", ""), folder.name, folder))
    return max(found)[2] if found else ORIGINAL_SNAPSHOT


SNAPSHOT_DIR = latest_snapshot()
CONTENT_DIR = ROOT / "content"
OUT_JSON = ROOT / "web" / "public" / "data" / "game_data.json"
OUT_NOTES = ROOT / "docs" / "data_notes.md"
OUT_BACKDROPS = ROOT / "web" / "public" / "data" / "backdrops"
OUT_TRANSLATIONS = ROOT / "web" / "public" / "data" / "i18n"
OUT_PHOTOS = ROOT / "web" / "public" / "data" / "photos"
WEB_PUBLIC = ROOT / "web" / "public"  # pages a consequence may link (view_3d) live here
PHOTO_URL = "data/photos/{name}"  # relative to the web app
# Licences a photo may carry: free to show with credit (some ask that copies stay under the same licence).
PHOTO_LICENSES = ("CC0", "Public domain", "CC BY 2.0", "CC BY 3.0", "CC BY 4.0", "CC BY-SA 2.0", "CC BY-SA 3.0", "CC BY-SA 4.0")
BACKDROP_URL = "data/backdrops/{name}"  # relative to the web app

SCHEMA_VERSION = 3  # 3: decision step (data.decisions, alarm.decision); 2: coins per level, no monument budget
MISSION_SIZE = 3

# ABC priority labels as stored in threats.json, lowest first. Game levels use these.
LEVELS = [
    ("Low priority", "low"),
    ("Medium priority", "medium"),
    ("High priority", "high"),
    ("Extreme priority", "extreme"),
    ("Catastrophic priority", "catastrophic"),
]
LEVEL_IDS = dict(LEVELS)
LEVEL_ORDER = [key for key, _ in LEVELS]
LEVEL_RANK = {level_id: i for i, (_, level_id) in enumerate(LEVELS)}

# Test record in threats.json that must never reach the game.
IGNORED_THREAT_NAMES = {"Katastrofh"}

# Plausible raw ranges for alarm values, keyed by the card that measures them.
# Only physical quantities are checked; normalised scores and z-scores are not.
PLAUSIBLE_RANGES = {
    "humidity": (0.0, 100.0),
    "soil_moisture": (0.0, 100.0),
    "rain_gauge": (0.0, 1000.0),
    "temperature": (-50.0, 60.0),
}
# A value of exactly zero on these is treated as a probable sensor dropout.
ZERO_IS_SUSPECT = {"humidity", "soil_moisture"}
# Alarms more than this far apart start a new episode.
EPISODE_GAP = dt.timedelta(hours=48)
# Spread below this fraction of the mean marks an episode's signal as flat.
FLAT_SIGNAL_SPREAD = 0.02
# An AI (deep-learning) alarm is used only when one signal clearly drives it: its share of the
# model's top feature contributions must reach this, and content maps that signal to a card.
DL_MIN_SHARE = 0.3
MIN_FEATURED_ALARMS = 5
MAX_FEATURED_ALARMS = 10

# Resources the build reads. asset-states.json is large (about 31 MB) but only Python
# reads it, to map installed devices to monuments; it never reaches the browser.
RESOURCES = [
    "assets", "asset-states", "threats", "events", "threat-contexts", "policies",
    "installed-instruments", "installed-devices", "instruments", "instrument-types",
]
# Read when a snapshot has them, else from the first snapshot: what ARGUS recorded as the decision
# after each alarm. They do not count towards the snapshot date shown in the game.
OPTIONAL_RESOURCES = ["decisions", "decision-contexts"]

# The game's own text is written in English and Greek (content/*.json). Other languages are
# overlays in content/translations/<lang>.json, keyed by the exact English text.
BASE_LANGS = ("en", "el")
TRANSLATION_LANGS = ("it", "es", "de")


class BuildError(Exception):
    pass


# --------------------------------------------------------------------------- loading

def load_resource(snapshot_dir: Path, resource: str) -> Dict[str, Any]:
    path = snapshot_dir / f"{resource}.json"
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    for key in ("resource", "count", "complete", "fetched_at", "records"):
        if key not in data:
            raise BuildError(f"{path.name}: missing '{key}'")
    return data


def parse_metadata(record: Dict[str, Any]) -> Dict[str, Any]:
    """metadata is usually a JSON-encoded string; sometimes null or already an object."""
    raw = record.get("metadata")
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return {"_unparsed": raw}
        return value if isinstance(value, dict) else {"_value": value}
    return {"_value": raw}


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def load_snapshot(snapshot_dir: Path) -> Dict[str, Dict[str, Any]]:
    raw = {name: load_resource(snapshot_dir, name) for name in RESOURCES}
    for name in OPTIONAL_RESOURCES:
        folder = next((d for d in (snapshot_dir, ORIGINAL_SNAPSHOT) if (d / f"{name}.json").exists()), None)
        raw[name] = (load_resource(folder, name) if folder else
                     {"resource": name, "count": 0, "complete": False, "fetched_at": "", "records": []})
    return raw


def load_content(content_dir: Path) -> Dict[str, Any]:
    monuments = {}
    for path in sorted((content_dir / "monuments").glob("*.json")):
        pack = load_json(path)
        monuments[pack["pilot_key"]] = pack
    return {
        "cards": load_json(content_dir / "sensor_cards.json"),
        "rule_map": load_json(content_dir / "rule_sensor_map.json"),
        "threat_map": load_json(content_dir / "threat_sensor_map.json"),
        "quiz": load_json(content_dir / "quiz.json"),
        "checklist": load_json(content_dir / "citizen_checklist.json"),
        "map": load_json(content_dir / "map.json"),
        "site_guide": load_json(content_dir / "site_guide.json"),
        "coins": load_json(content_dir / "coins.json"),
        "decisions": load_json(content_dir / "decisions.json"),
        "photos": (load_json(content_dir / "photos" / "credits.json") if (content_dir / "photos" / "credits.json").exists()
                   else {"photos": {}}),
        "monuments": monuments,
        # The whole story of each site, read chapter by chapter from the story screen.
        "history": {path.stem: load_json(path) for path in sorted((content_dir / "history").glob("*.json"))},
    }


# --------------------------------------------------------------------------- helpers

def parse_ts(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def node_token(name: str) -> str:
    """Node id from an ARGUS instrument name, lower-case: the last ' - ' part once a trailing
    '(place)' is removed. 'Crackmeter - 177266 (Conventillo - Staircase)' -> '177266'."""
    return re.sub(r"\s*\([^)]*\)\s*$", "", name).rsplit(" - ", 1)[-1].strip().lower()


def place_label(name: str) -> Optional[str]:
    """Trailing '(place)' of an instrument name, e.g. 'Conventillo - Staircase access façade'."""
    match = re.search(r"\(([^)]*)\)\s*$", name)
    return match.group(1).strip() if match else None


def instrument_position(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """WGS84 position of an installed device (installed-devices metadata.coordinates), if any."""
    coords = (row.get("device_meta") or {}).get("coordinates")
    if not isinstance(coords, dict) or coords.get("latitude") is None or coords.get("longitude") is None:
        return None
    return {"lat": round(float(coords["latitude"]), 7), "lon": round(float(coords["longitude"]), 7),
            "height": round_or_none(coords.get("height"), 2)}


def map_view(points: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Median centre and bounding box of the sensor positions (real ARGUS data)."""
    if not points:
        return None
    lats = sorted(p["lat"] for p in points)
    lons = sorted(p["lon"] for p in points)
    return {"center": [lats[len(lats) // 2], lons[len(lons) // 2]],
            "bounds": [[lats[0], lons[0]], [lats[-1], lons[-1]]]}


def round_or_none(value: Optional[float], digits: int = 4) -> Optional[float]:
    return None if value is None else round(float(value), digits)


# --------------------------------------------------------------------------- indexes

class Snapshot:
    """Typed-ish view over the raw snapshot with the joins the game needs."""

    def __init__(self, raw: Dict[str, Dict[str, Any]]):
        self.raw = raw
        self.fetched_at = sorted({raw[r]["fetched_at"] for r in RESOURCES})
        self.assets = raw["assets"]["records"]
        self.asset_meta = {a["id"]: parse_metadata(a) for a in self.assets}
        self.state_to_asset = {s["id"]: s["asset_id"] for s in raw["asset-states"]["records"]}
        self.threats = raw["threats"]["records"]
        self.events = raw["events"]["records"]
        self.policies = raw["policies"]["records"]
        self.installed_instruments = raw["installed-instruments"]["records"]
        self.installed_devices = {d["id"]: d for d in raw["installed-devices"]["records"]}
        self.instruments = {i["id"]: i for i in raw["instruments"]["records"]}
        self.instrument_types = {t["id"]: t for t in raw["instrument-types"]["records"]}

        self.scenarios = []
        for t in self.threats:
            if t.get("name") in IGNORED_THREAT_NAMES:
                continue
            m = parse_metadata(t)
            if m.get("kind") == "abc_risk_scenario":
                self.scenarios.append((t, m))

        self.alarms = []
        for e in self.events:
            m = parse_metadata(e)
            if m.get("kind") == "ad_rt_event":
                self.alarms.append((e, m))

        self.ad_rt_policies = [(p, parse_metadata(p)) for p in self.policies if p.get("policy_type_id") == 2]
        # ARGUS risk model: regular re-evaluations of each scenario (probability and state)
        self.risk_evaluations = collections.defaultdict(list)
        for r in raw["threat-contexts"]["records"]:
            m = parse_metadata(r)
            if m.get("kind") == "ira_threat_evaluation" and m.get("scenario_key"):
                self.risk_evaluations[m["scenario_key"]].append(m)
        for evaluations in self.risk_evaluations.values():
            evaluations.sort(key=lambda m: m.get("evaluated_at", ""))
        self.pilot_to_asset = self._map_pilots_to_assets()
        self.alarm_decisions = self._link_decisions()

    def _link_decisions(self) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
        """(pilot, rule, alarm timestamp) -> the decision ARGUS recorded for that alarm."""
        decisions = {d["id"]: d for d in self.raw["decisions"]["records"]}
        linked = {}
        for ctx in sorted(self.raw["decision-contexts"]["records"], key=lambda c: c["id"]):
            m = parse_metadata(ctx)
            alarm = m.get("alarm") or {}
            decision = decisions.get(ctx.get("decision_id"))
            if m.get("kind") != "ad_rt_decision_context" or not decision or not alarm.get("rule"):
                continue
            dm = parse_metadata(decision)
            text = dm.get("recommendation") or decision.get("description")
            if text:
                linked.setdefault((m.get("pilot"), alarm["rule"], alarm.get("timestamp")),
                                  {"decision_id": decision["id"], "text": text, "urgency": dm.get("urgency")})
        return linked

    def _map_pilots_to_assets(self) -> Dict[str, Dict[str, Any]]:
        pilots = sorted({m["pilot_key"] for _, m in self.scenarios})
        result = {}
        for pilot in pilots:
            matches = [a for a in self.assets if pilot in str(self.asset_meta[a["id"]].get("code", ""))]
            if len(matches) != 1:
                raise BuildError(f"pilot '{pilot}' matches {len(matches)} assets by code")
            result[pilot] = matches[0]
        return result

    def instrument_rows(self, asset_id: int) -> List[Dict[str, Any]]:
        rows = []
        for ii in self.installed_instruments:
            device = self.installed_devices[ii["installed_device_id"]]
            if self.state_to_asset.get(device["asset_state_id"]) != asset_id:
                continue
            instrument = self.instruments[ii["instrument_id"]]
            itype = self.instrument_types[instrument["instrument_type_id"]]
            rows.append({
                "installed_instrument_id": ii["id"],
                "instrument_id": instrument["id"],
                "name": ii["name"],
                "instrument_type": itype["name"],
                "asset_state_id": device["asset_state_id"],
                "ii_meta": parse_metadata(ii),
                "device_meta": parse_metadata(device),
            })
        return sorted(rows, key=lambda r: r["installed_instrument_id"])


# --------------------------------------------------------------------------- content lookups

class Content:
    def __init__(self, raw: Dict[str, Any]):
        self.raw = raw
        self.cards = raw["cards"]["cards"]
        self.card_ids = [c["id"] for c in self.cards]
        self.type_to_card = {}
        for card in self.cards:
            for type_name in card["instrument_types"]:
                if type_name in self.type_to_card:
                    raise BuildError(f"instrument type '{type_name}' is on two cards")
                self.type_to_card[type_name] = card["id"]
        self.unmapped_types = set(raw["cards"].get("unmapped_instrument_types", {}).get("types", []))
        self.rules = raw["rule_map"]["rules"]
        self.dl_features = raw["rule_map"].get("dl_features", {}).get("patterns", [])
        self.threat_categories = raw["threat_map"]["categories"]
        self.threat_scenarios = raw["threat_map"]["scenarios"]
        self.monuments = raw["monuments"]
        self.basemaps = raw["map"]

    def rule(self, pilot: str, rule: str) -> Optional[Dict[str, Any]]:
        return self.rules.get(f"{pilot}:{rule}")

    def capable_cards(self, scenario_key: str, category: str) -> Tuple[List[str], List[str], bool, str]:
        """(all cards that help, the primary ones that watch the threat directly, needs_review, source)."""
        if scenario_key in self.threat_scenarios:
            entry = self.threat_scenarios[scenario_key]
            return list(entry["cards"]), list(entry["primary"]), bool(entry.get("needs_review")), "scenario"
        if category in self.threat_categories:
            entry = self.threat_categories[category]
            return list(entry["cards"]), list(entry["primary"]), bool(entry.get("needs_review")), "category"
        return [], [], True, "missing"


# --------------------------------------------------------------------------- builders

def risk_history(evaluations: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Periods when ARGUS's risk model raised a scenario above 'inactive' (watch, active, escalated).
    None when the scenario was never raised; the many routine 'inactive' evaluations are not copied."""
    raised, current = [], None
    for m in evaluations:
        e = m.get("evaluation") or {}
        state, at = e.get("state"), m.get("evaluated_at")
        if state and state != "inactive":
            if current is None or current["state"] != state:
                current = {"state": state, "probability": round_or_none(e.get("probability"), 3), "from": at, "until": None}
                raised.append(current)
            else:
                current["probability"] = max(current["probability"] or 0, round_or_none(e.get("probability"), 3) or 0)
        elif current is not None:
            current["until"] = at
            current = None
    if not raised:
        return None
    last = evaluations[-1].get("evaluation") or {}
    return {
        "raised": raised,
        "latest": {"state": last.get("state"), "probability": round_or_none(last.get("probability"), 3),
                   "at": evaluations[-1].get("evaluated_at")},
        "thresholds": last.get("thresholds"),
        "evaluations": len(evaluations),
    }


def build_scenarios(snap: Snapshot, content: Content, pilot: str, pack: Optional[Dict[str, Any]]):
    plain = (pack or {}).get("plain_threats", {})
    out = []
    for t, m in snap.scenarios:
        if m.get("pilot_key") != pilot:
            continue
        key = m["scenario_key"]
        cards, primary, cards_review, cards_source = content.capable_cards(key, m["risk_category"])
        text = plain.get(key)
        out.append({
            "threat_id": t["id"],
            "scenario_key": key,
            "risk_category": m["risk_category"],
            "description": t.get("description"),
            "heritage_asset": m.get("heritage_asset"),
            "status": m.get("status"),
            "abc": {k: m["abc"].get(k) for k in ("a", "b", "c", "mr")},
            "priority_label": m["abc"]["priority_label"],
            "level": LEVEL_IDS.get(m["abc"]["priority_label"]),
            "source": m.get("source"),
            "plain": {
                "title": text["title"] if text else None,
                "text": text["text"] if text else None,
                "authored": True,
                "needs_review": True,
            },
            "capable_cards": cards,
            "primary_cards": primary,
            "capable_cards_source": cards_source,
            "capable_cards_needs_review": cards_review,
            "risk": risk_history(snap.risk_evaluations.get(key, [])),
        })
    out.sort(key=lambda s: (-(s["abc"]["mr"] or 0), s["threat_id"]))
    return out


def build_installed(snap: Snapshot, content: Content, asset_id: int) -> Dict[str, Any]:
    rows = snap.instrument_rows(asset_id)
    by_instrument = collections.OrderedDict()
    for row in rows:
        by_instrument.setdefault(row["instrument_id"], []).append(row)

    by_card = collections.OrderedDict()
    other = collections.Counter()
    flags = []
    points = collections.OrderedDict()
    positions = {}
    unplaced = []
    for instrument_id, regs in by_instrument.items():
        first = regs[0]
        card = content.type_to_card.get(first["instrument_type"])
        item = {"instrument_id": instrument_id, "card": card, "instrument_type": first["instrument_type"],
                "node": node_token(first["name"])}
        pos = instrument_position(first)
        src = (first["device_meta"] or {}).get("source") or {}
        if pos is None:
            reason = ("virtual" if str(first["ii_meta"].get("kind", "")).startswith("virtual")
                      else "coordinates unavailable" if src.get("coordinates_from") == "unavailable"
                      else "no coordinates")
            unplaced.append(dict(item, reason=reason))
        else:
            positions[instrument_id] = pos
            point = points.setdefault((pos["lat"], pos["lon"]),
                                      dict(pos, label=place_label(first["name"]), instruments=[], flags=[]))
            point["instruments"].append(item)
            point_flag = None
            if src.get("verification_required") or str(src.get("coordinates_from", "")).startswith("temporary"):
                point_flag = "temporary_position"
            elif src.get("coordinates_from") == "sibling sensor on same node":
                point_flag = "position_from_sibling_sensor"
            if point_flag and point_flag not in point["flags"]:
                point["flags"].append(point_flag)
        if card is None:
            other[first["instrument_type"]] += 1
        else:
            slot = by_card.setdefault(card, {"card": card, "count": 0, "instrument_types": collections.Counter(), "nodes": []})
            slot["count"] += 1
            slot["instrument_types"][first["instrument_type"]] += 1
            slot["nodes"].append(node_token(first["name"]))
        for reg in regs:
            meta = reg["ii_meta"]
            src = (reg["device_meta"] or {}).get("source") or {}
            if meta.get("verification_required") or src.get("verification_required"):
                flags.append({"installed_instrument_id": reg["installed_instrument_id"], "flag": "verification_required",
                              "detail": "Coordinates marked temporary; device was re-assigned from another site."})
            if str(meta.get("kind", "")).startswith("virtual"):
                flags.append({"installed_instrument_id": reg["installed_instrument_id"], "flag": "virtual",
                              "detail": "Virtual Earth Observation layer, not a physical sensor on site."})

    duplicates = [
        {"instrument_id": iid, "installed_instrument_ids": [r["installed_instrument_id"] for r in regs],
         "names": [r["name"] for r in regs]}
        for iid, regs in by_instrument.items() if len(regs) > 1
    ]
    virtual = sum(1 for f in flags if f["flag"] == "virtual")
    card_rows = []
    for card_id in content.card_ids:
        if card_id in by_card:
            slot = by_card[card_id]
            card_rows.append({"card": card_id, "count": slot["count"],
                              "instrument_types": dict(sorted(slot["instrument_types"].items())),
                              "nodes": sorted(slot["nodes"])})
    return {
        "asset_state_ids": sorted({r["asset_state_id"] for r in rows}),
        "records": len(rows),
        "distinct_instruments": len(by_instrument),
        "physical_instruments": len(by_instrument) - virtual,
        "by_card": card_rows,
        "other": [{"instrument_type": k, "count": v} for k, v in sorted(other.items())],
        "duplicate_records": duplicates,
        "flags": flags,
        "points": list(points.values()),
        "unplaced": unplaced,
        "_rows": rows,  # removed before writing; used to link alarms to instruments
        "_positions": positions,
    }


def dl_rule(content: Content, alarm: Dict[str, Any]) -> Tuple[Optional[str], Optional[str], float]:
    """(pseudo-rule, main feature, its share) for an AI alarm, from content's dl_features patterns."""
    features = alarm.get("top_feature_contributions") or {}
    if not features:
        return None, None, 0.0
    name = max(features, key=features.get)
    rule = next((p["rule"] for p in content.dl_features if re.search(p["match"], name)), None)
    return rule, name, float(features[name])


def primary_card(rule_entry: Dict[str, Any]) -> Optional[str]:
    groups = rule_entry.get("detect_with") or []
    return groups[0][0] if groups and groups[0] else None


def policy_thresholds(snap: Snapshot, pilot: str) -> Dict[str, List[float]]:
    out = collections.defaultdict(list)
    for _, m in snap.ad_rt_policies:
        if m.get("pilot") == pilot:
            for value in (m.get("threshold_overrides") or {}).values():
                if isinstance(value, (int, float)):
                    out[m.get("rule")].append(float(value))
    return out


def build_alarms(snap: Snapshot, content: Content, pilot: str, installed_rows: List[Dict[str, Any]],
                 positions: Dict[int, Dict[str, Any]]):
    """Return (featured alarms, funnel summary). See docs/data_notes.md for the rules."""
    site_alarms = [(e, m) for e, m in snap.alarms if (m.get("alarm") or {}).get("site") == pilot]
    funnel = collections.OrderedDict()
    funnel["records"] = len(site_alarms)
    funnel["by_type"] = dict(sorted(collections.Counter(m["alarm"].get("type") for _, m in site_alarms).items()))
    funnel["by_rule"] = dict(sorted(collections.Counter(m["alarm"].get("rule") or "(DL, no rule)" for _, m in site_alarms).items()))

    # 1. de-duplicate: same type, rule, timestamp and variable names
    unique = collections.OrderedDict()
    for e, m in sorted(site_alarms, key=lambda x: x[0]["id"]):
        a = m["alarm"]
        variables = a.get("variables") or []
        names = tuple(v.get("name") for v in variables) or tuple(sorted(a.get("top_feature_contributions") or {}))
        key = (a.get("type"), a.get("rule"), a.get("timestamp"), names)
        if key in unique:
            unique[key]["event_ids"].append(e["id"])
            if [v.get("value") for v in variables] != [v.get("value") for v in unique[key]["alarm"].get("variables") or []]:
                unique[key]["value_variants"] += 1
        else:
            unique[key] = {"event_ids": [e["id"]], "alarm": a, "value_variants": 0}
    funnel["unique"] = len(unique)

    # 2. exclude what the game must not show
    thresholds = policy_thresholds(snap, pilot)
    kept = []
    excluded = collections.Counter()
    for item in unique.values():
        a = item["alarm"]
        rule = a.get("rule")
        feature_share = None
        if a.get("type") == "DL":
            # AI alarms have no rule: use the signal that drove the decision, if it is clear and mapped.
            rule, feature, feature_share = dl_rule(content, a)
            if feature is None or feature_share < DL_MIN_SHARE:
                excluded[f"AI alarm with no clear main signal (top contribution below {DL_MIN_SHARE:.0%})"] += 1
                continue
            if rule is None:
                excluded["AI alarm whose main signal is not mapped to a card (e.g. wind direction)"] += 1
                continue
            variables = [{"name": feature, "value": a.get("score"), "threshold": a.get("threshold")}]
        elif not rule:
            excluded["expert-rule alarm without a rule name"] += 1
            continue
        else:
            variables = a.get("variables") or []
        entry = content.rule(pilot, rule)
        if entry is None:
            excluded["rule not in content/rule_sensor_map.json"] += 1
            continue
        if len(variables) != 1:
            excluded["not exactly one variable"] += 1
            continue
        var = variables[0]
        value, threshold = var.get("value"), var.get("threshold")
        if not isinstance(value, (int, float)) or not isinstance(threshold, (int, float)) or threshold == 0:
            excluded["missing value or threshold"] += 1
            continue
        card = primary_card(entry)
        # An AI alarm's value is the model's anomaly score, not a physical quantity.
        lo_hi = PLAUSIBLE_RANGES.get(card) if a.get("type") == "EK" else None
        if lo_hi and not (lo_hi[0] <= value <= lo_hi[1]):
            excluded[f"implausible {card} value (outside {lo_hi[0]:g} to {lo_hi[1]:g})"] += 1
            continue
        # A rule can narrow the range further when it measures a derived quantity (e.g. a daily range).
        rule_range = entry.get("plausible")
        if rule_range and not (rule_range[0] <= value <= rule_range[1]):
            excluded[f"implausible value for {rule} (outside {rule_range[0]:g} to {rule_range[1]:g})"] += 1
            continue
        if card in ZERO_IS_SUSPECT and value == 0:
            excluded[f"{card} value exactly 0 (probable sensor dropout)"] += 1
            continue
        flags = []
        if thresholds.get(rule) and float(threshold) not in thresholds[rule]:
            flags.append("threshold_differs_from_current_policy")
        if item["value_variants"]:
            flags.append("duplicate_records_with_different_values")
        direction = "above" if value >= threshold else "below"
        severity = (value / threshold) if direction == "above" else (threshold / value if value else None)
        kept.append({
            "id": f"{pilot}:{rule}:{a['timestamp']}",
            "event_ids": item["event_ids"],
            "timestamp": a["timestamp"],
            "type": a["type"],
            "rule": rule,
            "policy_id": a.get("policy_id"),
            "policy_name": a.get("policy_name"),
            "threat_name": a.get("threat_name"),
            "score": round_or_none(a.get("score")),
            "feature_share": round_or_none(feature_share, 3),
            "variable": var.get("name"),
            "value": round_or_none(value),
            "threshold": round_or_none(threshold),
            "direction": direction,
            "times_threshold": round_or_none(severity, 2),
            "_severity": severity or 0.0,
            "instruments": link_instruments(var.get("name", ""), entry, content, installed_rows, positions),
            "quality_flags": flags,
            # AI alarms have no rule name and no decision record in the snapshot.
            "decision": snap.alarm_decisions.get((pilot, a.get("rule"), a["timestamp"])),
        })
    funnel["excluded"] = dict(sorted(excluded.items()))
    funnel["usable"] = len(kept)

    # 3. group usable alarms into episodes per rule and feature first/peak/last
    featured = {}
    episodes_out = []
    by_rule = collections.defaultdict(list)
    for alarm in kept:
        by_rule[alarm["rule"]].append(alarm)
    for rule in sorted(by_rule):
        alarms = sorted(by_rule[rule], key=lambda x: x["timestamp"])
        episodes = [[alarms[0]]]
        for alarm in alarms[1:]:
            if parse_ts(alarm["timestamp"]) - parse_ts(episodes[-1][-1]["timestamp"]) > EPISODE_GAP:
                episodes.append([alarm])
            else:
                episodes[-1].append(alarm)
        for episode in episodes:
            values = [x["value"] for x in episode]
            mean = sum(values) / len(values)
            flat = len(values) >= 3 and mean and (max(values) - min(values)) / abs(mean) < FLAT_SIGNAL_SPREAD
            info = {"rule": rule, "start": episode[0]["timestamp"], "end": episode[-1]["timestamp"],
                    "alarm_count": len(episode), "flat_signal": bool(flat)}
            episodes_out.append(info)
            peak = max(episode, key=lambda x: (x["_severity"], x["timestamp"]))
            for role, alarm in (("first", episode[0]), ("peak", peak), ("last", episode[-1])):
                slot = featured.setdefault(alarm["id"], dict(alarm, roles=[], episode=info))
                if role not in slot["roles"]:
                    slot["roles"].append(role)
                if flat and "flat_signal" not in slot["quality_flags"]:
                    slot["quality_flags"] = slot["quality_flags"] + ["flat_signal"]
    funnel["episodes"] = episodes_out

    # top up with the strongest remaining alarms so there is enough to choose from
    for alarm in sorted(kept, key=lambda x: (-x["_severity"], x["timestamp"])):
        if len(featured) >= MIN_FEATURED_ALARMS:
            break
        if alarm["id"] not in featured:
            info = next(ep for ep in episodes_out if ep["rule"] == alarm["rule"] and ep["start"] <= alarm["timestamp"] <= ep["end"])
            featured[alarm["id"]] = dict(alarm, roles=["extra"], episode=info)
    chosen = sorted(featured.values(), key=lambda x: x["timestamp"])
    if len(chosen) > MAX_FEATURED_ALARMS:
        peaks = [x for x in chosen if "peak" in x["roles"]]
        rest = [x for x in chosen if "peak" not in x["roles"]]
        chosen = sorted((peaks + rest)[:MAX_FEATURED_ALARMS], key=lambda x: x["timestamp"])
    for alarm in chosen:
        alarm.pop("_severity", None)
    funnel["featured"] = len(chosen)
    return chosen, funnel


def link_instruments(variable: str, entry: Dict[str, Any], content: Content, rows: List[Dict[str, Any]],
                     positions: Dict[int, Dict[str, Any]]):
    token = variable.split("_", 1)[0].lower()
    if not token:
        return []
    allowed = {card for group in entry.get("detect_with") or [] for card in group}
    seen, out = set(), []
    for row in rows:
        if row["instrument_id"] in seen:
            continue
        if not node_token(row["name"]).endswith(token):
            continue
        if content.type_to_card.get(row["instrument_type"]) not in allowed:
            continue
        seen.add(row["instrument_id"])
        pos = positions.get(row["instrument_id"]) or {}
        out.append({"instrument_id": row["instrument_id"], "name": row["name"],
                    "instrument_type": row["instrument_type"],
                    "card": content.type_to_card.get(row["instrument_type"]),
                    "lat": pos.get("lat"), "lon": pos.get("lon")})
    return out


def pick_mission_auto(scenarios: List[Dict[str, Any]], level_key: str) -> List[str]:
    """Top scenarios of a level by magnitude, skipping duplicate descriptions and threats
    no card can cover, then filling from the next lower (then higher) levels."""
    idx = LEVEL_ORDER.index(level_key)
    order = [level_key] + LEVEL_ORDER[:idx][::-1] + LEVEL_ORDER[idx + 1:]
    picked, seen_desc = [], set()
    for key in order:
        for s in scenarios:
            if len(picked) == MISSION_SIZE:
                return picked
            desc = (s["description"] or "").strip().lower()
            if s["priority_label"] != key or not s["capable_cards"] or desc in seen_desc:
                continue
            picked.append(s["scenario_key"])
            seen_desc.add(desc)
    return picked


def resolve_featured(alarms: List[Dict[str, Any]], spec: Optional[Dict[str, Any]]) -> Optional[str]:
    """The alarm a level replays. Alarms from a flat (probably stuck) sensor are never replayed:
    the score rewards detecting the replayed alarm, so it must be a believable one."""
    alarms = [a for a in alarms if "flat_signal" not in a["quality_flags"]]
    if not alarms:
        return None
    if spec:
        for alarm in alarms:
            if alarm["rule"] != spec.get("rule"):
                continue
            # "at" names one alarm exactly (a rule can have several episodes); otherwise the first with the role.
            if "at" in spec:
                matches = alarm["timestamp"] == spec["at"]
            else:
                matches = spec.get("pick", "peak") in alarm["roles"]
            if matches:
                return alarm["id"]
    peaks = sorted((a for a in alarms if "peak" in a["roles"]), key=lambda a: -(a["times_threshold"] or 0))
    return (peaks or alarms)[0]["id"]


def build_levels(scenarios, alarms, pack, coins: Dict[str, int]) -> List[Dict[str, Any]]:
    counts = collections.Counter(s["priority_label"] for s in scenarios)
    curated = (pack or {}).get("missions", {})
    featured_spec = (pack or {}).get("featured_alarm", {})
    levels = []
    for key, level_id in LEVELS:
        available = counts[key] > 0
        level = {"key": key, "id": level_id, "scenario_count": counts[key], "available": available}
        if available:
            mission = curated.get(key)
            level["mission"] = list(mission) if mission else pick_mission_auto(scenarios, key)
            level["mission_source"] = "curated" if mission else "auto"
            level["featured_alarm"] = resolve_featured(alarms, featured_spec.get(key) or featured_spec.get("default"))
            level["budget"] = coins[level_id]  # content/coins.json: more serious dangers, more coins
        levels.append(level)
    return levels


def build_monument(snap: Snapshot, content: Content, pilot: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Return (monument entry for game_data.json, stats for data_notes.md)."""
    asset = snap.pilot_to_asset[pilot]
    meta = snap.asset_meta[asset["id"]]
    draft = content.monuments.get(pilot)
    # A pack with "draft": true only names the monument; it becomes playable without it.
    pack = None if draft is None or draft.get("draft") else draft
    scenarios = build_scenarios(snap, content, pilot, pack)
    installed = build_installed(snap, content, asset["id"])
    rows = installed.pop("_rows")
    positions = installed.pop("_positions")
    alarms, funnel = build_alarms(snap, content, pilot, rows, positions)
    levels = build_levels(scenarios, alarms, pack, content.raw["coins"]["by_level"])

    stats = {"pilot": pilot, "asset": asset, "scenarios": scenarios, "installed": installed,
             "funnel": funnel, "levels": levels, "alarms": alarms, "playable": pack is not None}
    entry = {
        "pilot_key": pilot,
        "asset_id": asset["id"],
        "name": asset["name"],
        "country": meta.get("country"),
        "asset_type": meta.get("asset_type_name"),
        "source_url": meta.get("source_url"),
        "playable": pack is not None,
        "scenario_count": len(scenarios),
        "levels": [{k: lv[k] for k in ("key", "id", "scenario_count", "available")} for lv in levels],
        "installed_summary": {k: installed[k] for k in ("records", "distinct_instruments", "physical_instruments")},
        "map": map_view(installed["points"]),
    }
    if draft is not None:
        entry["display_name"] = draft["display_name"]
        entry["place"] = draft["place"]
    if pack is None:
        return entry, stats

    alarm_context = pack.get("alarm_context", {})
    consequences = pack.get("consequences", {})
    for alarm in alarms:
        ctx = alarm_context.get(alarm["rule"])
        alarm["context"] = ({"links": ctx.get("links", []), "why": ctx.get("why"), "authored": True,
                             "needs_review": bool(ctx.get("needs_review"))} if ctx else None)
    entry.update({
        "display_name": pack["display_name"],
        "place": pack["place"],
        "story": dict(pack["story"], authored=True),
        "levels": levels,
        "scenarios": scenarios,
        "installed": installed,
        "alarms": alarms,
        "alarm_funnel": {k: funnel[k] for k in ("records", "unique", "usable", "featured", "excluded", "by_rule")},
        "discussion_prompts": [dict(p, authored=True) for p in pack.get("discussion_prompts", [])],
    })
    if pack.get("no_alarm_note"):
        entry["no_alarm_note"] = dict(pack["no_alarm_note"], authored=True)
    if pack.get("guardian"):
        entry["guardian"] = dict({k: v for k, v in pack["guardian"].items() if not k.startswith("_")}, authored=True)
    if consequences:
        # What happens over the years if nobody ever notices, per alarm rule (score screen): once per
        # rule, not copied into each alarm (one rule can raise many alarms). view_3d: a page of the site
        # that shows the same damage in 3D at this monument (validate() checks it exists).
        entry["consequences"] = {rule: {"picture": c["picture"], "text": c["text"],
                                        "needs_review": bool(consequences.get("needs_review", True)),
                                        **({"view_3d": c["view_3d"]} if "view_3d" in c else {})}
                                 for rule, c in consequences.items() if not rule.startswith("_") and isinstance(c, dict)
                                 and "picture" in c}
    if pack.get("report_to"):
        # Who to tell about a visitor's observation: from the bodies' own official websites.
        to = pack["report_to"]
        entry["report_to"] = {"checked": to["checked"], "needs_review": bool(to.get("needs_review", True)),
                              "contacts": to["contacts"], "authored": True}
    return entry, stats


# --------------------------------------------------------------------------- validation

def validate(content: Content, snap: Snapshot, monuments: List[Dict[str, Any]]) -> List[str]:
    problems = []
    card_ids = set(content.card_ids)
    for key, entry in content.rules.items():
        for group in entry.get("detect_with") or []:
            for card in group:
                if card not in card_ids:
                    problems.append(f"rule map {key}: unknown card '{card}'")
        if not entry.get("detect_with"):
            problems.append(f"rule map {key}: empty detect_with")
    for _, m in snap.ad_rt_policies:
        if content.rule(m.get("pilot"), m.get("rule")) is None:
            problems.append(f"policy rule {m.get('pilot')}:{m.get('rule')} missing from rule map")
    for _, m in snap.alarms:
        a = m.get("alarm") or {}
        if a.get("rule") and content.rule(a.get("site"), a["rule"]) is None:
            problems.append(f"alarm rule {a.get('site')}:{a['rule']} missing from rule map")
    human = {c["id"] for c in content.cards if c.get("kind", "instrument") == "human"}
    for card in content.cards:
        if card.get("kind", "instrument") not in ("instrument", "human"):
            problems.append(f"card {card['id']}: unknown kind '{card.get('kind')}'")
        if card["id"] in human and (card["instrument_types"] or card.get("on_map", True)):
            problems.append(f"card {card['id']}: a human card has no ARGUS instrument types and no map pin")
    for key, entry in content.rules.items():
        for group in entry.get("detect_with") or []:
            if set(group) & human:
                problems.append(f"rule map {key}: people cannot detect an AD-RT alarm ({sorted(set(group) & human)})")
    for section in (content.threat_categories, content.threat_scenarios):
        for key, entry in section.items():
            for card in entry["cards"]:
                if card not in card_ids:
                    problems.append(f"threat map {key}: unknown card '{card}'")
            primary = entry.get("primary")
            if primary is None:
                problems.append(f"threat map {key}: no 'primary' list")
            elif not set(primary) <= set(entry["cards"]) or bool(primary) != bool(entry["cards"]):
                problems.append(f"threat map {key}: 'primary' must be a non-empty subset of 'cards'")
    categories = {m["risk_category"] for _, m in snap.scenarios}
    for cat in sorted(categories - set(content.threat_categories)):
        problems.append(f"risk_category '{cat}' missing from threat map categories")
    all_types = {t["name"] for t in snap.instrument_types.values()}
    for name in sorted(all_types - set(content.type_to_card) - content.unmapped_types):
        problems.append(f"instrument type '{name}' is neither on a card nor listed as unmapped")

    quiz = content.raw["quiz"]["questions"]
    if len({q["id"] for q in quiz}) != len(quiz):
        problems.append("content/quiz.json: question ids are not unique")
    for q in quiz:
        texts = [q["question"], q["explain"], *q["options"]]
        if any(not t.get("en") or not t.get("el") for t in texts):
            problems.append(f"content/quiz.json {q['id']}: missing a language")
        if len(q["options"]) < 2 or not 0 <= q["correct"] < len(q["options"]):
            problems.append(f"content/quiz.json {q['id']}: needs options and a valid 'correct' index")

    checklist = content.raw["checklist"]
    for item in checklist["items"]:
        if not item["text"].get("en") or not item["text"].get("el"):
            problems.append(f"content/citizen_checklist.json {item['id']}: missing a language")
        for cat in item["categories"]:
            if cat not in content.threat_categories:
                problems.append(f"content/citizen_checklist.json {item['id']}: unknown risk category '{cat}'")
    if not checklist["report"].get("en") or not checklist["report"].get("el"):
        problems.append("content/citizen_checklist.json: report text missing a language")

    for tip in content.raw["site_guide"].get("where", []):
        for card in tip.get("cards", []):
            if card not in card_ids:
                problems.append(f"content/site_guide.json {tip.get('id')}: unknown card '{card}'")
        if not tip.get("text", {}).get("en") or not tip.get("text", {}).get("el"):
            problems.append(f"content/site_guide.json {tip.get('id')}: text needs en and el")

    for pilot, photo in content.raw["photos"].get("photos", {}).items():
        where = f"content/photos/credits.json {pilot}"
        if pilot not in content.monuments:
            problems.append(f"{where}: no monument with this pilot key")
        for key in ("author", "license", "license_url", "source", "changes"):
            if not photo.get(key):
                problems.append(f"{where}: missing '{key}' (a photo is never shown without its credit)")
        if photo.get("license") not in PHOTO_LICENSES:
            problems.append(f"{where}: licence '{photo.get('license')}' is not one of {PHOTO_LICENSES}")
        if any(not (photo.get("caption") or {}).get(lang) for lang in BASE_LANGS):
            problems.append(f"{where}: caption missing a language")
        for key in ("file", "thumb"):
            if not (CONTENT_DIR / "photos" / str(photo.get(key))).is_file():
                problems.append(f"{where}: file '{photo.get(key)}' is not in content/photos/")

    decisions = content.raw["decisions"]
    option_ids = [o.get("id") for o in decisions.get("options", [])]
    if len(option_ids) < 2 or len(set(option_ids)) != len(option_ids):
        problems.append("content/decisions.json: needs at least two options with unique ids")
    for key in ("intro", "intro_no_alarm", "argus_plain"):
        if any(not (decisions.get(key) or {}).get(lang) for lang in BASE_LANGS):
            problems.append(f"content/decisions.json: '{key}' missing a language")
    for option in decisions.get("options", []):
        if option.get("stance") not in DECISION_STANCES:
            problems.append(f"content/decisions.json {option.get('id')}: 'stance' must be one of {DECISION_STANCES}")
        texts = [option.get("label"), option.get("feedback")] + ([option["feedback_risky"]] if "feedback_risky" in option else [])
        if any(not (t or {}).get(lang) for t in texts for lang in BASE_LANGS):
            problems.append(f"content/decisions.json {option.get('id')}: missing a language")
    if not any(o.get("stance") == "review" for o in decisions.get("options", [])):
        problems.append("content/decisions.json: no option with stance 'review' (what the ARGUS record recommends)")

    coins = content.raw["coins"].get("by_level", {})
    previous = 0
    for _, level_id in LEVELS:
        value = coins.get(level_id)
        if not isinstance(value, int) or value <= 0:
            problems.append(f"content/coins.json: '{level_id}' needs a positive whole number of coins")
        elif value < previous:
            problems.append(f"content/coins.json: '{level_id}' has fewer coins than a less serious level")
        else:
            previous = value

    layer_ids = [layer["id"] for layer in content.basemaps.get("layers", [])]
    if content.basemaps.get("default") not in layer_ids:
        problems.append("content/map.json: 'default' is not one of the layers")
    for layer in content.basemaps.get("layers", []):
        for key in ("attribution", "name") + (() if layer.get("type") == "vector" else ("url",)):
            if not layer.get(key):
                problems.append(f"content/map.json layer {layer.get('id')}: missing {key}")

    for mon in monuments:
        if not mon["playable"]:
            continue
        if not mon["map"]:
            problems.append(f"{mon['pilot_key']}: no sensor coordinates, so no map view")
        keys = {s["scenario_key"] for s in mon["scenarios"]}
        for s in mon["scenarios"]:
            if not s["plain"]["title"] or not s["plain"]["text"]:
                problems.append(f"{mon['pilot_key']}: no plain text for {s['scenario_key']}")
            for lang in ("en", "el"):
                if s["plain"]["title"] and not s["plain"]["title"].get(lang):
                    problems.append(f"{mon['pilot_key']}: missing {lang} title for {s['scenario_key']}")
        if mon["story"]["hook_scenario"] not in keys:
            problems.append(f"{mon['pilot_key']}: story hook_scenario not a scenario of this pilot")
        for level in mon["levels"]:
            if not level["available"]:
                continue
            if len(level["mission"]) != MISSION_SIZE:
                problems.append(f"{mon['pilot_key']} {level['key']}: mission has {len(level['mission'])} threats")
            level_of = {s["scenario_key"]: s["level"] for s in mon["scenarios"]}
            for key in level["mission"]:
                if key not in keys:
                    problems.append(f"{mon['pilot_key']} {level['key']}: unknown mission scenario '{key}'")
                elif abs(LEVEL_RANK[level_of[key]] - LEVEL_RANK[level["id"]]) > 1:
                    # e.g. a Medium game with an Extreme danger: the player gets a harder game than chosen
                    problems.append(f"{mon['pilot_key']} {level['key']}: mission scenario '{key}' is {level_of[key]}, "
                                    "more than one level away")
            spec = (content.monuments[mon["pilot_key"]].get("featured_alarm") or {})
            spec = spec.get(level["key"]) or spec.get("default")
            chosen = next((a for a in mon["alarms"] if a["id"] == level["featured_alarm"]), None)
            if spec and (chosen is None or chosen["rule"] != spec.get("rule")):
                problems.append(f"{mon['pilot_key']} {level['key']}: featured_alarm {spec} matches no replayable alarm "
                                "(alarms from a flat signal are never replayed)")
        for alarm in mon["alarms"]:
            if not alarm["context"]:
                problems.append(f"{mon['pilot_key']}: no alarm_context for rule {alarm['rule']}")
            elif alarm["rule"] not in mon.get("consequences", {}):
                problems.append(f"{mon['pilot_key']}: no consequence for rule {alarm['rule']}")
            elif mon["consequences"][alarm["rule"]]["picture"] not in CONSEQUENCE_PICTURES:
                problems.append(f"{mon['pilot_key']}: consequence of {alarm['rule']} has an unknown picture "
                                f"(one of {', '.join(CONSEQUENCE_PICTURES)})")
        for rule, c in (mon.get("consequences") or {}).items():
            problems.extend(f"{mon['pilot_key']}: consequence of {rule}: {p}" for p in view_3d_problems(c.get("view_3d")))
        report_to = mon.get("report_to")
        if not report_to or not report_to["contacts"]:
            problems.append(f"{mon['pilot_key']}: no report_to contacts (who to tell about an observation)")
        else:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(report_to.get("checked", ""))):
                problems.append(f"{mon['pilot_key']}: report_to needs the date it was checked (YYYY-MM-DD)")
            for c in report_to["contacts"]:
                who = f"{mon['pilot_key']} report_to '{(c.get('name') or {}).get('en')}'"
                for field in ("name", "role"):
                    if not all((c.get(field) or {}).get(lang) for lang in ("en", "el")):
                        problems.append(f"{who}: {field} needs both en and el")
                if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", c.get("email", "")):
                    problems.append(f"{who}: email missing or malformed")
                if c.get("phone") and not re.fullmatch(r"\+\d[\d ]{6,18}", c["phone"]):
                    problems.append(f"{who}: phone must be international, e.g. +30 210 3310966")
                for field in ("url", "source"):
                    if not str(c.get(field, "")).startswith("https://"):
                        problems.append(f"{who}: {field} must be an https:// page")
        guardian = mon.get("guardian")
        if not guardian:
            problems.append(f"{mon['pilot_key']}: no guardian")
        else:
            for field in ("name", "role", "handover") + (("back_caught",) if mon["alarms"] else ()):
                if not all((guardian.get(field) or {}).get(lang) for lang in ("en", "el")):
                    problems.append(f"{mon['pilot_key']}: guardian {field} needs both en and el")
        for prompt in mon["discussion_prompts"]:
            if not prompt.get("en") or not prompt.get("el"):
                problems.append(f"{mon['pilot_key']}: discussion prompt missing a language")
    return problems


# --------------------------------------------------------------------------- outputs

def public_cards(content: Content) -> Dict[str, Any]:
    raw = content.raw["cards"]
    cards = [dict({k: c[k] for k in ("id", "group", "cost", "name", "tells", "instrument_types", "needs_review")},
                  on_map=c.get("on_map", True), kind=c.get("kind", "instrument"))
             for c in raw["cards"]]
    return {"currency": raw["currency"], "groups": raw["groups"], "cards": cards}


def public_rule_map(content: Content) -> Dict[str, Any]:
    keep = ("detect_with", "measures", "unit", "unit_confirmed", "needs_review", "plausible")
    return {key: {k: v for k, v in entry.items() if k in keep} for key, entry in sorted(content.rules.items())}


def public_alarm_filter(content: Content) -> Dict[str, Any]:
    """How build_alarms decides that an alarm can be shown (its step 2), for the alarms ARGUS raises
    after the snapshot: the newest readings on the home screen (web/src/game/live.ts) keep exactly
    the ones the game would. Each rule's own range is in rule_sensor_map ('plausible')."""
    return {
        "dl_min_share": DL_MIN_SHARE,
        "dl_features": [{"match": p["match"], "rule": p["rule"]} for p in content.dl_features],
        "plausible": {card: list(lo_hi) for card, lo_hi in sorted(PLAUSIBLE_RANGES.items())},
        "zero_is_suspect": sorted(ZERO_IS_SUSPECT),
    }


def build(snapshot_dir: Path = SNAPSHOT_DIR, content_dir: Path = CONTENT_DIR):
    snap = Snapshot(load_snapshot(snapshot_dir))
    content = Content(load_content(content_dir))
    unknown = sorted(set(content.monuments) - set(snap.pilot_to_asset))
    if unknown:
        raise BuildError(f"content/monuments has packs for unknown pilots: {unknown}")

    monuments, stats = [], []
    for asset in sorted(snap.assets, key=lambda a: a["id"]):
        pilot = next(p for p, a in snap.pilot_to_asset.items() if a["id"] == asset["id"])
        entry, stat = build_monument(snap, content, pilot)
        monuments.append(entry)
        stats.append(stat)

    problems = validate(content, snap, monuments)
    if problems:
        raise BuildError("validation failed:\n  - " + "\n  - ".join(problems))

    files = {name: {"count": snap.raw[name]["count"], "complete": snap.raw[name]["complete"]} for name in RESOURCES}
    data = {
        "schema_version": SCHEMA_VERSION,
        "generated_by": "tools/build_game_data.py",
        "snapshot": {"fetched_at": snap.fetched_at, "files": files},
        "provenance": {
            "argus": "Fields copied from the ARGUS snapshot: scenarios (ids, keys, categories, ABC values, labels, "
                     "sources), installed instruments, AD-RT alarms (ids, timestamps, values, thresholds, policies).",
            "authored": "Fields marked authored=true and everything under 'cards' and 'rule_sensor_map' come from "
                        "content/*.json, written by the game team, and need human review.",
        },
        "level_order": [{"key": k, "id": i} for k, i in LEVELS],
        "mission_size": MISSION_SIZE,
        "cards": public_cards(content),
        "rule_sensor_map": public_rule_map(content),
        "alarm_filter": public_alarm_filter(content),
        "quiz": {"questions": content.raw["quiz"]["questions"], "authored": True,
                 "needs_review": bool(content.raw["quiz"].get("needs_review"))},
        "checklist": {"items": content.raw["checklist"]["items"], "report": content.raw["checklist"]["report"],
                      "authored": True, "needs_review": bool(content.raw["checklist"].get("needs_review"))},
        "basemaps": {"default": content.basemaps["default"],
                     "layers": [{k: v for k, v in layer.items() if k not in ("review_note", "probe_zoom")}
                                for layer in content.basemaps["layers"]],
                     "world": BACKDROP_URL.format(name="world_land.json")
                     if (content_dir / "backdrops" / "world_land.json").exists() else None},
        "monuments": monuments,
    }
    for mon in monuments:
        mon["backdrop"] = (BACKDROP_URL.format(name=f"{mon['pilot_key']}.json")
                           if (content_dir / "backdrops" / f"{mon['pilot_key']}.json").exists() else None)
    attach_imagery_zoom(monuments, content, content_dir)
    for mon in monuments:
        if mon["playable"]:
            mon["places"] = resolve_places(mon, content.monuments[mon["pilot_key"]], content_dir)
            mon["history"] = public_history(mon, content.raw.get("history", {}).get(mon["pilot_key"]))
    data["site_guide"] = {"where": content.raw["site_guide"]["where"], "authored": True,
                          "needs_review": bool(content.raw["site_guide"].get("needs_review"))}
    data["decisions"] = public_decisions(content)
    for mon in monuments:
        photo = content.raw["photos"].get("photos", {}).get(mon["pilot_key"])
        if photo:
            mon["photo"] = {
                "src": PHOTO_URL.format(name=photo["file"]), "thumb": PHOTO_URL.format(name=photo["thumb"]),
                "caption": photo["caption"], "author": photo["author"], "license": photo["license"],
                "license_url": photo["license_url"], "source": photo["source"], "changes": photo["changes"],
                "authored": True, "needs_review": bool(photo.get("needs_review", True)),
            }
    notes = render_notes(snap, content, stats) + "\n" + render_language_notes(data, translation_packs(data, content_dir))
    return data, notes


DECISION_STANCES = ("review", "wait", "act")


def public_decisions(content: Content) -> Dict[str, Any]:
    raw = content.raw["decisions"]
    keep = ("id", "icon", "stance", "label", "feedback", "feedback_risky")
    return {"intro": raw["intro"], "intro_no_alarm": raw["intro_no_alarm"], "argus_plain": raw["argus_plain"],
            "options": [{k: o[k] for k in keep if k in o} for o in raw["options"]],
            "authored": True, "needs_review": bool(raw.get("needs_review"))}


def public_history(mon: Dict[str, Any], pack: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The whole story of a site (content/history/<pilot>.json): chapters in Greek and English, each
    with an optional place of the site that the map moves to. None when the site has none yet."""
    if not pack:
        return None
    name = f"content/history/{mon['pilot_key']}.json"
    chapters = pack.get("chapters") or []
    if len(chapters) < 2:
        raise BuildError(f"{name}: a story needs at least two chapters")
    places = {place["id"] for place in mon.get("places") or []}
    out = []
    for i, chapter in enumerate(chapters, 1):
        for field in ("title", "text"):
            for lang in ("el", "en"):
                if not str((chapter.get(field) or {}).get(lang, "")).strip():
                    raise BuildError(f"{name}: chapter {i} has no {lang} {field}")
        place = chapter.get("place")
        if place is not None and place not in places:
            raise BuildError(f"{name}: chapter {i} points the map at '{place}', which is not a place of this site")
        out.append({"title": chapter["title"], "text": chapter["text"], "place": place})
    return {"chapters": out, "authored": True, "needs_review": bool(pack.get("needs_review", True))}


# --------------------------------------------------------------------------- translations

def content_texts(node: Any, found: Optional[Dict[str, None]] = None) -> List[str]:
    """Every English text of the data pack that has a Greek twin (so: every authored text), in order."""
    found = {} if found is None else found
    if isinstance(node, dict):
        if isinstance(node.get("en"), str) and isinstance(node.get("el"), str):
            found.setdefault(node["en"])
        for value in node.values():
            content_texts(value, found)
    elif isinstance(node, list):
        for value in node:
            content_texts(value, found)
    return list(found)


def translation_packs(data: Dict[str, Any], content_dir: Path = CONTENT_DIR) -> Dict[str, Dict[str, Any]]:
    """Per language: the small file the browser loads (data/i18n/<lang>.json) and what is still missing.

    A missing translation is not an error: the game shows the English text instead. The notes list it."""
    wanted = content_texts(data)
    packs = {}
    for lang in TRANSLATION_LANGS:
        path = content_dir / "translations" / f"{lang}.json"
        if not path.exists():
            continue
        raw = load_json(path)
        strings = raw.get("strings")
        if raw.get("lang") != lang or not isinstance(strings, dict):
            raise BuildError(f"{path.name}: needs \"lang\": \"{lang}\" and a 'strings' object")
        bad = sorted(k for k, v in strings.items() if not isinstance(v, str) or not v.strip())
        if bad:
            raise BuildError(f"{path.name}: empty translation for {bad[0]!r}")
        packs[lang] = {
            "pack": {"lang": lang, "needs_review": bool(raw.get("needs_review", True)),
                     "strings": {en: strings[en] for en in wanted if en in strings}},
            "missing": [en for en in wanted if en not in strings],
            "unused": sorted(set(strings) - set(wanted)),
        }
    return packs


def render_language_notes(data: Dict[str, Any], packs: Dict[str, Dict[str, Any]]) -> str:
    total = len(content_texts(data))
    out = ["## Languages", "",
           f"The game's own text is written in English and Greek ({total} texts in the data pack). Other languages "
           "are overlays in `content/translations/<lang>.json`, keyed by the exact English text, and are shipped as "
           "`data/i18n/<lang>.json`. When an English text changes, its translations no longer match and the game "
           "shows the English text until they are redone. All translations below are machine translations that "
           "need a native speaker.", ""]
    rows = [[lang, len(p["pack"]["strings"]), len(p["missing"]), len(p["unused"]),
             "yes" if p["pack"]["needs_review"] else "no"] for lang, p in sorted(packs.items())]
    out.append(md_table(["language", "translated", "missing (shown in English)", "no longer used", "needs review"], rows)
               if rows else "No translation files found.")
    out.append("")
    for lang, p in sorted(packs.items()):
        for en in p["missing"][:20]:
            shown = en[:70] + ("..." if len(en) > 70 else "")
            out.append(f"- `{lang}` missing: \"{shown}\"")
    if any(p["missing"] for p in packs.values()):
        out.append("")
    return "\n".join(out)


# The drawings of web/src/components/Consequence.tsx.
CONSEQUENCE_PICTURES = ("mosaic", "floor", "stone", "lean", "tree", "fresco", "crack")


def view_3d_problems(page: Any) -> List[str]:
    """A consequence's view_3d must be a folder of the site with its own page, e.g. "preview-3d/"."""
    if page is None:
        return []
    if not isinstance(page, str) or not re.fullmatch(r"[a-z0-9-]+(/[a-z0-9-]+)*/", page):
        return [f"view_3d {page!r} is not a folder of the site like 'preview-3d/'"]
    if not (WEB_PUBLIC / page / "index.html").is_file():
        return [f"view_3d '{page}' has no page (web/public/{page}index.html)"]
    return []


PLACE_MAX_DISTANCE_M = 3000  # a place further than this from the monument's sensors is a typo


def metres_between(a: List[float], b: List[float]) -> float:
    dx = (b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, b[0] - a[0]) * 111_320


def resolve_places(mon: Dict[str, Any], pack: Dict[str, Any], content_dir: Path) -> List[Dict[str, Any]]:
    """Site guide: number each place in the pack and give it a real position. 'osm' takes the outline
    (and its centre) from content/backdrops/<pilot>.json; 'sensors' takes the centre of the ARGUS sensor
    places whose description contains that text. Names and notes are authored."""
    specs = (pack.get("places") or {}).get("list", [])
    backdrop_path = content_dir / "backdrops" / f"{mon['pilot_key']}.json"
    features = load_json(backdrop_path)["features"] if backdrop_path.exists() else []
    by_osm = {f["properties"].get("osm_id"): f for f in features}
    out = []
    for n, spec in enumerate(specs, 1):
        where = f"{mon['pilot_key']} place '{spec.get('id')}'"
        for field in ("name", "note"):
            if not (spec.get(field) or {}).get("en") or not (spec.get(field) or {}).get("el"):
                raise BuildError(f"{where}: {field} needs both en and el")
        at = spec.get("at") or {}
        lat = lon = None
        outline = None
        sources = []
        if "osm" in at:
            feature = by_osm.get(at["osm"])
            if feature is None:
                raise BuildError(f"{where}: OpenStreetMap way {at['osm']} is not in {backdrop_path.name} "
                                 "(run tools/fetch_backdrops.py)")
            geometry = feature["geometry"]
            ring = geometry["coordinates"][0] if geometry["type"] == "Polygon" else geometry["coordinates"]
            outline = [[round(c[1], 7), round(c[0], 7)] for c in ring]
            body = ring[:-1] if ring[0] == ring[-1] and len(ring) > 1 else ring
            lat = sum(c[1] for c in body) / len(body)
            lon = sum(c[0] for c in body) / len(body)
            sources.append(f"OpenStreetMap way {at['osm']} ({feature['properties'].get('name', 'unnamed')})")
        if "sensors" in at:
            text = at["sensors"].lower()
            points = [pt for pt in mon["installed"]["points"] if pt.get("label") and text in pt["label"].lower()]
            if not points:
                raise BuildError(f"{where}: no ARGUS sensor description contains '{at['sensors']}'")
            if lat is None:
                lat = sum(pt["lat"] for pt in points) / len(points)
                lon = sum(pt["lon"] for pt in points) / len(points)
            sources.append(f"{len(points)} ARGUS sensor place(s) described with '{at['sensors']}'")
        if lat is None:
            raise BuildError(f"{where}: 'at' needs 'osm' or 'sensors'")
        if mon.get("map") and metres_between([lat, lon], mon["map"]["center"]) > PLACE_MAX_DISTANCE_M + \
                max(metres_between(mon["map"]["center"], corner) for corner in mon["map"]["bounds"]):
            raise BuildError(f"{where}: more than {PLACE_MAX_DISTANCE_M} m outside the monument")
        out.append({"id": spec["id"], "n": n, "name": spec["name"], "note": spec["note"],
                    "lat": round(lat, 7), "lon": round(lon, 7), "outline": outline, "sources": sources,
                    "authored": True, "needs_review": bool(spec.get("needs_review", True))})
    if len({p["id"] for p in out}) != len(out):
        raise BuildError(f"{mon['pilot_key']}: place ids must be unique")
    return out


def attach_imagery_zoom(monuments: List[Dict[str, Any]], content: Content, content_dir: Path) -> None:
    """Deepest zoom with real satellite imagery per monument (content/imagery_zoom.json, written by
    tools/probe_imagery.py). Deeper, the provider sends a 'Map data not yet available' picture, so the
    game stretches this level instead (map.max_native_zoom)."""
    path = content_dir / "imagery_zoom.json"
    if not path.exists():
        return
    probed = load_json(path).get("layers") or {}
    raster = {l["id"] for l in content.basemaps.get("layers", []) if l.get("type") != "vector"}
    for layer_id, by_pilot in probed.items():
        if layer_id not in raster:
            raise BuildError(f"imagery_zoom.json: '{layer_id}' is not a raster layer in content/map.json")
        for pilot, zoom in by_pilot.items():
            if not isinstance(zoom, int) or not 0 <= zoom <= 23:
                raise BuildError(f"imagery_zoom.json: {layer_id}/{pilot} zoom {zoom!r} is not 0..23")
    for mon in monuments:
        zooms = {lid: by_pilot[mon["pilot_key"]] for lid, by_pilot in sorted(probed.items())
                 if mon["pilot_key"] in by_pilot}
        if mon.get("map") and zooms:
            mon["map"]["max_native_zoom"] = zooms


def md_table(headers: List[str], rows: List[List[Any]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(lines)


def collect_review_items(content: Content) -> List[str]:
    items = []
    if content.raw["coins"].get("needs_review"):
        coins = content.raw["coins"]["by_level"]
        items.append("`content/coins.json`: coins per danger level (" +
                     ", ".join(f"{lid} {coins[lid]}" for _, lid in LEVELS) + ")")
    if content.raw["site_guide"].get("needs_review"):
        items.append("`content/site_guide.json`: where each kind of sensor usually goes (general guidance)")
    for pilot, pack in sorted(content.monuments.items()):
        for spec in (pack.get("places") or {}).get("list", []):
            if spec.get("needs_review", True):
                note = f": {spec['review_note']}" if spec.get("review_note") else ""
                items.append(f"`{pilot}` site-guide place `{spec['id']}` ({spec['name']['en']} / {spec['name']['el']}){note}")
    for card in content.cards:
        if card.get("needs_review"):
            items.append(f"Card `{card['id']}`: {card.get('review_note', 'check wording and instrument grouping')}")
    for key, entry in sorted(content.rules.items()):
        if entry.get("needs_review"):
            items.append(f"Rule `{key}` -> {entry['detect_with']}: {entry.get('note', 'uncertain mapping')}")
    unconfirmed = sorted(f"`{k}` ({e['unit']})" for k, e in content.rules.items() if e.get("unit") and not e.get("unit_confirmed"))
    if unconfirmed:
        items.append("Units are not in the ARGUS alarm data; these are our guesses: " + ", ".join(unconfirmed))
    for layer in content.basemaps.get("layers", []):
        if layer.get("needs_review"):
            items.append(f"Base map `{layer['id']}`: {layer.get('review_note', 'check licence')}")
    for key, entry in sorted(content.threat_categories.items()):
        if entry.get("needs_review"):
            items.append(f"Threat category `{key}` -> {entry['cards']}, primary {entry['primary']}"
                         + (f": {entry['note']}" if entry.get("note") else ""))
    for key, entry in sorted(content.threat_scenarios.items()):
        if entry.get("needs_review"):
            items.append(f"Scenario `{key}` -> {entry['cards']}, primary {entry['primary']}"
                         + (f": {entry['note']}" if entry.get("note") else ""))
    for pilot, pack in sorted(content.monuments.items()):
        if pack.get("draft"):
            items.append(f"`content/monuments/{pilot}.json` (draft): monument name and place in Greek and English")
            continue
        story = pack.get("story", {})
        items.append(f"`content/monuments/{pilot}.json` story: {story.get('review_note', 'check facts and Greek')}")
        history = content.raw.get("history", {}).get(pilot)
        if history and history.get("needs_review", True):
            items.append(f"`content/history/{pilot}.json` (the whole story, {len(history.get('chapters', []))} chapters): "
                         "check every fact and the Greek: " + "; ".join(history.get("check", [])))
        items.append(f"`content/monuments/{pilot}.json`: all {len([k for k in pack.get('plain_threats', {}) if not k.startswith('_')])} "
                     "plain-language threat texts are placeholders (check science and Greek)")
        for prompt in pack.get("discussion_prompts", []):
            if prompt.get("needs_review"):
                items.append(f"`{pilot}` discussion prompt \"{prompt['en'][:60]}...\": {prompt.get('review_note', '')}")
        for rule, ctx in sorted(pack.get("alarm_context", {}).items()):
            if ctx.get("needs_review"):
                items.append(f"`{pilot}` alarm explanation for `{rule}` and its linked threats {ctx.get('links')}")
        if pack.get("consequences", {}).get("needs_review", True) and pack.get("consequences"):
            items.append(f"`{pilot}` consequences (what happens if nobody notices, per alarm rule): check the science "
                         "and the Greek, and that each drawing fits")
        if pack.get("report_to", {}).get("needs_review", True) and pack.get("report_to"):
            to = pack["report_to"]
            names = ", ".join(c["name"]["en"] for c in to["contacts"])
            items.append(f"`{pilot}` who to tell (checked {to['checked']}): {names}: call or write once to confirm"
                         + (f" ({to['review_note']})" if to.get("review_note") else ""))
        if (pack.get("guardian") or {}).get("needs_review", True) and pack.get("guardian"):
            name = pack["guardian"]["name"]["en"]
            items.append(f"`{pilot}` imaginary guardian {name}: name, role and words (Greek too)")
        items.append(f"`{pilot}` mission picks per level")
    if content.raw["checklist"].get("needs_review"):
        items.append("`content/citizen_checklist.json`: what visitors should look out for and how to report it")
    for pilot, photo in sorted(content.raw["photos"].get("photos", {}).items()):
        if photo.get("needs_review", True):
            items.append(f"`{pilot}` photo caption \"{photo['caption']['en'][:70]}\": check that it says what the photo "
                         f"shows ({photo['author']}, {photo['license']}, Wikimedia Commons)")
    if content.raw["decisions"].get("needs_review"):
        items.append("`content/decisions.json`: the 'what would you do next?' options, their feedback and our "
                     "plain-language reading of the ARGUS decision record")
    if content.raw["quiz"].get("needs_review"):
        items.append(f"`content/quiz.json`: {len(content.raw['quiz']['questions'])} pre/post quiz questions, answers and explanations")
    return items


def render_notes(snap: Snapshot, content: Content, stats: List[Dict[str, Any]]) -> str:
    raw = snap.raw
    label_counts = collections.Counter(m["abc"]["priority_label"] for _, m in snap.scenarios)
    kinds = collections.Counter(parse_metadata(e).get("kind") for e in snap.events)
    alarm_ts = sorted(m["alarm"]["timestamp"] for _, m in snap.alarms)
    hum = [(m["alarm"]["site"], v.get("value")) for _, m in snap.alarms for v in (m["alarm"].get("variables") or [])
           if "hum" in str(v.get("name", "")).lower() and isinstance(v.get("value"), (int, float))]
    hum_over = collections.Counter(site for site, value in hum if value > 100)

    out = []
    w = out.append
    w("# Data notes")
    w("")
    w("Generated by `tools/build_game_data.py` from the ARGUS snapshot. Do not edit by hand: change the "
      "script or `content/` and rerun `python3 -I tools/build_game_data.py`.")
    w("")
    w(f"Snapshot fetched at: {', '.join(snap.fetched_at)}")
    w("")
    w("## Snapshot files used")
    w("")
    w(md_table(["resource", "records", "complete"],
               [[name, raw[name]["count"], raw[name]["complete"]] for name in RESOURCES]))
    w("")
    w("`events` is a sample (complete = false), so alarm counts are lower bounds. `readings.json` covers about one "
      "hour and is not used. `sensor_coverage` in IRA results is undocumented and is not used.")
    w("")
    w("## Monuments")
    w("")
    rows = []
    for st in stats:
        inst = st["installed"]
        lc = collections.Counter(s["priority_label"] for s in st["scenarios"])
        rows.append([st["asset"]["id"], st["asset"]["name"], st["pilot"], len(st["scenarios"]),
                     " / ".join(str(lc[k]) for k in LEVEL_ORDER), inst["records"], inst["distinct_instruments"],
                     st["funnel"]["records"], st["funnel"]["usable"], "yes" if st["playable"] else "not yet"])
    w(md_table(["asset id", "name", "pilot key", "scenarios", "Low / Med / High / Extr / Cat", "instrument records",
                "distinct instruments", "alarms (sample)", "usable alarms", "playable"], rows))
    w("")
    w("## Overall counts")
    w("")
    w(f"- threats.json: {len(snap.threats)} records; {len(snap.scenarios)} ABC risk scenarios "
      f"(test record 'Katastrofh' ignored).")
    w("- Priority labels: " + ", ".join(f"{k} {label_counts[k]}" for k in LEVEL_ORDER) + ".")
    w("- events.json: " + ", ".join(f"{k} {v}" for k, v in sorted(kinds.items(), key=lambda x: str(x[0]))) +
      f"; AD-RT alarm timestamps {alarm_ts[0]} to {alarm_ts[-1]}.")
    w(f"- Humidity-named alarm variables: {len(hum)}, of which {sum(hum_over.values())} are above 100 "
      f"({', '.join(f'{k} {v}' for k, v in sorted(hum_over.items()))}).")
    w(f"- policies.json: {len(snap.policies)} records; {len(snap.ad_rt_policies)} AD-RT expert-rule policies "
      f"(policy_type_id 2), all mapped in `content/rule_sensor_map.json`.")
    w(f"- installed-instruments.json: {len(snap.installed_instruments)} records; "
      f"instrument-types.json: {len(snap.instrument_types)} types "
      f"({len({t['name'] for t in snap.instrument_types.values()})} distinct names).")
    w("")
    for st in stats:
        if not st["playable"]:
            continue
        pilot, inst, funnel = st["pilot"], st["installed"], st["funnel"]
        w(f"## {st['asset']['name']} ({pilot})")
        w("")
        w("### Scenarios")
        w("")
        w(md_table(["threat id", "scenario key", "category", "MR", "label", "capable cards (* = primary)"],
                   [[s["threat_id"], s["scenario_key"], s["risk_category"], s["abc"]["mr"], s["priority_label"],
                     ", ".join(c + ("*" if c in s["primary_cards"] else "") for c in s["capable_cards"]) or "(none)"]
                    for s in st["scenarios"]]))
        w("")
        w("### Levels")
        w("")
        w(md_table(["level", "scenarios", "mission", "source", "featured alarm"],
                   [[lv["key"], lv["scenario_count"], ", ".join(lv.get("mission", [])) or "-",
                     lv.get("mission_source", "-"), lv.get("featured_alarm") or "-"] for lv in st["levels"]]))
        w("")
        w("### Installed instruments")
        w("")
        w(f"{inst['records']} installed-instrument records, {inst['distinct_instruments']} distinct instruments, "
          f"{inst['physical_instruments']} physical (one virtual Earth Observation layer).")
        w("")
        w(md_table(["card", "count", "ARGUS types", "nodes"],
                   [[r["card"], r["count"], ", ".join(f"{k} x{v}" for k, v in r["instrument_types"].items()),
                     ", ".join(r["nodes"])] for r in inst["by_card"]]))
        w("")
        if inst["duplicate_records"]:
            w("Double-registered instruments (same instrument_id, two installed-instrument records):")
            w("")
            for d in inst["duplicate_records"]:
                w(f"- instrument {d['instrument_id']}: installed-instruments {d['installed_instrument_ids']}")
            w("")
        for f in inst["flags"]:
            w(f"- installed-instrument {f['installed_instrument_id']}: {f['flag']}. {f['detail']}")
        w("")
        w(f"Map: {sum(len(p['instruments']) for p in inst['points'])} instruments with coordinates at "
          f"{len(inst['points'])} distinct points; without a position: "
          + (", ".join(f"{u['instrument_type']} ({u['reason']})" for u in inst["unplaced"]) or "none") + ".")
        w("")
        w("### Alarm funnel")
        w("")
        w(f"- AD-RT alarm records in the sample: {funnel['records']} ({funnel['by_type']})")
        w(f"- By rule: {funnel['by_rule']}")
        w(f"- After removing duplicates (same rule, timestamp, variable): {funnel['unique']}")
        for reason, count in funnel["excluded"].items():
            w(f"- Excluded, {reason}: {count}")
        w(f"- Usable: {funnel['usable']}")
        for ep in funnel["episodes"]:
            w(f"- Episode `{ep['rule']}`: {ep['start']} to {ep['end']}, {ep['alarm_count']} alarms"
              + (", values almost constant (possible stuck sensor)" if ep["flat_signal"] else ""))
        w(f"- Featured in the game (first, peak and last of each episode): {funnel['featured']}")
        w("")
        w(md_table(["alarm id", "value", "threshold", "x threshold", "roles", "instrument", "flags"],
                   [[a["id"], a["value"], a["threshold"], a["times_threshold"], ", ".join(a["roles"]),
                     ", ".join(i["name"] for i in a["instruments"]) or "-", ", ".join(a["quality_flags"]) or "-"]
                    for a in st["alarms"]]))
        w("")
    raised_scenarios = [(key, risk_history(evs)) for key, evs in sorted(snap.risk_evaluations.items())]
    raised_scenarios = [(key, r) for key, r in raised_scenarios if r]
    total_evals = sum(len(evs) for evs in snap.risk_evaluations.values())
    w("## ARGUS risk evaluations")
    w("")
    w(f"{total_evals} risk-model evaluations of {len(snap.risk_evaluations)} scenarios "
      "(threat-contexts of kind ira_threat_evaluation). Raised above 'inactive':")
    w("")
    for key, r in raised_scenarios:
        for period in r["raised"]:
            w(f"- `{key}`: {period['state']} from {period['from'][:16]} until "
              f"{(period['until'] or 'now')[:16]} (probability up to {period['probability']})")
    if not raised_scenarios:
        w("- none")
    w("")
    w("## Data quirks found")
    w("")
    for line in DATA_QUIRKS:
        w(f"- {line}")
    w("")
    w("## Assumptions needing human review")
    w("")
    w("Game-design rules (in code):")
    w("")
    for line in DESIGN_ASSUMPTIONS:
        w(f"- {line}")
    w("")
    w("Authored content flagged `needs_review`:")
    w("")
    for line in collect_review_items(content):
        w(f"- {line}")
    w("")
    return "\n".join(out)


DATA_QUIRKS = [
    "Priority labels carry a ' priority' suffix ('Extreme priority'). Labels do not sort strictly by MR across "
    "pilots (e.g. a High at MR 12.0 and an Extreme at MR 11.5); we use the label as given.",
    "Ranverso has no Catastrophic scenarios, Monti Lucretili has no Low or Medium ones and Baltanas has only 7 "
    "scenarios, so not every level exists at every monument.",
    "Ranverso repeats two descriptions under different keys: 'freeze-thaw cycles' (physical forces, Low; incorrect "
    "temperature, Medium) and 'biohazard' (physical forces; pests).",
    "Ranverso: 26 installed-instrument records but 20 distinct instruments. Humidity x3, temperature x2 and "
    "vibration x1 are registered twice under two naming styles. One of the 20 is a virtual Earth Observation layer.",
    "Ranverso weather station 2CF7F1C0734001E8 is marked verification_required, with temporary coordinates, after "
    "being moved from the Baltanas asset state.",
    "AD-RT rule names are per pilot (e.g. R4b_soil_low at Ranverso, R4b_soil_range at Baltanas), so the mapping is "
    "keyed by pilot and rule.",
    "Policy 'AD-RT Lucretili policy - GNSS z-score' has rule R10_solar_zscore: name and description disagree.",
    "Many alarm events are exact duplicates (same rule, timestamp and value under different ids); some duplicates "
    "carry slightly different values (re-runs).",
    "All Ranverso indoor-humidity alarms (R1_hum_inside, sensor 168442 at the left altar) have values from 110 to "
    "558 against a threshold of 80, so they are unusable.",
    "Ranverso DL alarms all attribute 100% to NO2 (sensor 359111) with scores in the millions against a threshold "
    "of 142; we do not use them.",
    "Ranverso soil-moisture alarms stay between 2.457 and 2.476 for three weeks (possible stuck sensor); the first "
    "one (28 Aug) has value 0.0 with threshold 0.5 while the current policy threshold is 5.",
    "Delos and Baltanas alarms in the sample are all deep-learning (AI) alarms without rule names. At Delos, 26 "
    "of 33 distinct AI alarms are driven mainly (30 to 55% of the top feature contributions) by soil moisture "
    "sensor 149368 under the Theatrical Masks mosaic (Room 215, House of the Masks), daily from 31 Aug to 24 Sep; "
    "the other 7 by wind direction or one humidity sensor. At Baltanas, 21 of 27 have no signal with a 30% share; "
    "the other 6 are driven by wind.",
    "Lucretili temperature alarms: R9a_temp_lt (daily temperature range) has values of 55 to 60 against a limit "
    "of 15 to 20 and R9b_temp_st (one-hour change) values up to 57, which are not physically plausible; most are "
    "excluded by the per-rule ranges in content/rule_sensor_map.json. Its crack and tilt-offset alarms carry six "
    "sensors each (normalised values), so they are not replayed.",
    "Units are not part of the alarm data.",
    "Ranverso scenario 'evidence' lists are empty ('left empty until AD-RT/EOP observability is configured'), so "
    "there is no official link between Ranverso scenarios and sensors or rules.",
]

DESIGN_ASSUMPTIONS = [
    "Levels = ABC priority labels. A level is offered only if the monument has at least one scenario with that "
    "label. Missions have 3 threats; when a level has fewer, we borrow from the next lower level, then higher.",
    "Coins grow with the danger level, the same at every monument (content/coins.json): Low 12, Medium 13, "
    "High 14, Extreme 15, Catastrophic 16. Every level keeps at least 4 coins beyond its cheapest full score.",
    "Alarm plausibility: humidity and soil moisture must be 0 to 100, rain 0 to 1000, temperature -50 to 60. "
    "An exact 0 for humidity or soil moisture is treated as a sensor dropout.",
    "Alarm episodes: alarms of one rule less than 48 hours apart form one episode; the game features the first, "
    "the strongest (largest multiple of the threshold) and the last alarm of each episode, at most 10.",
    "Score (web/src/game/logic.ts): per mission threat 20 points with a primary card, 8 with only supporting "
    "cards (60); 25 if the network detects the replayed real alarm; up to 15 for the share of coins spent on cards "
    "that help with a mission threat or the alarm. The total is scaled to 100 when a part does not apply (no "
    "replayable alarm, or a threat no card can warn about).",
    "A level's own alarm (day 1) never comes from a flat signal (a probably stuck sensor); the build refuses such a "
    "pick. Later days of a week on duty can replay one, and the alarm screen then says the sensor may be stuck.",
    "Second turn and week on duty (web/src/game/logic.ts, weekAlarms): after the score the player may improve the "
    "network (same sensors, coins and dangers) and may go on, one optional day at a time, through up to 7 days. Day "
    "1 is the level's own alarm; later days take the monument's other replayable alarms, a different rule each day "
    "while there is one, oldest first within a rule. They are real alarms from different dates, shown with their "
    "real dates, not consecutive days. Each day is scored like day 1 with that day's alarm; cards that detect an "
    "earlier day's alarm count as helpful coins. Only the first attempt of day 1 is stored for the class.",
    "Challenge link: monument, level, the three dangers (ARGUS threat ids) and a score to beat, in the page address. "
    "Only the level's own mission or one from its pool is accepted.",
    "The human-observer card stands for regular visual inspection by people. It helps with threats people can see "
    "(pests, mould, vandalism, new cracks) but never detects an AD-RT alarm, and it is left out of the ARGUS "
    "comparison because ARGUS lists instruments only.",
    "AI alarms: used only when one signal accounts for at least 30% of the model's top feature contributions and "
    "content/rule_sensor_map.json maps that signal (dl_features) to a pseudo-rule such as DL_soil_moisture. The "
    "game then shows the main signal and its share, not the anomaly score against its limit.",
    "Detection: the player's network detects an alarm if, for every group in the rule's detect_with, it has at "
    "least one card from that group. Real sensor placement (inside or outside, which wall) is ignored. A level "
    "without a usable alarm (e.g. DL-only sites) skips the replay with a short message.",
    "Reveal counts distinct ARGUS instruments (not installed-instrument records) and groups them by card.",
    "Decision step: after the replayed alarm the player chooses what to do first. The quoted recommendation is "
    "the ARGUS decision record linked to that alarm (decision-contexts and decisions, read from the first "
    "snapshot when a later one lacks them); every such record in the snapshot has the same text ('Review alarm "
    "evidence and affected asset context before intervention.'), and AI alarms have none. Our verdict rule "
    "(web/src/game/logic.ts, judgeDecision): looking first is where experts start; acting at once is too early; "
    "waiting is risky when the alarm came back within its episode or was at least twice its limit, otherwise "
    "fair. The choice is stored for class discussion and never scored.",
    "Observation report: a visitor records what they saw (a checklist item or 'something else'), a note, the "
    "spot (a pin on the map, rounded to about a metre), the day and an optional photo, and gets a card to print. "
    "It is kept on the visitor's device only (never in the class or community store) and the photo is not stored "
    "at all. The data file follows ARGUS's own cultural-documentation record (schema argus_cultural_documentation_v1, "
    "CIDOC CRM E14 Condition Assessment, as in the snapshot's Delos test record): severity and the asset state "
    "stay empty because a visitor cannot know them, the spot and the checklist item sit under an added "
    "'citizen_observation' key, and site_key is the ARGUS site key whose name contains the nearest named place "
    "(else the pilot key, which is not an ARGUS site key at Delos and Monti Lucretili). Nothing loads these files "
    "into ARGUS: whether and how ARGUS would accept citizen records is a question for the ARGUS team.",
    "Photographs: one real photograph per monument, from Wikimedia Commons under a free licence "
    "(content/photos/credits.json). Author, licence and source are shown under each photo and in the game's photo "
    "credits; the build refuses a photo without them. The captions are ours. The Monti Lucretili photo shows the "
    "dry-stone walls of the landscape (an ARGUS scenario there), because no freely licensed photograph of the "
    "monitored buildings was found.",
    "Map: sensor positions are the installed-device coordinates from ARGUS. Where the player puts a sensor on the "
    "map does not change the score; distances to the real ARGUS sensors are shown only as discussion prompts.",
]


def copy_backdrops(content_dir: Path = CONTENT_DIR, out_dir: Path = OUT_BACKDROPS) -> List[str]:
    """Copy the drawn-plan backdrops (OSM / Natural Earth, see tools/fetch_backdrops.py) next to the game."""
    copied = []
    out_dir.mkdir(parents=True, exist_ok=True)
    for src in sorted((content_dir / "backdrops").glob("*.json")):
        collection = load_json(src)
        if collection.get("type") != "FeatureCollection" or not collection.get("attribution"):
            raise BuildError(f"{src.name}: not a FeatureCollection with an attribution")
        (out_dir / src.name).write_bytes(src.read_bytes())
        copied.append(src.name)
    return copied


def write_outputs(data: Dict[str, Any], notes: str, out_json: Path = OUT_JSON, out_notes: Path = OUT_NOTES) -> None:
    for path in (out_json, out_notes):
        if SNAPSHOT_DIR.resolve() in path.resolve().parents:
            raise BuildError(f"refusing to write inside the snapshot: {path}")
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_notes.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    out_notes.write_text(notes, encoding="utf-8")


def copy_photos(content: Dict[str, Any], content_dir: Path = CONTENT_DIR, out_dir: Path = OUT_PHOTOS) -> List[str]:
    """Copy the monument photos (content/photos, credits in credits.json) next to the game; drop files no longer listed."""
    wanted = sorted({p[key] for p in content.get("photos", {}).values() for key in ("file", "thumb")})
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*"):
        if stale.name not in wanted:
            stale.unlink()
    for name in wanted:
        (out_dir / name).write_bytes((content_dir / "photos" / name).read_bytes())
    return wanted


def write_translations(packs: Dict[str, Dict[str, Any]], out_dir: Path = OUT_TRANSLATIONS) -> None:
    """One small file per language next to the game; files of languages that were removed are deleted."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale in out_dir.glob("*.json"):
        if stale.stem not in packs:
            stale.unlink()
    for lang, entry in packs.items():
        (out_dir / f"{lang}.json").write_text(
            json.dumps(entry["pack"], ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main(argv: Optional[List[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")  # -I ignores PYTHONIOENCODING
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--snapshot", type=Path, default=SNAPSHOT_DIR)
    parser.add_argument("--content", type=Path, default=CONTENT_DIR)
    parser.add_argument("--check", action="store_true", help="build and validate without writing")
    args = parser.parse_args(argv)
    try:
        data, notes = build(args.snapshot, args.content)
    except BuildError as exc:
        print(f"build_game_data: {exc}", file=sys.stderr)
        return 1
    size = len(json.dumps(data, ensure_ascii=False).encode("utf-8"))
    playable = [m["pilot_key"] for m in data["monuments"] if m["playable"]]
    packs = translation_packs(data, args.content)
    if not args.check:
        write_outputs(data, notes)
        copy_backdrops(args.content)
        copy_photos(load_json(args.content / "photos" / "credits.json") if (args.content / "photos" / "credits.json").exists() else {},
                    args.content)
        write_translations(packs)
    print(f"build_game_data: {'checked' if args.check else 'wrote'} {OUT_JSON.relative_to(ROOT)} "
          f"({size / 1024:.1f} KiB), playable: {', '.join(playable) or 'none'}")
    total = len(content_texts(data))
    for lang, entry in sorted(packs.items()):
        print(f"build_game_data: translation {lang}: {len(entry['pack']['strings'])} of {total} texts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
