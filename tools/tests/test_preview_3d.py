"""Tests for the 3D view's data (tools/build_preview_3d.py -> web/public/data/view3d/delos-masks.json).

Run from the repo root:  python3 -I -m unittest discover -s tools/tests -t tools -v
"""
import json
import re
import unittest

import build_preview_3d as p

SNAPSHOT_OK = p.MONITORINGS.exists() and p.INSTRUMENTS.exists()


def inside(point, ring):
    x, y = point
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


@unittest.skipUnless(SNAPSHOT_OK, "snapshot/ not present")
class Preview3D(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = p.build()
        cls.ruin = next(s for s in cls.data["shapes"] if s["kind"] == "ruin")["ring"]

    def test_the_four_mosaic_rooms_come_from_argus(self):
        rooms = {r["room"]: r["name"] for r in self.data["rooms"]}
        self.assertEqual(rooms, {"214": "Dionysus mosaic", "215": "Theatrical Masks mosaic", "216": "Seilinos mosaic", "217": "Dolphins mosaic"})
        # ARGUS's placements and OpenStreetMap's outline agree: three rooms inside the ruin, 214 on its edge
        for r in self.data["rooms"]:
            if r["room"] != "214":
                self.assertTrue(inside(r["xy"], self.ruin), r["room"])

    def test_sensors_have_argus_heights(self):
        found = self.data["sensors3d"]
        self.assertGreaterEqual(len(found), 19)
        soil = [s for s in found if s["kind"] == "soil_moisture" and s["room"] == "215"]
        self.assertEqual(len(soil), 2)  # the two probes under the Theatrical Masks mosaic
        self.assertTrue(all(0 < s["h"] < 3 for s in found))

    def test_origin_is_argus_own_placement_of_the_house(self):
        text = (p.ROOT / "snapshot" / "asset-states.json").read_text(encoding="utf-8")
        q = r"""\\?["']"""  # the placement sits in JSON inside JSON (escaped quotes) or in a Python-style dict
        m = re.search(rf"{q}delos-masks{q}: \{{[^}}]*?{q}position{q}: \{{{q}longitude{q}: ([\d.]+), {q}latitude{q}: ([\d.]+), {q}height{q}: ([\d.]+)", text)
        self.assertIsNotNone(m)
        self.assertEqual((float(m.group(2)), float(m.group(1)), float(m.group(3))), (p.ORIGIN["lat"], p.ORIGIN["lon"], p.ORIGIN["height"]))

    def test_dangers_are_the_houses_argus_scenarios(self):
        titles = [d["title"]["en"] for d in self.data["dangers"]]
        self.assertTrue(all(t.endswith("House of the Masks") for t in titles))
        self.assertIn("Water rising from below · House of the Masks", titles)
        levels = [p.LEVELS.index(d["level"]) for d in self.data["dangers"]]
        self.assertEqual(levels, sorted(levels, reverse=True))

    def test_photos_are_free_and_credited(self):
        for room, photo in p.PHOTOS.items():
            self.assertIn(photo["license"], ("Public domain", "CC BY 3.0", "CC BY-SA 3.0", "CC BY-SA 4.0", "CC BY 4.0"), room)
            self.assertTrue(photo["author"] and photo["page"].startswith("https://commons.wikimedia.org/wiki/File:"), room)

    def test_written_file_is_up_to_date(self):
        on_disk = json.loads(p.OUT.read_text(encoding="utf-8"))
        for key in ("origin", "base_height", "shapes", "sensors3d", "rooms", "credits"):
            self.assertEqual(on_disk[key], json.loads(json.dumps(self.data[key])), f"{key}: rerun python3 -I tools/build_preview_3d.py")
        self.assertEqual([d["key"] for d in on_disk["dangers"]], [d["key"] for d in self.data["dangers"]])


if __name__ == "__main__":
    unittest.main()
