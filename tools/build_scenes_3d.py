#!/usr/bin/env python3
"""The game's 3D scenes, one per model ARGUS places (web/public/data/view3d/scenes.json).

ARGUS lists its 3D data in its own API (asset-states, metadata.spatial_representations): per
monument a Cesium terrain, one or more 3D Tiles models and where it places them ("model_placements").
Each placement is a scene of the game's 3D view: Delos has two houses (the House of the Masks and the
House of Fournoi), Monti Lucretili three places, the others one each. Each ARGUS sensor with a 3D
position (monitorings, metadata.viewer_placement) belongs to the scene it is nearest to; its
instrument name says what and where ("Accelerometer - 159070 (Schenkenberg tower - North wall)").

    python3 -I tools/build_scenes_3d.py      # writes web/public/data/view3d/scenes.json and <scene>.json

Each scene also gets the data file the game's 3D view reads (<scene>.json: its sensors and ARGUS's
risk scenarios for that place, those whose key starts with the scene's name), except the House of the
Masks, whose richer file (rooms, ruin outline, mosaic photos) tools/build_preview_3d.py writes. The
model and terrain files of each scene are taken with tools/fetch_argus_3d.py (needs the internet); the
game offers a scene in 3D only when its model is there (tools/build_game_data.py checks). Standard
library only, no internet.
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "view3d" / "scenes.json"
GAME_DATA = ROOT / "web" / "public" / "data" / "game_data.json"
OWN_FILE = {"delos-masks"}  # scenes whose <scene>.json another tool writes (tools/build_preview_3d.py)
LEVELS = ["low", "medium", "high", "extreme", "catastrophic"]
MIN_RADIUS, MAX_RADIUS = 30.0, 150.0  # metres of model around a placement
NEAR = 120.0  # metres: a sensor farther than this from every placement of its monument is in no scene
KINDS = [("soil moisture", "soil_moisture"), ("humidity", "humidity"), ("temperature", "temperature"), ("lux", "light_uv"),
         ("air flow", "airflow"), ("tilt", "tiltmeter"), ("anemometer", "weather_station"), ("crack", "crackmeter"),
         ("accelero", "vibration"), ("vibration", "vibration"), ("rain", "rain_gauge"), ("weather", "weather_station"),
         ("people", "people_counter"), ("acoustic", "acoustic"), ("gnss", "gnss"), ("water potential", "soil_moisture")]


def newest_snapshot() -> Path:
    found = sorted(p for p in ROOT.glob("snapshot*") if (p / "asset-states.json").exists())
    if not found:
        raise SystemExit("build_scenes_3d: no snapshot with asset-states.json")
    return found[-1]


def serial(name: str) -> str | None:
    """An instrument's serial number from its name ("Installed Instrument Soil Moisture - 149368 (Room
    215 ...)" -> "149368"): the game finds the sensor of an alarm by it."""
    parts = name.split(" - ", 1)
    return parts[1].split(" (")[0].strip() or None if len(parts) == 2 else None


def instrument_types(base: Path) -> Dict[int, str]:
    """ARGUS's own name for the type of each installed instrument ("Humidity Sensor", "Gas Sensor"), by the
    installed instrument's id: installed instrument -> instrument -> instrument type."""
    def records(name: str) -> List[Dict[str, Any]]:
        return json.loads((base / name).read_text(encoding="utf-8"))["records"]
    type_names = {r["id"]: r.get("name", "") for r in records("instrument-types.json")}
    of_instrument = {r["id"]: type_names.get(r.get("instrument_type_id"), "") for r in records("instruments.json")}
    return {r["id"]: of_instrument.get(r.get("instrument_id"), "") for r in records("installed-instruments.json")}


def metadata(record: Dict[str, Any]) -> Dict[str, Any]:
    raw = record.get("metadata")
    if isinstance(raw, dict):
        return raw
    try:
        value = json.loads(raw) if isinstance(raw, str) else {}
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def metres(lat: float) -> List[float]:
    return [111_320.0 * math.cos(math.radians(lat)), 110_540.0]


def named(key: str, pilot: str, tilesets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The models a placement is of: those whose name has a word of the placement's own name
    ("delos-masks" -> "Delos Island - House of Masks"), else all of its monument's."""
    words = [w for w in re.split(r"[^a-z]+", key.lower()) if len(w) >= 4 and w != pilot]
    def text(m):
        return " ".join(str(m.get(k) or "") for k in ("id", "label", "url")).lower()
    mine = [m for m in tilesets if any(w in text(m) for w in words)]
    return mine or tilesets


def placements(snapshot: Path) -> List[Dict[str, Any]]:
    """Every model placement in ARGUS's asset-states, with its monument's terrain and models."""
    seen, out = set(), []
    for r in json.loads((snapshot / "asset-states.json").read_text(encoding="utf-8"))["records"]:
        sr = metadata(r).get("spatial_representations") or {}
        terrain = (sr.get("terrain") or {}).get("url")
        models = [m for m in sr.get("models") or [] if m.get("type") == "3d_tiles" and m.get("url")]
        pilot = ((sr.get("terrain") or {}).get("id") or "").replace("-terrain", "") or None
        for key, place in (sr.get("model_placements") or {}).items():
            if key in seen or not pilot:
                continue
            seen.add(key)
            p = place.get("position") or {}
            tilesets = [{"id": m["id"], "label": m.get("label"), "url": m["url"]} for m in models]
            out.append({
                "id": key,
                "pilot": pilot,
                "lat": p["latitude"], "lon": p["longitude"], "height": p.get("height", 0.0),
                "hpr": [p.get("headingDegrees", 0.0), p.get("pitchDegrees", 0.0), p.get("rollDegrees", 0.0)],
                "scale": p.get("scale", 1.0),
                "terrain": terrain,
                "tilesets": named(key, pilot, tilesets),
            })
    return sorted(out, key=lambda s: s["id"])


def sensors(snapshot: Path, scenes: List[Dict[str, Any]]) -> None:
    """ARGUS's sensors with a 3D position, each in the scene of its monument it is nearest to."""
    base = ROOT / "snapshot"
    monitorings = json.loads((base / "monitorings.json").read_text(encoding="utf-8"))["records"]
    names = {r["id"]: r.get("name", "") for r in json.loads((base / "installed-instruments.json").read_text(encoding="utf-8"))["records"]}
    types = instrument_types(base)
    for s in scenes:
        s["sensors"] = []
    for r in monitorings:
        p = (metadata(r).get("viewer_placement") or {}).get("position")
        if not p:
            continue
        pilot = (r.get("description") or r.get("name") or "").split()[0].lower()
        mine = [s for s in scenes if s["pilot"] == pilot]
        if not mine:
            continue
        def dist(s):
            kx, ky = metres(s["lat"])
            return math.hypot((p["longitude"] - s["lon"]) * kx, (p["latitude"] - s["lat"]) * ky)
        scene = min(mine, key=dist)
        if dist(scene) > NEAR:  # e.g. Delos's tiltmeters in other districts: not at either house
            continue
        kx, ky = metres(scene["lat"])
        name = names.get(r.get("installed_instrument_id"), "") or r.get("name", "")
        where = re.search(r"\(([^)]*)\)", name)
        scene["sensors"].append({
            "xy": [round((p["longitude"] - scene["lon"]) * kx, 2), round((p["latitude"] - scene["lat"]) * ky, 2)],
            "h": round(p.get("height", scene["height"]) - scene["height"], 2),
            "alt": round(p.get("height", scene["height"]), 2),
            "kind": next((k for word, k in KINDS if word in name.lower()), "other"),
            "type": types.get(r.get("installed_instrument_id")) or None,
            # (ARGUS's text has "façade" with its c-cedilla lost to a replacement character)
            "where": where.group(1).strip().replace("fa�ade", "façade") if where else None,
            "monitoring": r["id"],
            "serial": serial(name),
        })
    for s in scenes:
        far = max((math.hypot(*x["xy"]) for x in s["sensors"]), default=0.0)
        s["radius"] = round(min(MAX_RADIUS, max(MIN_RADIUS, far + 15.0)), 1)
        s["metres_per_degree"] = metres(s["lat"])
        s["sensors"].sort(key=lambda x: x["monitoring"])


def build() -> Dict[str, Any]:
    snapshot = newest_snapshot()
    scenes = placements(snapshot)
    sensors(snapshot, scenes)
    return {"_about": "The 3D view's scenes: one per model ARGUS places (tools/build_scenes_3d.py). Each scene's "
                      "model and terrain are in <id>-model.json and <id>-terrain.json once tools/fetch_argus_3d.py "
                      "has taken them. Sensors: metres east/north of the placement (xy), above it (h) and above "
                      "the WGS84 ellipsoid (alt); the game puts them on its ground when a placement's height is off.",
            "snapshot": snapshot.name, "scenes": scenes}


def dangers(scene: Dict[str, Any], game: Dict[str, Any]) -> List[Dict[str, Any]]:
    """ARGUS's risk scenarios for this place: their keys start with the scene's name
    ("lucretili-montefalco.landslide.castle"; "schenkenberg.fire.small-30y")."""
    out = []
    for m in game.get("monuments", []):
        for s in m.get("scenarios", []):
            if s["scenario_key"].startswith(scene["id"] + "."):
                out.append({"key": s["scenario_key"], "title": s["plain"]["title"], "level": s["level"],
                            "state": None, "probability": None, "watch": None})
    return sorted(out, key=lambda d: (-LEVELS.index(d["level"]), d["key"]))


def scene_file(scene: Dict[str, Any], game: Dict[str, Any]) -> Dict[str, Any]:
    """The data the game's 3D view reads for a scene (the same shape as tools/build_preview_3d.py's)."""
    return {
        "about": "Data for the game's 3D view (web/src/view3d) of one place, written by tools/build_scenes_3d.py. "
                 "See README, '3D view'.",
        "scene": scene["id"],
        "origin": {"lat": scene["lat"], "lon": scene["lon"]},
        "base_height": scene["height"],
        "metres_per_degree": scene["metres_per_degree"],
        "shapes": [],
        "sensors3d": [{"xy": x["xy"], "h": x["h"], "alt": x["alt"], "kind": x["kind"], "type": x["type"], "where": x["where"],
                       "room": None, "serial": x["serial"]} for x in scene["sensors"]],
        "rooms": [],
        "dangers": dangers(scene, game),
        "risk_checked_at": None,
        # how far away the camera comes to rest: further over a bigger place
        "view_m": round(min(70.0, max(28.0, scene["radius"] * 0.75)), 1),
        "credits": {"model_terrain_sensors_dangers": "ARGUS"},
    }


def main() -> int:
    data = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    game = json.loads(GAME_DATA.read_text(encoding="utf-8")) if GAME_DATA.exists() else {}
    for s in data["scenes"]:
        if s["id"] not in OWN_FILE:
            path = OUT.parent / f"{s['id']}.json"
            path.write_text(json.dumps(scene_file(s, game), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for s in data["scenes"]:
        print(f"{s['id']:<24} {s['pilot']:<13} {len(s['sensors']):>3} sensors, radius {s['radius']:>5} m, "
              f"{len(s['tilesets'])} model(s), {len(dangers(s, game))} dangers")
    print(f"build_scenes_3d: wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
