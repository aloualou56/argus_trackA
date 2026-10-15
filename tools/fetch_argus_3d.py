#!/usr/bin/env python3
"""Take only the part of ARGUS's own 3D data that the game's 3D view needs, and make it small.

ARGUS lists its 3D data in its own API (asset-states, metadata.spatial_representations): for Delos
the terrain "/terrain/delos/" (Cesium quantized-mesh) and the House of the Masks
"/tiles/delos/house-of-masks/tileset.json" (3D Tiles), placed at 37.39626 N, 25.26949 E. This tool
reads them from argus.athenarc.gr, from the computer it runs on (GET only, one request at a time, a
pause between requests, robots.txt respected, nothing but the area around the house).

    python3 -I tools/fetch_argus_3d.py terrain              # ARGUS terrain around the house -> the game
    python3 -I tools/fetch_argus_3d.py model                # survey the house's 3D model: nothing downloaded
    python3 -I tools/fetch_argus_3d.py model --download     # download the chosen part (to argus_3d_cache/)
    python3 -I tools/fetch_argus_3d.py model --download --export   # ... and write it as glTF for the game

terrain  Reads layer.json, picks the most detailed level that covers the area (--radius metres around
         the house, default 250, the ground the 3D view shows), downloads those tiles only, and
         resamples them to a regular grid (--spacing, default 2 m). Writes
         web/public/data/view3d/delos-masks-terrain.json (about 100-200 KB), which the 3D view uses
         instead of the coarser AWS Terrain Tiles. The downloaded tiles stay in argus_3d_cache/
         (ignored by git), so a second run reads them from there.
model    Reads tileset.json (and any nested tileset files: small JSON) and lists the tiles that touch
         the house (--model-radius, default 30 m), level by level, with their sizes (HEAD requests).
         Nothing else is downloaded unless --download is given; then only the tiles of the chosen
         level (--max-error, default 0.5 m: the tile's own geometricError) that touch the house, up
         to --budget-mb (default 300, never more than 5000). Their files go to argus_3d_cache/.

Standard library only, Python 3.9+. --base points at another server (e.g. a local test copy).
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import gzip
import json
import math
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from array import array
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "argus_3d_cache"
OUT_TERRAIN = ROOT / "web" / "public" / "data" / "view3d" / "delos-masks-terrain.json"
BASE = "https://argus.athenarc.gr"
TERRAIN_PATH = "/terrain/delos/"
TILESET_PATH = "/tiles/delos/house-of-masks/tileset.json"
# Where ARGUS places its model of the house (asset-states, model_placements["delos-masks"]).
HOUSE = {"lat": 37.39626, "lon": 25.26949, "height": 36.79}
USER_AGENT = "guardian-for-a-day/0.1 (ARGUS Open Innovation Challenge educational game; 3D view)"
HARD_LIMIT_MB = 5000
QM_ACCEPT = "application/vnd.quantized-mesh,application/octet-stream;q=0.9,*/*;q=0.01"


# --------------------------------------------------------------------------- polite HTTP

class Client:
    """GET (and HEAD) on one host only, one at a time, with a pause; robots.txt respected."""

    def __init__(self, base: str, delay: float, allow_hosts: List[str]):
        self.base = base.rstrip("/")
        self.host = urllib.parse.urlparse(self.base).hostname or ""
        self.allowed = {self.host, *allow_hosts}
        self.delay = delay
        self.last = 0.0
        self.requests = 0
        self.bytes = 0
        self.robots = urllib.robotparser.RobotFileParser()
        try:
            self.robots.parse(self._get(self.base + "/robots.txt", check=False).decode("utf-8", "replace").splitlines())
        except urllib.error.HTTPError:
            self.robots.parse([])  # no robots.txt: nothing is disallowed

    def url(self, path_or_url: str, relative_to: Optional[str] = None) -> str:
        return urllib.parse.urljoin(relative_to or self.base + "/", path_or_url)

    def _check(self, url: str) -> None:
        host = urllib.parse.urlparse(url).hostname or ""
        if host not in self.allowed:
            raise SystemExit(f"refusing {url}: only {', '.join(sorted(self.allowed))} (ARGUS's own server)")
        if not self.robots.can_fetch(USER_AGENT, url):
            raise SystemExit(f"refusing {url}: robots.txt of {host} disallows it")

    def _wait(self) -> None:
        pause = self.delay - (time.monotonic() - self.last)
        if pause > 0:
            time.sleep(pause)
        self.last = time.monotonic()

    def _get(self, url: str, accept: str = "*/*", check: bool = True) -> bytes:
        if check:
            self._check(url)
        self._wait()
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept,
                                                       "Accept-Encoding": "gzip"})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    body = response.read()
                break
            except urllib.error.HTTPError:
                raise
            except Exception as exc:  # network hiccup: wait and try again
                if attempt == 3:
                    raise RuntimeError(f"GET {url} failed: {exc}") from None
                time.sleep(2 * (attempt + 1))
        self.requests += 1
        self.bytes += len(body)
        return gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body

    def get(self, url: str, accept: str = "*/*") -> bytes:
        return self._get(url, accept)

    def get_cached(self, url: str, accept: str = "*/*") -> Optional[bytes]:
        """From argus_3d_cache/ when there, else from the server (and kept). None for a 404."""
        path = CACHE / urllib.parse.urlparse(url).path.lstrip("/")
        if path.exists():
            return path.read_bytes() or None
        try:
            body = self._get(url, accept)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"")  # remembered as missing
                return None
            raise
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        return body

    def size(self, url: str) -> Optional[int]:
        self._check(url)
        self._wait()
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                self.requests += 1
                length = response.headers.get("Content-Length")
                return int(length) if length else None
        except urllib.error.HTTPError:
            return None


# --------------------------------------------------------------------------- geometry

M_PER_DEG_LAT = 111_320.0


def shown(path: Path) -> str:
    """A path as printed: relative to the repository when it is inside it."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def metres_per_degree(lat: float) -> Tuple[float, float]:
    return M_PER_DEG_LAT * math.cos(math.radians(lat)), M_PER_DEG_LAT


def ecef_to_lla(x: float, y: float, z: float) -> Tuple[float, float, float]:
    a, e2 = 6378137.0, 6.69437999014e-3
    b = a * math.sqrt(1 - e2)
    ep2 = (a * a - b * b) / (b * b)
    p = math.hypot(x, y)
    th = math.atan2(z * a, p * b)
    lat = math.atan2(z + ep2 * b * math.sin(th) ** 3, p - e2 * a * math.cos(th) ** 3)
    lon = math.atan2(y, x)
    n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    return math.degrees(lat), math.degrees(lon), p / math.cos(lat) - n


def lla_to_ecef(lat: float, lon: float, h: float) -> Tuple[float, float, float]:
    a, e2 = 6378137.0, 6.69437999014e-3
    la, lo = math.radians(lat), math.radians(lon)
    n = a / math.sqrt(1 - e2 * math.sin(la) ** 2)
    return ((n + h) * math.cos(la) * math.cos(lo), (n + h) * math.cos(la) * math.sin(lo), (n * (1 - e2) + h) * math.sin(la))


# --------------------------------------------------------------------------- quantized-mesh terrain

def _zigzag(values) -> List[int]:
    out, v = [], 0
    for d in values:
        v += (d >> 1) ^ (-(d & 1))
        out.append(v)
    return out


def decode_quantized_mesh(raw: bytes) -> Dict[str, Any]:
    """Header, vertices (u, v in 0..32767; heights in metres) and triangles of a quantized-mesh-1.0 tile."""
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    hmin, hmax = struct.unpack_from("<2f", raw, 24)
    off = 88
    n, = struct.unpack_from("<I", raw, off)
    off += 4
    u = _zigzag(struct.unpack_from(f"<{n}H", raw, off))
    off += 2 * n
    v = _zigzag(struct.unpack_from(f"<{n}H", raw, off))
    off += 2 * n
    hq = _zigzag(struct.unpack_from(f"<{n}H", raw, off))
    off += 2 * n
    big = n > 65536
    size = 4 if big else 2
    if off % size:
        off += size - off % size
    tc, = struct.unpack_from("<I", raw, off)
    off += 4
    encoded = struct.unpack_from(f"<{3 * tc}{'I' if big else 'H'}", raw, off)
    indices, highest = [], 0  # high-water-mark encoding
    for code in encoded:
        indices.append(highest - code)
        if code == 0:
            highest += 1
    heights = [hmin + (x / 32767.0) * (hmax - hmin) for x in hq]
    return {"u": u, "v": v, "h": heights, "tri": indices, "hmin": hmin, "hmax": hmax}


class TerrainLayer:
    """A Cesium terrain layer (layer.json): its tiling scheme and which tiles exist."""

    def __init__(self, meta: Dict[str, Any], base_url: str):
        self.meta = meta
        self.base_url = base_url
        self.template = (meta.get("tiles") or ["{z}/{x}/{y}.terrain?v={version}"])[0]
        self.version = str(meta.get("version", "1.0.0"))
        self.geographic = "3857" not in str(meta.get("projection", "EPSG:4326"))
        self.tms = meta.get("scheme", "tms") == "tms"
        self.available = meta.get("available") or []
        self.maxzoom = int(meta.get("maxzoom", len(self.available) - 1 if self.available else 20))

    def tiles_across(self, z: int) -> Tuple[int, int]:
        return (2 ** (z + 1), 2 ** z) if self.geographic else (2 ** z, 2 ** z)

    def tile_of(self, lon: float, lat: float, z: int) -> Tuple[int, int]:
        nx, ny = self.tiles_across(z)
        if self.geographic:
            x = int((lon + 180) / 360 * nx)
            y = int((lat + 90) / 180 * ny)  # counted from the south (TMS)
        else:
            x = int((lon + 180) / 360 * nx)
            yt = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * ny)
            y = ny - 1 - yt
        if not self.tms:
            y = ny - 1 - y
        return min(max(x, 0), nx - 1), min(max(y, 0), ny - 1)

    def bounds(self, x: int, y: int, z: int) -> Tuple[float, float, float, float]:
        """West, south, east, north of a tile, in degrees."""
        nx, ny = self.tiles_across(z)
        ys = y if self.tms else ny - 1 - y  # counted from the south
        west, east = -180 + 360 * x / nx, -180 + 360 * (x + 1) / nx
        if self.geographic:
            return west, -90 + 180 * ys / ny, east, -90 + 180 * (ys + 1) / ny
        def lat_of(t: float) -> float:
            return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * t))))
        return west, lat_of(1 - (ys + 1) / ny), east, lat_of(1 - ys / ny)

    def listed(self, x: int, y: int, z: int) -> bool:
        """Whether layer.json says the tile exists (True when layer.json does not say)."""
        if z >= len(self.available):
            return not self.available or "metadataAvailability" in self.meta
        return any(r["startX"] <= x <= r["endX"] and r["startY"] <= y <= r["endY"] for r in self.available[z])

    def url(self, x: int, y: int, z: int) -> str:
        path = self.template.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y)).replace("{version}", self.version)
        return urllib.parse.urljoin(self.base_url, path)


def resample(layer: TerrainLayer, tiles: Dict[Tuple[int, int], Dict[str, Any]], z: int, lat0: float, lon0: float,
             radius: float, spacing: float) -> Tuple[List[Optional[float]], int, int]:
    """Heights on a regular grid of `spacing` metres, `radius` metres around (lat0, lon0), row by row from
    the north-west corner; None where no tile covers the point."""
    kx, ky = metres_per_degree(lat0)
    n = int(round(2 * radius / spacing)) + 1
    grid: List[Optional[float]] = [None] * (n * n)
    for (tx, ty), mesh in tiles.items():
        west, south, east, north = layer.bounds(tx, ty, z)
        # vertex positions in grid units (column, row)
        def col(u: int) -> float:
            lon = west + (east - west) * u / 32767
            return ((lon - lon0) * kx + radius) / spacing
        def row(v: int) -> float:
            if layer.geographic:
                lat = south + (north - south) * v / 32767
            else:  # v is linear in Web Mercator y
                ys, yn = (math.asinh(math.tan(math.radians(s))) for s in (south, north))
                lat = math.degrees(math.atan(math.sinh(ys + (yn - ys) * v / 32767)))
            return (radius - (lat - lat0) * ky) / spacing
        cs = [col(u) for u in mesh["u"]]
        rs = [row(v) for v in mesh["v"]]
        hs = mesh["h"]
        tri = mesh["tri"]
        for k in range(0, len(tri), 3):
            a, b, c = tri[k], tri[k + 1], tri[k + 2]
            ax, ay, bx, by, cx, cy = cs[a], rs[a], cs[b], rs[b], cs[c], rs[c]
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-12:
                continue
            for gy in range(max(0, math.ceil(min(ay, by, cy))), min(n - 1, math.floor(max(ay, by, cy))) + 1):
                for gx in range(max(0, math.ceil(min(ax, bx, cx))), min(n - 1, math.floor(max(ax, bx, cx))) + 1):
                    w1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
                    w2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
                    w3 = 1 - w1 - w2
                    if w1 >= -1e-9 and w2 >= -1e-9 and w3 >= -1e-9:
                        grid[gy * n + gx] = w1 * hs[a] + w2 * hs[b] + w3 * hs[c]
    return grid, n, n


def run_terrain(client: Client, args: argparse.Namespace) -> int:
    base = client.url(args.terrain_path)
    meta = json.loads(client.get(urllib.parse.urljoin(base, "layer.json"), "application/json"))
    layer = TerrainLayer(meta, base)
    lat0, lon0, radius = HOUSE["lat"], HOUSE["lon"], args.radius
    kx, ky = metres_per_degree(lat0)
    dlon, dlat = radius / kx, radius / ky
    corners = (lon0 - dlon, lat0 - dlat, lon0 + dlon, lat0 + dlat)
    print(f"terrain: {layer.meta.get('format')} {'geographic' if layer.geographic else 'web mercator'}, "
          f"levels 0-{layer.maxzoom}")
    # The most detailed level whose tiles cover the area (the middle tile answering is the test).
    chosen = None
    for z in range(min(layer.maxzoom, args.max_level), -1, -1):
        x, y = layer.tile_of(lon0, lat0, z)
        if not layer.listed(x, y, z):
            continue
        if client.get_cached(layer.url(x, y, z), QM_ACCEPT):
            chosen = z
            break
    if chosen is None:
        print("terrain: no tile found over the house", file=sys.stderr)
        return 1
    x0, y0 = layer.tile_of(corners[0], corners[1], chosen)
    x1, y1 = layer.tile_of(corners[2], corners[3], chosen)
    wanted = [(x, y) for x in range(min(x0, x1), max(x0, x1) + 1) for y in range(min(y0, y1), max(y0, y1) + 1)]
    if len(wanted) > args.max_tiles:
        print(f"terrain: level {chosen} would need {len(wanted)} tiles (over --max-tiles {args.max_tiles}); "
              "use a smaller --radius or --max-level", file=sys.stderr)
        return 1
    print(f"terrain: level {chosen}, {len(wanted)} tiles for {2 * radius:.0f} x {2 * radius:.0f} m")
    tiles = {}
    for i, (x, y) in enumerate(wanted, 1):
        raw = client.get_cached(layer.url(x, y, chosen), QM_ACCEPT)
        if raw:
            tiles[(x, y)] = decode_quantized_mesh(raw)
        print(f"\r  {i}/{len(wanted)} tiles", end="", flush=True)
    print()
    grid, cols, rows = resample(layer, tiles, chosen, lat0, lon0, radius, args.spacing)
    known = [h for h in grid if h is not None]
    if not known:
        print("terrain: the tiles cover none of the area", file=sys.stderr)
        return 1
    base_h = math.floor(min(known))
    packed = array("h", [-32768 if h is None else int(round((h - base_h) * 100)) for h in grid])
    if sys.byteorder != "little":
        packed.byteswap()
    out = {
        "_about": "Ground heights around the House of the Masks, from ARGUS's own terrain "
                  "(tools/fetch_argus_3d.py). Row by row from the north-west corner; height = base_m + value/100 "
                  "metres above the WGS84 ellipsoid; -32768 where no tile covered the point.",
        "source": urllib.parse.urljoin(base, "layer.json"),
        "fetched_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "level": chosen,
        "origin": {"lat": lat0, "lon": lon0},
        "spacing_m": args.spacing,
        "cols": cols,
        "rows": rows,
        "west_m": -radius,
        "north_m": radius,
        "base_m": base_h,
        "heights_cm_int16_b64": base64.b64encode(packed.tobytes()).decode("ascii"),
    }
    OUT_TERRAIN.parent.mkdir(parents=True, exist_ok=True)
    OUT_TERRAIN.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    cover = len(known) / len(grid)
    print(f"terrain: heights {min(known):.1f}-{max(known):.1f} m (ellipsoid), {cover:.0%} of the grid covered; "
          f"wrote {shown(OUT_TERRAIN)} ({OUT_TERRAIN.stat().st_size / 1024:.0f} KB)")
    print(f"terrain: {client.requests} requests, {client.bytes / 1e6:.1f} MB downloaded")
    return 0


# --------------------------------------------------------------------------- 3D Tiles (survey first)

def sphere_of(volume: Dict[str, Any], transform: List[float]) -> Optional[Tuple[Tuple[float, float, float], float]]:
    """Centre (ECEF) and radius of a 3D Tiles bounding volume (box, sphere or region)."""
    def apply(p):
        if not transform:
            return p
        m = transform  # column-major 4x4
        x, y, z = p
        return (m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])
    if "sphere" in volume:
        cx, cy, cz, r = volume["sphere"]
        return apply((cx, cy, cz)), r
    if "box" in volume:
        b = volume["box"]
        half = math.sqrt(sum((b[i] ** 2 + b[i + 1] ** 2 + b[i + 2] ** 2) for i in (3, 6, 9)))
        return apply((b[0], b[1], b[2])), half
    if "region" in volume:
        w, s, e, n, lo, hi = volume["region"]
        lat, lon = math.degrees((s + n) / 2), math.degrees((w + e) / 2)
        kx, ky = metres_per_degree(lat)
        r = math.hypot(math.degrees(e - w) * kx, math.degrees(n - s) * ky, hi - lo) / 2
        return lla_to_ecef(lat, lon, (lo + hi) / 2), r
    return None


def mat_mul(a: List[float], b: List[float]) -> List[float]:
    if not a:
        return b
    if not b:
        return a
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]


def walk(client: Client, url: str, node: Dict[str, Any], parent_tf: List[float], depth: int,
         house: Tuple[float, float, float], radius: float, out: List[Dict[str, Any]]) -> None:
    tf = mat_mul(parent_tf, node.get("transform") or [])
    sphere = sphere_of(node.get("boundingVolume", {}), tf)
    if sphere:
        (cx, cy, cz), r = sphere
        if math.dist((cx, cy, cz), house) > r + radius:
            return  # this branch does not touch the house
    content = node.get("content") or (node.get("contents") or [None])[0]
    if content:
        uri = urllib.parse.urljoin(url, content.get("uri") or content.get("url"))
        if urllib.parse.urlparse(uri).path.endswith(".json"):  # a nested tileset: small, read it
            nested = json.loads(client.get_cached(uri, "application/json") or b"{}")
            if nested.get("root"):
                walk(client, uri, nested["root"], tf, depth + 1, house, radius, out)
        else:
            out.append({"uri": uri, "depth": depth, "error": float(node.get("geometricError", 0)),
                        "radius": sphere[1] if sphere else None, "transform": tf})
    for child in node.get("children") or []:
        walk(client, url, child, tf, depth + 1, house, radius, out)


def run_model(client: Client, args: argparse.Namespace) -> int:
    url = client.url(args.tileset_path)
    tileset = json.loads(client.get_cached(url, "application/json") or b"{}")
    if not tileset.get("root"):
        print(f"model: no tileset at {url}", file=sys.stderr)
        return 1
    house = lla_to_ecef(HOUSE["lat"], HOUSE["lon"], HOUSE["height"])
    found: List[Dict[str, Any]] = []
    walk(client, url, tileset["root"], [], 0, house, args.model_radius, found)
    print(f"model: {tileset.get('asset', {}).get('version', '?')} tileset, "
          f"{len(found)} tiles with content touch the house (within {args.model_radius:.0f} m)")
    levels: Dict[float, List[Dict[str, Any]]] = {}
    for t in found:
        levels.setdefault(t["error"], []).append(t)
    kinds = sorted({Path(urllib.parse.urlparse(t["uri"]).path).suffix for t in found})
    print(f"model: content types {', '.join(kinds) or '-'}")
    if args.sizes:
        for t in found:
            t["bytes"] = client.size(t["uri"])
    print("  geometricError  tiles  size")
    for err in sorted(levels, reverse=True):
        ts = levels[err]
        total = sum(t.get("bytes") or 0 for t in ts)
        print(f"  {err:>12.3f} m  {len(ts):>5}  {total / 1e6:8.1f} MB" + ("" if args.sizes else " (sizes: --sizes)"))
    # The chosen level: the coarsest one at least as fine as --max-error (else the finest there is).
    fine_enough = [e for e in levels if e <= args.max_error]
    chosen = max(fine_enough) if fine_enough else min(levels) if levels else None
    if chosen is None:
        return 1
    picked = levels[chosen]
    print(f"model: chosen level geometricError {chosen} m, {len(picked)} tiles")
    if not args.download:
        print("model: nothing downloaded (add --download to take the chosen tiles)")
        return 0
    budget = min(args.budget_mb, HARD_LIMIT_MB) * 1e6
    taken = 0
    for i, t in enumerate(picked, 1):
        size = t.get("bytes") or client.size(t["uri"]) or 0
        if taken + size > budget:
            print(f"\nmodel: stopped at the budget ({budget / 1e6:.0f} MB); {len(picked) - i + 1} tiles left out")
            break
        body = client.get_cached(t["uri"])
        taken += len(body or b"")
        print(f"\r  {i}/{len(picked)} tiles, {taken / 1e6:.1f} MB", end="", flush=True)
    print()
    manifest = CACHE / "delos-masks-model.json"
    manifest.write_text(json.dumps({"tileset": url, "house": HOUSE, "geometric_error": chosen,
                                    "tiles": [t["uri"] for t in picked]}, indent=1), encoding="utf-8")
    print(f"model: kept in {shown(CACHE)}/ ({taken / 1e6:.1f} MB); list in {shown(manifest)}")
    if args.export:
        return export_model(client, url, picked)
    return 0


def split_b3dm(raw: bytes) -> Tuple[bytes, Optional[List[float]]]:
    """The glTF binary inside a Batched 3D Model tile, and its RTC_CENTER (ECEF) if it has one.
    A .glb tile (3D Tiles 1.1) is returned as it is."""
    if raw[:4] == b"glTF":
        return raw, None
    if raw[:4] != b"b3dm":
        raise ValueError("not a b3dm or glb tile")
    _, _, ft_json, ft_bin, bt_json, bt_bin = struct.unpack_from("<6I", raw, 4)
    feature = json.loads(raw[28:28 + ft_json].rstrip(b" \x00") or b"{}") if ft_json else {}
    start = 28 + ft_json + ft_bin + bt_json + bt_bin
    rtc = feature.get("RTC_CENTER")
    if isinstance(rtc, dict):  # stored in the binary part: three float32
        off = 28 + ft_json + rtc["byteOffset"]
        rtc = list(struct.unpack_from("<3f", raw, off))
    return raw[start:], rtc


def glb_summary(glb: bytes) -> Dict[str, Any]:
    """What a glTF binary holds: extensions, meshes, vertices, images (for choosing how to simplify)."""
    length, = struct.unpack_from("<I", glb, 12)
    doc = json.loads(glb[20:20 + length])
    positions = [p["attributes"]["POSITION"] for m in doc.get("meshes", []) for p in m.get("primitives", [])
                 if "POSITION" in p.get("attributes", {})]
    return {"extensions": sorted(set(doc.get("extensionsUsed", []))),
            "meshes": len(doc.get("meshes", [])),
            "vertices": sum(doc["accessors"][i]["count"] for i in positions),
            "images": [i.get("mimeType", "?") for i in doc.get("images", [])],
            "y_up": True}


def export_model(client: Client, tileset_url: str, picked: List[Dict[str, Any]]) -> int:
    """The chosen tiles as plain glTF binaries the game can load, with where each one goes:
    web/public/data/view3d/delos-masks-model/ and delos-masks-model.json."""
    out_dir = OUT_TERRAIN.parent / "delos-masks-model"
    out_dir.mkdir(parents=True, exist_ok=True)
    tiles, total = [], 0
    for k, t in enumerate(picked):
        raw = client.get_cached(t["uri"])
        if not raw:
            continue
        glb, rtc = split_b3dm(raw)
        name = f"{k:02d}.glb"
        (out_dir / name).write_bytes(glb)
        total += len(glb)
        tiles.append({"file": f"delos-masks-model/{name}", "transform": t["transform"] or None,
                      "rtc_center": rtc, "source": t["uri"], **glb_summary(glb)})
    manifest = {
        "_about": "ARGUS's own 3D model of the House of the Masks, the tiles around the house only "
                  "(tools/fetch_argus_3d.py model --download --export). Each glTF is y-up, as 3D Tiles stores it; "
                  "transform (column-major, may be null) and rtc_center (ECEF metres) place it on the Earth.",
        "source": tileset_url,
        "fetched_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "house": HOUSE,
        "tiles": tiles,
    }
    path = OUT_TERRAIN.parent / "delos-masks-model.json"
    path.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    ext = sorted({e for t in tiles for e in t["extensions"]})
    verts = sum(t["vertices"] for t in tiles)
    print(f"model: exported {len(tiles)} glTF files ({total / 1e6:.1f} MB, {verts} vertices"
          f"{', extensions ' + ', '.join(ext) if ext else ''}) to {shown(out_dir)}/ and {shown(path)}")
    return 0


def main(argv=None) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("what", choices=["terrain", "model"])
    p.add_argument("--base", default=BASE, help="the ARGUS server (default %(default)s)")
    p.add_argument("--allow-host", action="append", default=[], help=argparse.SUPPRESS)
    p.add_argument("--delay", type=float, default=0.3, help="seconds between requests (default 0.3)")
    p.add_argument("--terrain-path", default=TERRAIN_PATH)
    p.add_argument("--radius", type=float, default=250.0, help="terrain: metres around the house (default 250)")
    p.add_argument("--spacing", type=float, default=2.0, help="terrain: grid spacing in metres (default 2)")
    p.add_argument("--max-level", type=int, default=22)
    p.add_argument("--max-tiles", type=int, default=400)
    p.add_argument("--tileset-path", default=TILESET_PATH)
    p.add_argument("--model-radius", type=float, default=30.0, help="model: metres around the house (default 30)")
    p.add_argument("--max-error", type=float, default=0.5, help="model: level of detail, metres (default 0.5)")
    p.add_argument("--sizes", action="store_true", help="model: ask each tile's size (one HEAD request each)")
    p.add_argument("--download", action="store_true", help="model: download the chosen tiles")
    p.add_argument("--export", action="store_true", help="model: with --download, write them as glTF for the game")
    p.add_argument("--budget-mb", type=float, default=300.0, help=f"model: at most this much (max {HARD_LIMIT_MB})")
    args = p.parse_args(argv)
    client = Client(args.base, args.delay, args.allow_host)
    return run_terrain(client, args) if args.what == "terrain" else run_model(client, args)


if __name__ == "__main__":
    sys.exit(main())
