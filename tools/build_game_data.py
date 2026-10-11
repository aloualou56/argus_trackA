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
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_DIR = ROOT / "snapshot"
CONTENT_DIR = ROOT / "content"
OUT_JSON = ROOT / "web" / "public" / "data" / "game_data.json"
OUT_NOTES = ROOT / "docs" / "data_notes.md"
OUT_BACKDROPS = ROOT / "web" / "public" / "data" / "backdrops"
BACKDROP_URL = "data/backdrops/{name}"  # relative to the web app

SCHEMA_VERSION = 1
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
MIN_FEATURED_ALARMS = 5
MAX_FEATURED_ALARMS = 10

# Resources the build reads. asset-states.json is large (about 31 MB) but only Python
# reads it, to map installed devices to monuments; it never reaches the browser.
RESOURCES = [
    "assets", "asset-states", "threats", "events", "policies",
    "installed-instruments", "installed-devices", "instruments", "instrument-types",
]


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
    return {name: load_resource(snapshot_dir, name) for name in RESOURCES}


def load_content(content_dir: Path) -> Dict[str, Any]:
    monuments = {}
    for path in sorted((content_dir / "monuments").glob("*.json")):
        pack = load_json(path)
        monuments[pack["pilot_key"]] = pack
    return {
        "cards": load_json(content_dir / "sensor_cards.json"),
        "rule_map": load_json(content_dir / "rule_sensor_map.json"),
        "threat_map": load_json(content_dir / "threat_sensor_map.json"),
        "map": load_json(content_dir / "map.json"),
        "monuments": monuments,
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
        self.fetched_at = sorted({raw[r]["fetched_at"] for r in raw})
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
        self.pilot_to_asset = self._map_pilots_to_assets()

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
        key = (a.get("type"), a.get("rule"), a.get("timestamp"), tuple(v.get("name") for v in variables))
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
        if a.get("type") != "EK" or not rule:
            excluded["deep-learning alarm without a rule (not mappable to a sensor)"] += 1
            continue
        entry = content.rule(pilot, rule)
        if entry is None:
            excluded["rule not in content/rule_sensor_map.json"] += 1
            continue
        variables = a.get("variables") or []
        if len(variables) != 1:
            excluded["not exactly one variable"] += 1
            continue
        var = variables[0]
        value, threshold = var.get("value"), var.get("threshold")
        if not isinstance(value, (int, float)) or not isinstance(threshold, (int, float)) or threshold == 0:
            excluded["missing value or threshold"] += 1
            continue
        card = primary_card(entry)
        lo_hi = PLAUSIBLE_RANGES.get(card)
        if lo_hi and not (lo_hi[0] <= value <= lo_hi[1]):
            excluded[f"implausible {card} value (outside {lo_hi[0]:g} to {lo_hi[1]:g})"] += 1
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
            "variable": var.get("name"),
            "value": round_or_none(value),
            "threshold": round_or_none(threshold),
            "direction": direction,
            "times_threshold": round_or_none(severity, 2),
            "_severity": severity or 0.0,
            "instruments": link_instruments(var.get("name", ""), entry, content, installed_rows, positions),
            "quality_flags": flags,
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
            if alarm["rule"] == spec.get("rule") and spec.get("pick", "peak") in alarm["roles"]:
                return alarm["id"]
    peaks = sorted((a for a in alarms if "peak" in a["roles"]), key=lambda a: -(a["times_threshold"] or 0))
    return (peaks or alarms)[0]["id"]


def build_levels(scenarios, alarms, pack) -> List[Dict[str, Any]]:
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
    levels = build_levels(scenarios, alarms, pack)

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
    for alarm in alarms:
        ctx = alarm_context.get(alarm["rule"])
        alarm["context"] = ({"links": ctx.get("links", []), "why": ctx.get("why"), "authored": True,
                             "needs_review": bool(ctx.get("needs_review"))} if ctx else None)
    entry.update({
        "display_name": pack["display_name"],
        "place": pack["place"],
        "story": dict(pack["story"], authored=True),
        "budget": pack["budget"],
        "levels": levels,
        "scenarios": scenarios,
        "installed": installed,
        "alarms": alarms,
        "alarm_funnel": {k: funnel[k] for k in ("records", "unique", "usable", "featured", "excluded", "by_rule")},
        "discussion_prompts": [dict(p, authored=True) for p in pack.get("discussion_prompts", [])],
    })
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
            for key in level["mission"]:
                if key not in keys:
                    problems.append(f"{mon['pilot_key']} {level['key']}: unknown mission scenario '{key}'")
            spec = (content.monuments[mon["pilot_key"]].get("featured_alarm") or {})
            spec = spec.get(level["key"]) or spec.get("default")
            chosen = next((a for a in mon["alarms"] if a["id"] == level["featured_alarm"]), None)
            if spec and (chosen is None or chosen["rule"] != spec.get("rule")):
                problems.append(f"{mon['pilot_key']} {level['key']}: featured_alarm {spec} matches no replayable alarm "
                                "(alarms from a flat signal are never replayed)")
        for alarm in mon["alarms"]:
            if not alarm["context"]:
                problems.append(f"{mon['pilot_key']}: no alarm_context for rule {alarm['rule']}")
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
    keep = ("detect_with", "measures", "unit", "unit_confirmed", "needs_review")
    return {key: {k: v for k, v in entry.items() if k in keep} for key, entry in sorted(content.rules.items())}


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
        "basemaps": {"default": content.basemaps["default"],
                     "layers": [{k: v for k, v in layer.items() if k != "review_note"}
                                for layer in content.basemaps["layers"]],
                     "world": BACKDROP_URL.format(name="world_land.json")
                     if (content_dir / "backdrops" / "world_land.json").exists() else None},
        "monuments": monuments,
    }
    for mon in monuments:
        mon["backdrop"] = (BACKDROP_URL.format(name=f"{mon['pilot_key']}.json")
                           if (content_dir / "backdrops" / f"{mon['pilot_key']}.json").exists() else None)
    notes = render_notes(snap, content, stats)
    return data, notes


def md_table(headers: List[str], rows: List[List[Any]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(lines)


def collect_review_items(content: Content) -> List[str]:
    items = []
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
        items.append(f"`content/monuments/{pilot}.json`: all {len([k for k in pack.get('plain_threats', {}) if not k.startswith('_')])} "
                     "plain-language threat texts are placeholders (check science and Greek)")
        for prompt in pack.get("discussion_prompts", []):
            if prompt.get("needs_review"):
                items.append(f"`{pilot}` discussion prompt \"{prompt['en'][:60]}...\": {prompt.get('review_note', '')}")
        for rule, ctx in sorted(pack.get("alarm_context", {}).items()):
            if ctx.get("needs_review"):
                items.append(f"`{pilot}` alarm explanation for `{rule}` and its linked threats {ctx.get('links')}")
        items.append(f"`{pilot}` mission picks per level and budget ({pack.get('budget')} coins)")
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
    "Delos and Baltanas alarms in the sample are all deep-learning (DL) alarms without rule names, so the "
    "rule-to-sensor check cannot be used there yet.",
    "Units are not part of the alarm data.",
    "Ranverso scenario 'evidence' lists are empty ('left empty until AD-RT/EOP observability is configured'), so "
    "there is no official link between Ranverso scenarios and sensors or rules.",
]

DESIGN_ASSUMPTIONS = [
    "Levels = ABC priority labels. A level is offered only if the monument has at least one scenario with that "
    "label. Missions have 3 threats; when a level has fewer, we borrow from the next lower level, then higher.",
    "Alarm plausibility: humidity and soil moisture must be 0 to 100, rain 0 to 1000, temperature -50 to 60. "
    "An exact 0 for humidity or soil moisture is treated as a sensor dropout.",
    "Alarm episodes: alarms of one rule less than 48 hours apart form one episode; the game features the first, "
    "the strongest (largest multiple of the threshold) and the last alarm of each episode, at most 10.",
    "Score (web/src/game/logic.ts): per mission threat 20 points with a primary card, 8 with only supporting "
    "cards (60); 25 if the network detects the replayed real alarm; up to 15 for the share of coins spent on cards "
    "that help with a mission threat or the alarm. The total is scaled to 100 when a part does not apply (no "
    "replayable alarm, or a threat no card can warn about).",
    "Replayed alarms never come from a flat signal (a probably stuck sensor); the build refuses such a pick.",
    "The human-observer card stands for regular visual inspection by people. It helps with threats people can see "
    "(pests, mould, vandalism, new cracks) but never detects an AD-RT alarm, and it is left out of the ARGUS "
    "comparison because ARGUS lists instruments only.",
    "Detection: the player's network detects an alarm if, for every group in the rule's detect_with, it has at "
    "least one card from that group. Real sensor placement (inside or outside, which wall) is ignored. A level "
    "without a usable alarm (e.g. DL-only sites) skips the replay with a short message.",
    "Reveal counts distinct ARGUS instruments (not installed-instrument records) and groups them by card.",
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
    if not args.check:
        write_outputs(data, notes)
        copy_backdrops(args.content)
    print(f"build_game_data: {'checked' if args.check else 'wrote'} {OUT_JSON.relative_to(ROOT)} "
          f"({size / 1024:.1f} KiB), playable: {', '.join(playable) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
