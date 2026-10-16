#!/usr/bin/env python3
"""Data for the game's 3D view of the House of the Masks on Delos (web/public/data/view3d/delos-masks.json).

A prototype of "zoom from the game's map down into 3D, then see what years of unnoticed damp would
do" (README, "3D view"; drawn by web/src/view3d). Built only from data the game may use:

  ruin and plots   the ruin's outline (historic=ruins) and the plot outlines, from OpenStreetMap
                   (content/backdrops/delos.json, ODbL)
  rooms, sensors   ARGUS's own 3D-viewer placements (snapshot/monitorings.json): each sensor's position
                   and height, and its instrument name, which says the room
                   ("Room 215 - Theatrical Masks mosaic")
  origin           where ARGUS places its own 3D model of the house (asset-states,
                   spatial_representations.model_placements["delos-masks"]); checked by the tests
  dangers          ARGUS's risk scenarios for this house (web/public/data/game_data.json); the game
                   reads last night's check from the Pi (/live/argus-now.json) when it is served there
  photos           two mosaic photos from Wikimedia Commons, free licences (PHOTOS below)

ARGUS does not publish the 3D models themselves (only their names and placements), so the walls are
the outline at an assumed height, the room floors and panels have assumed sizes, and all damage is an
illustration. Those assumptions are listed in README ("3D view").

    python3 -I tools/build_preview_3d.py [--live argus-now.json]   # --live: embed a copy of a check
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
BACKDROP = ROOT / "content" / "backdrops" / "delos.json"
GAME_DATA = ROOT / "web" / "public" / "data" / "game_data.json"
MONITORINGS = ROOT / "snapshot" / "monitorings.json"
INSTRUMENTS = ROOT / "snapshot" / "installed-instruments.json"
OUT = ROOT / "web" / "public" / "data" / "view3d" / "delos-masks.json"

ORIGIN = {"lat": 37.39626, "lon": 25.26949, "height": 36.79}  # ARGUS's placement of its model "delos-masks"
RUIN_OSM_ID = 384671023  # OpenStreetMap: building=yes, historic=ruins, the House of the Masks
NEAR = 45  # metres: sensors of this house
PLOTS_NEAR = 170  # metres: plot outlines drawn around it
KINDS = [("soil moisture", "soil_moisture"), ("humidity", "humidity"), ("temperature", "temperature"), ("lux", "light_uv"),
         ("air flow", "airflow"), ("tiltmeter", "tiltmeter"), ("anemometer", "weather_station"), ("crack", "crackmeter")]
# Straight-down photos of two of the four mosaics (checked on Wikimedia Commons, 15 Oct 2026).
PHOTOS = {
    "216": {"title": "Delos Haus der Masken 08.jpg", "author": "Olaf Tausch", "license": "Public domain",
            "page": "https://commons.wikimedia.org/wiki/File:Delos_Haus_der_Masken_08.jpg",
            "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a7/Delos_Haus_der_Masken_08.jpg/960px-Delos_Haus_der_Masken_08.jpg",
            "w": 1024, "h": 925},
    "217": {"title": "Delos Mosaic - panoramio (4).jpg", "author": "Kevin Stroup", "license": "CC BY 3.0",
            "page": "https://commons.wikimedia.org/wiki/File:Delos_Mosaic_-_panoramio_(4).jpg",
            "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/79/Delos_Mosaic_-_panoramio_%284%29.jpg/960px-Delos_Mosaic_-_panoramio_%284%29.jpg",
            "w": 1024, "h": 768},
}
LEVELS = ["low", "medium", "high", "extreme", "catastrophic"]


def metres_per_degree() -> List[float]:
    return [111320 * math.cos(math.radians(ORIGIN["lat"])), 110540]


def to_local(lon: float, lat: float) -> List[float]:
    kx, ky = metres_per_degree()
    return [round((lon - ORIGIN["lon"]) * kx, 2), round((lat - ORIGIN["lat"]) * ky, 2)]


def serial(name: str) -> str | None:
    """An instrument's serial number from its name ("Installed Instrument Soil Moisture - 149368 (Room
    215 ...)" -> "149368"): the game finds the sensor of an alarm by it."""
    parts = name.split(" - ", 1)
    return parts[1].split(" (")[0].strip() or None if len(parts) == 2 else None


def metadata(record: Dict[str, Any]) -> Dict[str, Any]:
    raw = record.get("metadata")
    if isinstance(raw, dict):
        return raw
    try:
        value = json.loads(raw) if isinstance(raw, str) else {}
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def outline(feature: Dict[str, Any]) -> List[List[float]]:
    return [to_local(lon, lat) for lon, lat in feature["geometry"]["coordinates"][0]]


def shapes() -> List[Dict[str, Any]]:
    out = []
    for f in json.loads(BACKDROP.read_text(encoding="utf-8"))["features"]:
        p = f["properties"]
        if f["geometry"]["type"] != "Polygon":
            continue
        if p.get("osm_id") == RUIN_OSM_ID:
            out.append({"kind": "ruin", "osm_id": p["osm_id"], "name": "Οικία με τα Προσωπεία", "ring": outline(f)})
        elif p.get("kind") == "site":
            ring = outline(f)
            cx = sum(x for x, _ in ring) / len(ring)
            cy = sum(y for _, y in ring) / len(ring)
            if math.hypot(cx, cy) < PLOTS_NEAR:
                out.append({"kind": "site", "osm_id": p.get("osm_id"), "name": p.get("name"), "ring": ring})
    return out


def instrument_types() -> Dict[int, str]:
    """ARGUS's own name for the type of each installed instrument ("Humidity Sensor"), by its id (the same as
    tools/build_scenes_3d.py's: installed instrument -> instrument -> instrument type)."""
    def records(path: Path) -> List[Dict[str, Any]]:
        return json.loads(path.read_text(encoding="utf-8"))["records"]
    type_names = {r["id"]: r.get("name", "") for r in records(INSTRUMENTS.parent / "instrument-types.json")}
    of_instrument = {r["id"]: type_names.get(r.get("instrument_type_id"), "") for r in records(INSTRUMENTS.parent / "instruments.json")}
    return {r["id"]: of_instrument.get(r.get("instrument_id"), "") for r in records(INSTRUMENTS)}


def sensors() -> List[Dict[str, Any]]:
    names = {r["id"]: r.get("name", "") for r in json.loads(INSTRUMENTS.read_text(encoding="utf-8"))["records"]}
    types = instrument_types()
    out = []
    for r in json.loads(MONITORINGS.read_text(encoding="utf-8"))["records"]:
        position = (metadata(r).get("viewer_placement") or {}).get("position") or {}
        if not position:
            continue
        xy = to_local(position["longitude"], position["latitude"])
        if math.hypot(*xy) > NEAR:
            continue
        name = names.get(r.get("installed_instrument_id"), "")
        room = re.search(r"Room (\d+) - ([^)]*)", name)
        out.append({
            "xy": xy,
            "h": round(position["height"] - ORIGIN["height"], 2),  # above ARGUS's model of the house
            "kind": next((k for word, k in KINDS if word in name.lower()), "other"),
            "type": types.get(r.get("installed_instrument_id")) or None,
            "room": room.group(1) if room else None,
            "room_name": room.group(2).strip() if room else None,
            "serial": serial(name),
        })
    return sorted(out, key=lambda s: (s["room"] or "~", s["kind"], s["xy"]))


def rooms(found: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    by_room: Dict[str, Dict[str, Any]] = {}
    for s in found:
        if s["room"]:
            by_room.setdefault(s["room"], {"room": s["room"], "name": s["room_name"], "points": []})["points"].append(s["xy"])
    out = []
    for key in sorted(by_room):
        r = by_room[key]
        pts = r.pop("points")
        r["xy"] = [round(sum(p[0] for p in pts) / len(pts), 2), round(sum(p[1] for p in pts) / len(pts), 2)]
        if key in PHOTOS:
            r["photo"] = PHOTOS[key]
        out.append(r)
    return out


def dangers(live: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    game = json.loads(GAME_DATA.read_text(encoding="utf-8"))
    delos = next(m for m in game["monuments"] if m["pilot_key"] == "delos")
    checks = {c["key"]: c for c in (((live or {}).get("sites") or {}).get("delos") or {}).get("risk", {}).get("scenarios", [])}
    out = []
    for s in delos["scenarios"]:
        if not s["scenario_key"].startswith("delos-masks"):
            continue
        c = checks.get(s["scenario_key"]) or {}
        out.append({"key": s["scenario_key"], "title": s["plain"]["title"], "level": s["level"],
                    "state": c.get("state"), "probability": c.get("probability"), "watch": (c.get("thresholds") or {}).get("watch")})
    return sorted(out, key=lambda d: (-LEVELS.index(d["level"]), d["key"]))


def build(live: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    found = sensors()
    return {
        "about": "Data for the game's 3D view (web/src/view3d), written by tools/build_preview_3d.py. See README, '3D view'.",
        "scene": "delos-masks",
        # ARGUS's model is cut this far above the floor: the modern shelters over the mosaics (5-6 m up)
        # would hide the floors from above; the walls stand to about 3.5 m.
        "cut_above_m": 4.3,
        "origin": {"lat": ORIGIN["lat"], "lon": ORIGIN["lon"]},
        "base_height": ORIGIN["height"],
        "metres_per_degree": metres_per_degree(),
        "shapes": shapes(),
        "sensors3d": found,
        "rooms": rooms(found),
        "dangers": dangers(live),
        "risk_checked_at": (((live or {}).get("sites") or {}).get("delos") or {}).get("risk", {}).get("evaluated_at"),
        "credits": {"outlines": "© OpenStreetMap contributors (ODbL 1.0)", "rooms_sensors_dangers": "ARGUS",
                    "photos": [{"room": k, **{f: v[f] for f in ("title", "author", "license", "page")}} for k, v in PHOTOS.items()]},
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--live", type=Path, help="a copy of the Pi's argus-now.json to embed (the game reads it live anyway)")
    args = parser.parse_args(argv)
    live = json.loads(args.live.read_text(encoding="utf-8")) if args.live else None
    data = build(live)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"build_preview_3d: wrote {OUT.relative_to(ROOT)}: {len(data['rooms'])} rooms, {len(data['sensors3d'])} sensors, "
          f"{len(data['dangers'])} dangers")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
