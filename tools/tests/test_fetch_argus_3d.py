"""tools/fetch_argus_3d.py against a local copy of an ARGUS-like server (no internet).

The server holds quantized-mesh terrain tiles drawn from a known surface, and a small 3D Tiles
tileset with tiles near and far from the house. The tool must give back the surface's heights, take
only the tiles around the house, never leave the server's host, and download nothing in a survey.
"""
import base64
import http.server
import json
import math
import shutil
import struct
import tempfile
import threading
import unittest
from array import array
from pathlib import Path

import fetch_argus_3d as f

HOUSE = f.HOUSE


def surface(lat: float, lon: float) -> float:
    """A gentle slope with a bump: metres above the ellipsoid."""
    kx, ky = f.metres_per_degree(HOUSE["lat"])
    x, y = (lon - HOUSE["lon"]) * kx, (lat - HOUSE["lat"]) * ky
    return 40.0 + 0.05 * x - 0.02 * y + 3.0 * math.exp(-(x * x + y * y) / 2000.0)


def zigzag_deltas(values):
    out, prev = [], 0
    for v in values:
        d = v - prev
        out.append((d << 1) ^ (d >> 31) if d >= 0 else ((-d) << 1) - 1)
        prev = v
    return out


def encode_tile(layer, x, y, z, n=17) -> bytes:
    """A quantized-mesh-1.0 tile: an n x n grid of vertices on `surface`."""
    west, south, east, north = layer.bounds(x, y, z)
    us, vs, hs = [], [], []
    for j in range(n):
        for i in range(n):
            u, v = round(i * 32767 / (n - 1)), round(j * 32767 / (n - 1))
            us.append(u)
            vs.append(v)
            hs.append(surface(south + (north - south) * v / 32767, west + (east - west) * u / 32767))
    tris = []
    for j in range(n - 1):
        for i in range(n - 1):
            a, b, c, d = j * n + i, j * n + i + 1, (j + 1) * n + i, (j + 1) * n + i + 1
            tris += [a, b, d, a, d, c]
    # Vertices in the order the triangles first use them, as the high-water-mark encoding needs.
    order = list(dict.fromkeys(tris))
    new = {old: k for k, old in enumerate(order)}
    us, vs, hs = [us[o] for o in order], [vs[o] for o in order], [hs[o] for o in order]
    tris = [new[t] for t in tris]
    hmin, hmax = min(hs), max(hs)
    hq = [round((h - hmin) / (hmax - hmin) * 32767) for h in hs]
    codes, highest = [], 0  # high-water-mark encoding
    for idx in tris:
        codes.append(highest - idx)
        if idx == highest:
            highest += 1
    header = struct.pack("<3d2f4d3d", 0, 0, 0, hmin, hmax, 0, 0, 0, 1, 0, 0, 0)
    body = struct.pack("<I", n * n)
    for arr in (us, vs, hq):
        body += struct.pack(f"<{len(arr)}H", *zigzag_deltas(arr))
    body += struct.pack("<I", len(tris) // 3) + struct.pack(f"<{len(codes)}H", *codes)
    body += struct.pack("<I", 0) * 4  # no edge indices
    return header + body


class Server:
    def __init__(self, files):
        self.files = files
        self.seen = []
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _serve(self, body_too):
                path = self.path.split("?")[0]
                outer.seen.append((self.command, path))
                body = outer.files.get(path)
                if body is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if body_too:
                    self.wfile.write(body)

            def do_GET(self):
                self._serve(True)

            def do_HEAD(self):
                self._serve(False)

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.httpd.server_port}"

    def close(self):
        self.httpd.shutdown()


class FetchArgus3d(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.old = (f.CACHE, f.OUT_TERRAIN)
        f.CACHE = self.tmp / "cache"
        f.OUT_TERRAIN = self.tmp / "out" / "terrain.json"
        meta = {"tilejson": "2.1.0", "format": "quantized-mesh-1.0", "scheme": "tms", "projection": "EPSG:4326",
                "tiles": ["{z}/{x}/{y}.terrain?v={version}"], "version": "1.0.0", "maxzoom": 17}
        layer = f.TerrainLayer(meta, "")
        files = {"/robots.txt": b"User-agent: *\nDisallow: /private/\n",
                 "/terrain/delos/layer.json": json.dumps(meta).encode()}
        # level 17 exists only around the house; level 16 everywhere nearby
        for z in (16, 17):
            cx, cy = layer.tile_of(HOUSE["lon"], HOUSE["lat"], z)
            for x in range(cx - 3, cx + 4):
                for y in range(cy - 3, cy + 4):
                    files[f"/terrain/delos/{z}/{x}/{y}.terrain"] = encode_tile(layer, x, y, z)
        house = f.lla_to_ecef(HOUSE["lat"], HOUSE["lon"], HOUSE["height"])
        far = f.lla_to_ecef(HOUSE["lat"] + 0.01, HOUSE["lon"], HOUSE["height"])
        tileset = {"asset": {"version": "1.0"}, "geometricError": 50, "root": {
            "boundingVolume": {"sphere": [*house, 2000]}, "geometricError": 20,
            "content": {"uri": "root.b3dm"},
            "children": [
                {"boundingVolume": {"sphere": [*house, 20]}, "geometricError": 2, "content": {"uri": "near_lo.b3dm"},
                 "children": [{"boundingVolume": {"sphere": [*house, 10]}, "geometricError": 0.25,
                               "content": {"uri": "sub/near.json"}}]},
                {"boundingVolume": {"sphere": [*far, 20]}, "geometricError": 2, "content": {"uri": "far.b3dm"}},
            ]}}
        nested = {"asset": {"version": "1.0"}, "geometricError": 0.25, "root": {
            "boundingVolume": {"sphere": [*house, 10]}, "geometricError": 0.25, "content": {"uri": "near_hi.b3dm"}}}
        files["/tiles/delos/house-of-masks/tileset.json"] = json.dumps(tileset).encode()
        files["/tiles/delos/house-of-masks/sub/near.json"] = json.dumps(nested).encode()
        for name in ("root", "near_lo", "far"):
            files[f"/tiles/delos/house-of-masks/{name}.b3dm"] = b"b3dm" + bytes(1000)
        files["/tiles/delos/house-of-masks/sub/near_hi.b3dm"] = b"b3dm" + bytes(5000)
        self.server = Server(files)

    def tearDown(self):
        self.server.close()
        f.CACHE, f.OUT_TERRAIN = self.old
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_tool(self, *args):
        return f.main([*args, "--base", self.server.base, "--delay", "0"])

    def test_terrain_heights_come_back_and_only_nearby_tiles_are_read(self):
        self.assertEqual(self.run_tool("terrain", "--radius", "120", "--spacing", "4"), 0)
        out = json.loads(f.OUT_TERRAIN.read_text())
        self.assertEqual(out["level"], 17)
        raw = array("h", base64.b64decode(out["heights_cm_int16_b64"]))
        n = out["cols"]
        self.assertEqual(len(raw), n * out["rows"])
        kx, ky = f.metres_per_degree(HOUSE["lat"])
        worst = 0.0
        for r in range(0, n, 5):
            for c in range(0, n, 5):
                v = raw[r * n + c]
                self.assertNotEqual(v, -32768, "every grid point covered")
                x, y = out["west_m"] + c * out["spacing_m"], out["north_m"] - r * out["spacing_m"]
                expect = surface(HOUSE["lat"] + y / ky, HOUSE["lon"] + x / kx)
                worst = max(worst, abs(out["base_m"] + v / 100 - expect))
        self.assertLess(worst, 0.15, "heights within 15 cm of the surface")
        tiles = [p for m, p in self.server.seen if p.endswith(".terrain")]
        self.assertLessEqual(len(set(tiles)), 9, "only the tiles around the house")
        # a second run reads the cache, not the server
        before = len(self.server.seen)
        self.run_tool("terrain", "--radius", "120", "--spacing", "4")
        self.assertEqual([p for _, p in self.server.seen[before:] if p.endswith(".terrain")], [])

    def test_model_survey_downloads_no_tile_content(self):
        self.assertEqual(self.run_tool("model", "--sizes"), 0)
        got = [p for m, p in self.server.seen if m == "GET" and p.endswith(".b3dm")]
        self.assertEqual(got, [], "a survey downloads no model content")

    def test_model_download_takes_only_the_house_at_the_chosen_detail(self):
        self.assertEqual(self.run_tool("model", "--download", "--max-error", "0.5"), 0)
        got = sorted(p for m, p in self.server.seen if m == "GET" and p.endswith(".b3dm"))
        self.assertEqual(got, ["/tiles/delos/house-of-masks/sub/near_hi.b3dm"])
        manifest = json.loads((f.CACHE / "delos-masks-model.json").read_text())
        self.assertEqual(len(manifest["tiles"]), 1)

    def test_never_leaves_the_server(self):
        with self.assertRaises(SystemExit):
            f.Client(self.server.base, 0, []).get("https://example.com/x")
        with self.assertRaises(SystemExit):
            f.Client(self.server.base, 0, []).get(self.server.base + "/private/x")


class RealTile(unittest.TestCase):
    """The tile a team member saved from ARGUS's Delos terrain decodes (when it is on this computer)."""

    def test_decodes(self):
        sample = Path(__file__).parent / "data" / "argus_delos_tile.terrain"
        if not sample.exists():
            self.skipTest("no sample tile")
        mesh = f.decode_quantized_mesh(sample.read_bytes())
        self.assertEqual(len(mesh["tri"]) % 3, 0)
        self.assertTrue(all(0 <= i < len(mesh["u"]) for i in mesh["tri"]))
        self.assertTrue(all(mesh["hmin"] - 0.01 <= h <= mesh["hmax"] + 0.01 for h in mesh["h"]))


if __name__ == "__main__":
    unittest.main()
