"""Tests for the generated data pack (web/public/data/game_data.json).

Run from the repo root:  python3 -I -m unittest discover -s tools/tests -t tools -v
"""
import json
import re
import unittest

import build_game_data as b

SNAPSHOT_OK = (b.SNAPSHOT_DIR / "threats.json").exists()


@unittest.skipUnless(SNAPSHOT_OK, "snapshot/ not present")
class GameData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        before = {p.name: p.stat().st_mtime_ns for p in b.SNAPSHOT_DIR.glob("*.json")}
        cls.data, cls.notes = b.build()
        after = {p.name: p.stat().st_mtime_ns for p in b.SNAPSHOT_DIR.glob("*.json")}
        cls.snapshot_untouched = before == after
        cls.ranverso = next(m for m in cls.data["monuments"] if m["pilot_key"] == "ranverso")
        cls.card_ids = {c["id"] for c in cls.data["cards"]["cards"]}

    def test_snapshot_is_read_only(self):
        self.assertTrue(self.snapshot_untouched)

    def test_written_file_is_up_to_date(self):
        on_disk = json.loads(b.OUT_JSON.read_text(encoding="utf-8"))
        self.assertEqual(on_disk, json.loads(json.dumps(self.data)),
                         "game_data.json is stale: rerun python3 -I tools/build_game_data.py")

    def test_build_is_deterministic(self):
        again, notes = b.build()
        self.assertEqual(again, self.data)
        self.assertEqual(notes, self.notes)

    def test_small_enough_for_the_browser(self):
        size = len(json.dumps(self.data, ensure_ascii=False).encode("utf-8"))
        self.assertLess(size, 200 * 1024)

    def test_no_secrets_or_api_hosts(self):
        text = json.dumps(self.data, ensure_ascii=False) + self.notes
        self.assertIsNone(re.search(r"(?i)bearer\s|authorization|api[_-]?key|password|token", text))

    def test_five_monuments_one_playable(self):
        self.assertEqual([m["asset_id"] for m in self.data["monuments"]], [26, 27, 28, 29, 30])
        self.assertEqual([m["pilot_key"] for m in self.data["monuments"] if m["playable"]], ["ranverso"])

    def test_ranverso_scenarios(self):
        scenarios = self.ranverso["scenarios"]
        self.assertEqual(len(scenarios), 26)
        for s in scenarios:
            self.assertTrue(s["plain"]["authored"])
            for lang in ("en", "el"):
                self.assertTrue(s["plain"]["title"][lang])
                self.assertTrue(s["plain"]["text"][lang])
            self.assertTrue(set(s["capable_cards"]) <= self.card_ids)

    def test_ranverso_levels(self):
        levels = {lv["id"]: lv for lv in self.ranverso["levels"]}
        self.assertEqual(list(levels), ["low", "medium", "high", "extreme", "catastrophic"])
        self.assertFalse(levels["catastrophic"]["available"])
        keys = {s["scenario_key"]: s for s in self.ranverso["scenarios"]}
        alarm_ids = {a["id"] for a in self.ranverso["alarms"]}
        for lv in levels.values():
            if not lv["available"]:
                continue
            self.assertEqual(len(lv["mission"]), self.data["mission_size"])
            self.assertEqual(len(set(lv["mission"])), len(lv["mission"]))
            for key in lv["mission"]:
                self.assertTrue(keys[key]["capable_cards"], key)
            self.assertIn(lv["featured_alarm"], alarm_ids)

    def test_extreme_mission_starts_with_the_story_hook(self):
        extreme = next(lv for lv in self.ranverso["levels"] if lv["id"] == "extreme")
        self.assertEqual(extreme["mission"][0], self.ranverso["story"]["hook_scenario"])

    def test_ranverso_installed_mix(self):
        inst = self.ranverso["installed"]
        self.assertEqual(inst["records"], 26)
        self.assertEqual(inst["distinct_instruments"], 20)
        self.assertEqual(inst["physical_instruments"], 19)
        self.assertEqual(sum(r["count"] for r in inst["by_card"]) + sum(o["count"] for o in inst["other"]), 20)
        self.assertEqual(len(inst["duplicate_records"]), 6)
        mix = {r["card"]: r["count"] for r in inst["by_card"]}
        self.assertEqual(mix["humidity"], 3)
        self.assertNotIn("crackmeter", mix)

    def test_ranverso_alarms_are_plausible(self):
        alarms = self.ranverso["alarms"]
        self.assertGreaterEqual(len(alarms), 5)
        self.assertLessEqual(len(alarms), 10)
        rule_map = self.data["rule_sensor_map"]
        for a in alarms:
            self.assertEqual(a["type"], "EK")
            self.assertNotEqual(a["rule"], "R1_hum_inside")
            self.assertIn(f"ranverso:{a['rule']}", rule_map)
            self.assertTrue(a["instruments"], a["id"])
            self.assertTrue(a["context"]["why"]["en"] and a["context"]["why"]["el"])
            self.assertTrue(a["event_ids"])
            card = rule_map[f"ranverso:{a['rule']}"]["detect_with"][0][0]
            lo, hi = b.PLAUSIBLE_RANGES.get(card, (float("-inf"), float("inf")))
            self.assertTrue(lo <= a["value"] <= hi, a["id"])
            self.assertNotEqual(a["value"], 0)
            self.assertTrue(a["timestamp"].startswith("2026-0"))

    def test_alarm_funnel_numbers(self):
        funnel = self.ranverso["alarm_funnel"]
        self.assertEqual(funnel["records"], 92)
        self.assertLess(funnel["unique"], funnel["records"])
        self.assertEqual(funnel["by_rule"]["R1_hum_inside"], 39)

    def test_rule_map_covers_requested_examples(self):
        rule_map = self.data["rule_sensor_map"]
        expected = {
            "ranverso:R1_hum_inside": "humidity",
            "ranverso:R4b_soil_low": "soil_moisture",
            "schenkenberg:R2_crack_step": "crackmeter",
            "lucretili:R2a_tilt_step": "tiltmeter",
            "lucretili:R9a_temp_lt": "temperature",
        }
        for key, card in expected.items():
            self.assertIn(card, rule_map[key]["detect_with"][0], key)

    def test_rule_map_cards_exist(self):
        for key, entry in self.data["rule_sensor_map"].items():
            for group in entry["detect_with"]:
                self.assertTrue(group, key)
                self.assertTrue(set(group) <= self.card_ids, key)

    def test_cards_are_bilingual_and_priced(self):
        for card in self.data["cards"]["cards"]:
            self.assertGreater(card["cost"], 0)
            for field in ("name", "tells"):
                self.assertTrue(card[field]["en"] and card[field]["el"], card["id"])

    def test_map_data(self):
        self.assertIn(self.data["basemaps"]["default"], [l["id"] for l in self.data["basemaps"]["layers"]])
        for layer in self.data["basemaps"]["layers"]:
            self.assertTrue(layer["attribution"])
            if layer.get("type") == "vector":
                self.assertTrue(self.data["basemaps"]["world"])
            else:
                self.assertTrue(layer["url"].startswith("https://"))
        for mon in self.data["monuments"]:
            self.assertIsNotNone(mon["map"], mon["pilot_key"])
            (south, west), (north, east) = mon["map"]["bounds"]
            lat, lon = mon["map"]["center"]
            self.assertTrue(south <= lat <= north and west <= lon <= east, mon["pilot_key"])

    def test_ranverso_sensor_positions(self):
        inst = self.ranverso["installed"]
        placed = sum(len(p["instruments"]) for p in inst["points"])
        self.assertEqual(len(inst["points"]), 11)
        self.assertEqual(placed + len(inst["unplaced"]), inst["distinct_instruments"])
        self.assertEqual([u["card"] for u in inst["unplaced"]], ["satellite"])
        for point in inst["points"]:
            self.assertAlmostEqual(point["lat"], 45.0812, places=3)
            self.assertAlmostEqual(point["lon"], 7.4497, places=3)
        flagged = [p for p in inst["points"] if "temporary_position" in p["flags"]]
        self.assertEqual([i["card"] for p in flagged for i in p["instruments"]], ["weather_station"])

    def test_plan_backdrops(self):
        """The drawn plan (used offline or when map pictures are blocked) ships with the game."""
        web_public = b.OUT_JSON.parent.parent
        for rel in (self.data["basemaps"]["world"], self.ranverso["backdrop"]):
            collection = json.loads((web_public / rel).read_text(encoding="utf-8"))
            self.assertEqual(collection["type"], "FeatureCollection")
            self.assertTrue(collection["attribution"])
            self.assertTrue(collection["features"])
        osm = json.loads((web_public / self.ranverso["backdrop"]).read_text(encoding="utf-8"))
        church = [f for f in osm["features"] if f["properties"]["kind"] == "heritage"]
        self.assertEqual([f["geometry"]["type"] for f in church], ["Polygon"])
        lon, lat = zip(*church[0]["geometry"]["coordinates"][0])
        centre = self.ranverso["map"]["center"]
        self.assertTrue(min(lat) - 0.001 < centre[0] < max(lat) + 0.001 and min(lon) - 0.001 < centre[1] < max(lon) + 0.001)

    def test_alarm_sensors_have_positions(self):
        for alarm in self.ranverso["alarms"]:
            for instrument in alarm["instruments"]:
                self.assertIsNotNone(instrument["lat"], alarm["id"])
                self.assertIsNotNone(instrument["lon"], alarm["id"])

    def test_notes_list_assumptions(self):
        self.assertIn("## Assumptions needing human review", self.notes)
        self.assertIn("## Data quirks found", self.notes)


class PureHelpers(unittest.TestCase):
    def test_parse_metadata(self):
        self.assertEqual(b.parse_metadata({"metadata": '{"a": 1}'}), {"a": 1})
        self.assertEqual(b.parse_metadata({"metadata": None}), {})
        self.assertEqual(b.parse_metadata({"metadata": {"a": 2}}), {"a": 2})
        self.assertEqual(b.parse_metadata({"metadata": "not json"}), {"_unparsed": "not json"})

    def test_node_token(self):
        self.assertEqual(b.node_token("Installed Instrument Rain Gauge - 177315"), "177315")
        self.assertEqual(b.node_token("Installed Instrument Soil Moisture - A8610A333526680F"), "a8610a333526680f")
        name = "Installed Instrument Crackmeter - 177266 (Conventillo - Staircase access façade)"
        self.assertEqual(b.node_token(name), "177266")
        self.assertEqual(b.place_label(name), "Conventillo - Staircase access façade")
        self.assertIsNone(b.place_label("Installed Instrument Rain Gauge - 177315"))

    def test_auto_mission_fills_from_lower_level(self):
        def s(key, label, mr, cards=("humidity",), desc=None):
            return {"scenario_key": key, "priority_label": label, "abc": {"mr": mr},
                    "capable_cards": list(cards), "description": desc or key}
        scenarios = [s("x1", "Extreme priority", 14), s("x2", "Extreme priority", 13),
                     s("h1", "High priority", 11), s("h2", "High priority", 10, cards=()),
                     s("h3", "High priority", 9, desc="h1")]
        self.assertEqual(b.pick_mission_auto(scenarios, "Extreme priority"), ["x1", "x2", "h1"])
        # h2 has no capable card and h3 repeats h1's description, so High borrows from Extreme
        self.assertEqual(b.pick_mission_auto(scenarios, "High priority"), ["h1", "x1", "x2"])


if __name__ == "__main__":
    unittest.main()


class ContentRules(unittest.TestCase):
    """Checks on content/ that need no snapshot."""

    @classmethod
    def setUpClass(cls):
        cls.content = b.Content(b.load_content(b.CONTENT_DIR))

    def test_threat_map_primary_cards(self):
        card_ids = set(self.content.card_ids)
        for section in (self.content.threat_categories, self.content.threat_scenarios):
            for key, entry in section.items():
                self.assertTrue(set(entry["primary"]) <= set(entry["cards"]) <= card_ids, key)
                self.assertEqual(bool(entry["primary"]), bool(entry["cards"]), key)

    def test_human_cards_never_detect_alarms(self):
        human = {c["id"] for c in self.content.cards if c.get("kind") == "human"}
        self.assertEqual(human, {"observer"})
        for key, entry in self.content.rules.items():
            for group in entry["detect_with"]:
                self.assertFalse(set(group) & human, key)

    def test_flat_signal_alarms_are_never_replayed(self):
        flat = {"id": "flat", "rule": "R4b_soil_low", "roles": ["first", "peak", "last"],
                "quality_flags": ["flat_signal"], "times_threshold": 2.0}
        rain = {"id": "rain", "rule": "R2_rain_7d", "roles": ["peak"], "quality_flags": [], "times_threshold": 4.8}
        self.assertEqual(b.resolve_featured([flat, rain], {"rule": "R4b_soil_low", "pick": "peak"}), "rain")
        self.assertIsNone(b.resolve_featured([flat], {"rule": "R4b_soil_low", "pick": "peak"}))
        self.assertEqual(b.resolve_featured([flat, rain], {"rule": "R2_rain_7d", "pick": "peak"}), "rain")
