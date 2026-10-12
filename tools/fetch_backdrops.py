#!/usr/bin/env python3
"""Fetch the drawn "plan" backdrops once and store them in content/backdrops/.

    python3 -I tools/fetch_backdrops.py            # playable monuments + Europe land
    python3 -I tools/fetch_backdrops.py --all      # every monument

The plan is the map the game shows when satellite or street-map pictures cannot load
(offline, or inside a sandbox that blocks outside images). It is real, openly licensed data:
  - content/backdrops/<pilot>.json   OpenStreetMap ways around the monument (ODbL 1.0,
                                     "© OpenStreetMap contributors"), via the OSM API map call
  - content/backdrops/world_land.json  Natural Earth 1:110m land (public domain)
The area is a box around each group of nearby ARGUS sensors (game_data.json) plus a margin, so
monuments spread over several sites (Monti Lucretili: three sites km apart) get one small box each.
Run this by hand when a monument becomes playable; build_game_data.py only copies the files.
Standard library only, Python 3.9+. Needs network access; the build itself does not.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
GAME_DATA = ROOT / "web" / "public" / "data" / "game_data.json"
OUT_DIR = ROOT / "content" / "backdrops"
USER_AGENT = "guardian-for-a-day/0.1 (ARGUS Open Innovation Challenge educational game)"
OSM_MAP = "https://api.openstreetmap.org/api/0.6/map.json?bbox={west},{south},{east},{north}"
NATURAL_EARTH = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson"
MARGIN_M = 150
CLUSTER_M = 500  # sensors closer than this share one OSM request
EUROPE = (-30.0, 20.0, 50.0, 72.0)  # west, south, east, north: enough for the overview map

GREEN = {"farmland", "meadow", "grass", "orchard", "vineyard", "forest", "village_green", "allotments"}
BUILT = {"residential", "industrial", "commercial", "retail", "farmyard", "religious", "cemetery"}


def get_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def kind_of(tags: Dict[str, str]) -> Optional[str]:
    if tags.get("amenity") == "place_of_worship" or tags.get("historic") in ("monastery", "church", "castle"):
        return "heritage"
    if "building" in tags:
        return "building"
    if "highway" in tags:
        return "road"
    if "railway" in tags:
        return "rail"
    if "waterway" in tags or tags.get("natural") == "water":
        return "water"
    if tags.get("landuse") in GREEN or tags.get("natural") in ("wood", "grassland", "scrub"):
        return "green"
    if tags.get("landuse") in BUILT:
        return "built"
    if tags.get("name") and not tags.get("type"):
        return "site"  # a named area such as the abbey grounds
    return None


def metres(a: List[float], b: List[float]) -> float:
    dx = (b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, b[0] - a[0]) * 111_320


def sensor_groups(mon: Dict[str, Any]) -> List[List[List[float]]]:
    """Bounding boxes of groups of sensors closer than CLUSTER_M to the group's first sensor."""
    points = [[p["lat"], p["lon"]] for p in (mon.get("installed") or {}).get("points", [])]
    if not points:
        return [mon["map"]["bounds"]]
    groups: List[List[List[float]]] = []
    for point in points:
        group = next((g for g in groups if metres(g[0], point) < CLUSTER_M), None)
        if group is None:
            groups.append([point])
        else:
            group.append(point)
    return [[[min(p[0] for p in g), min(p[1] for p in g)], [max(p[0] for p in g), max(p[1] for p in g)]] for g in groups]


def osm_features(bounds: List[List[float]]) -> Tuple[str, List[Dict[str, Any]]]:
    (south, west), (north, east) = bounds
    dlat = MARGIN_M / 111_320
    dlon = MARGIN_M / (111_320 * max(0.2, math.cos(math.radians((south + north) / 2))))
    url = OSM_MAP.format(west=round(west - dlon, 5), south=round(south - dlat, 5),
                         east=round(east + dlon, 5), north=round(north + dlat, 5))
    data = get_json(url)
    nodes = {e["id"]: (e["lon"], e["lat"]) for e in data["elements"] if e["type"] == "node"}
    features = []
    for way in (e for e in data["elements"] if e["type"] == "way"):
        tags = way.get("tags", {})
        kind = kind_of(tags)
        if kind is None:
            continue
        coords = [[round(nodes[n][0], 7), round(nodes[n][1], 7)] for n in way["nodes"] if n in nodes]
        if len(coords) < 2:
            continue
        closed = way["nodes"][0] == way["nodes"][-1] and len(coords) >= 4
        area = closed and kind not in ("road", "rail") and not (kind == "water" and "waterway" in tags)
        geometry = {"type": "Polygon", "coordinates": [coords]} if area else {"type": "LineString", "coordinates": coords}
        props = {"kind": kind, "osm_id": way["id"]}
        if tags.get("name"):
            props["name"] = tags["name"]
        features.append({"type": "Feature", "properties": props, "geometry": geometry})
    return url, features


def osm_backdrop(mon: Dict[str, Any]) -> Dict[str, Any]:
    by_id: Dict[int, Dict[str, Any]] = {}
    url = OSM_MAP
    for bounds in sensor_groups(mon):
        url, features = osm_features(bounds)
        for feature in features:
            by_id[feature["properties"]["osm_id"]] = feature  # a way can sit in two boxes
    order = ["green", "built", "site", "water", "road", "rail", "building", "heritage"]
    features = sorted(by_id.values(), key=lambda f: (order.index(f["properties"]["kind"]), f["properties"]["osm_id"]))
    return {
        "type": "FeatureCollection",
        "attribution": "© OpenStreetMap contributors",
        "license": "ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/)",
        "source": url.split("?")[0],
        "features": features,
    }


def in_box(coords: Any, box) -> bool:
    if isinstance(coords[0], (int, float)):
        return box[0] <= coords[0] <= box[2] and box[1] <= coords[1] <= box[3]
    return any(in_box(c, box) for c in coords)


def rounded(coords: Any) -> Any:
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 3), round(coords[1], 3)]
    return [rounded(c) for c in coords]


def world_land() -> Dict[str, Any]:
    data = get_json(NATURAL_EARTH)
    features = [
        {"type": "Feature", "properties": {"kind": "land"},
         "geometry": {"type": f["geometry"]["type"], "coordinates": rounded(f["geometry"]["coordinates"])}}
        for f in data["features"] if in_box(f["geometry"]["coordinates"], EUROPE)
    ]
    return {"type": "FeatureCollection", "attribution": "Natural Earth", "license": "public domain",
            "source": NATURAL_EARTH, "features": features}


def write(name: str, collection: Dict[str, Any]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    path.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"fetch_backdrops: wrote {path.relative_to(ROOT)} ({len(collection['features'])} features, "
          f"{path.stat().st_size / 1024:.0f} KiB)")


def main(argv: Optional[List[str]] = None) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--all", action="store_true", help="every monument, not only playable ones")
    args = parser.parse_args(argv)
    game = json.loads(GAME_DATA.read_text(encoding="utf-8"))
    failed = []
    write("world_land.json", world_land())
    for mon in game["monuments"]:
        if mon.get("map") and (args.all or mon["playable"]):
            try:
                write(f"{mon['pilot_key']}.json", osm_backdrop(mon))
            except Exception as exc:  # keep going: one refused area must not block the others
                failed.append(mon["pilot_key"])
                print(f"fetch_backdrops: {mon['pilot_key']} failed: {exc}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
