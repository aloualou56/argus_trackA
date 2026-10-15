"""tools/build_scenes_3d.py: the game's 3D scenes from ARGUS's own placements (no internet)."""
import json
import unittest

import build_scenes_3d as b


class Scenes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = b.build()
        cls.scenes = {s["id"]: s for s in cls.data["scenes"]}

    def test_one_scene_per_placement_of_every_monument(self):
        self.assertEqual(set(self.scenes), {"baltanas", "delos-fournoi", "delos-masks", "lucretili-conventillo",
                                            "lucretili-montefalco", "lucretili-villa-orazio", "ranverso", "schenkenberg"})

    def test_each_place_has_its_own_model(self):
        models = {sid: [t["id"] for t in s["tilesets"]] for sid, s in self.scenes.items()}
        self.assertEqual(models["delos-masks"], ["delos-house-of-masks-3d-tiles"])
        self.assertEqual(models["delos-fournoi"], ["delos-fournoi-3d-tiles"])
        self.assertEqual(models["lucretili-montefalco"], ["lucretili-montefalco-3d-tiles"])
        self.assertEqual(models["lucretili-villa-orazio"], ["lucretili-italy-3d-tiles"])  # "Conventillo / Villa di Orazio"

    def test_sensors_belong_to_the_place_they_are_at(self):
        masks = self.scenes["delos-masks"]
        # Delos's tiltmeters in other districts are at neither house
        self.assertTrue(all(abs(x["xy"][0]) < b.NEAR and abs(x["xy"][1]) < b.NEAR for x in masks["sensors"]))
        self.assertNotIn("tiltmeter", {x["kind"] for x in masks["sensors"]})
        self.assertLessEqual(masks["radius"], 60)
        tower = {x["where"] for x in self.scenes["schenkenberg"]["sensors"]}
        self.assertIn("Schenkenberg tower - North wall", tower)
        # serial numbers, by which the game finds an alarm's sensor
        self.assertIn("149368", {x["serial"] for x in masks["sensors"]})

    def test_scene_file_has_the_place_s_dangers(self):
        game = json.loads(b.GAME_DATA.read_text(encoding="utf-8"))
        f = b.scene_file(self.scenes["lucretili-montefalco"], game)
        self.assertTrue(f["dangers"])
        self.assertTrue(all(d["key"].startswith("lucretili-montefalco.") for d in f["dangers"]))
        self.assertEqual(f["shapes"], [])  # ARGUS's model is its walls
        self.assertTrue(all("alt" in x for x in f["sensors3d"]))

    def test_serial(self):
        self.assertEqual(b.serial("Installed Instrument Crackmeter - 149796"), "149796")
        self.assertEqual(b.serial("Installed Instrument Water pottential - WP1-130432 (Cellar 88 - Paso1)"), "WP1-130432")
        self.assertIsNone(b.serial("Rain gauge"))


if __name__ == "__main__":
    unittest.main()
