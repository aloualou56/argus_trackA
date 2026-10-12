"""Sanity tests: the facts the game relies on, checked against the ARGUS snapshot.

Run from the repo root:  python3 -I -m unittest discover -s tools/tests -t tools -v
"""
import collections
import unittest

import build_game_data as b

# These are the facts verified on the first snapshot (11 Oct 2026); newer fetches add records.
SNAPSHOT = b.ORIGINAL_SNAPSHOT
SNAPSHOT_OK = (SNAPSHOT / "threats.json").exists()


@unittest.skipUnless(SNAPSHOT_OK, "snapshot/ not present")
class SnapshotFacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snap = b.Snapshot(b.load_snapshot(SNAPSHOT))

    def test_five_monuments(self):
        got = {a["id"]: (a["name"], self.snap.asset_meta[a["id"]]["country"]) for a in self.snap.assets}
        self.assertEqual(got, {
            26: ("Delos Island", "Greece"),
            27: ("Cellar Town of Baltanás", "Spain"),
            28: ("Monti Lucretili", "Italy"),
            29: ("Sant’Antonio di Ranverso Preceptory", "Italy"),
            30: ("Schenkenberg Castle", "Switzerland"),
        })

    def test_pilot_keys_map_to_assets(self):
        got = {p: a["id"] for p, a in self.snap.pilot_to_asset.items()}
        self.assertEqual(got, {"delos": 26, "baltanas": 27, "lucretili": 28, "ranverso": 29, "schenkenberg": 30})

    def test_threat_counts(self):
        self.assertEqual(len(self.snap.threats), 156)
        self.assertEqual(len(self.snap.scenarios), 99)
        labels = collections.Counter(m["abc"]["priority_label"] for _, m in self.snap.scenarios)
        self.assertEqual(labels, {"Low priority": 30, "Medium priority": 20, "High priority": 16,
                                  "Extreme priority": 23, "Catastrophic priority": 10})
        pilots = collections.Counter(m["pilot_key"] for _, m in self.snap.scenarios)
        self.assertEqual(pilots["ranverso"], 26)

    def test_scenario_fields(self):
        for _, m in self.snap.scenarios:
            for key in ("scenario_key", "pilot_key", "risk_category", "heritage_asset", "abc", "source"):
                self.assertIn(key, m)
            for key in ("a", "b", "c", "mr", "priority_label"):
                self.assertIn(key, m["abc"])

    def test_test_record_is_ignored(self):
        names = [t["name"] for t in self.snap.threats]
        self.assertIn("Katastrofh", names)
        self.assertNotIn("Katastrofh", [t["name"] for t, _ in self.snap.scenarios])

    def test_ranverso_has_no_catastrophic_scenario(self):
        labels = collections.Counter(m["abc"]["priority_label"] for _, m in self.snap.scenarios
                                     if m["pilot_key"] == "ranverso")
        self.assertEqual(labels, {"Low priority": 14, "Medium priority": 7, "High priority": 3, "Extreme priority": 2})

    def test_event_sample(self):
        raw = self.snap.raw["events"]
        self.assertEqual(raw["count"], 750)
        self.assertFalse(raw["complete"])
        kinds = collections.Counter(b.parse_metadata(e).get("kind") for e in self.snap.events)
        self.assertEqual(kinds, {"ad_rt_event": 304, "ira_evaluation_event": 436, "eop_completion_event": 10})

    def test_alarm_fields_and_dates(self):
        for _, m in self.snap.alarms:
            alarm = m["alarm"]
            for key in ("type", "score", "is_alarm", "site", "timestamp"):
                self.assertIn(key, alarm)
            self.assertIn(alarm["type"], ("EK", "DL"))
            if alarm["type"] == "EK":
                for key in ("rule", "metric", "threat_name", "policy_name", "variables"):
                    self.assertIn(key, alarm)
        stamps = sorted(m["alarm"]["timestamp"] for _, m in self.snap.alarms)
        self.assertTrue(stamps[0].startswith("2026-08-28"))
        self.assertTrue(stamps[-1].startswith("2026-09-24"))

    def test_alarms_per_site(self):
        sites = collections.Counter(m["alarm"]["site"] for _, m in self.snap.alarms)
        self.assertEqual(sites["ranverso"], 92)
        self.assertEqual(sum(sites.values()), 304)

    def test_delos_and_baltanas_alarms_are_dl_only(self):
        for _, m in self.snap.alarms:
            if m["alarm"]["site"] in ("delos", "baltanas"):
                self.assertEqual(m["alarm"]["type"], "DL")
                self.assertFalse(m["alarm"].get("rule"))

    def test_humidity_quirk(self):
        values = [v["value"] for _, m in self.snap.alarms for v in (m["alarm"].get("variables") or [])
                  if "hum" in v["name"].lower()]
        self.assertEqual(len(values), 61)
        self.assertEqual(sum(1 for v in values if v > 100), 39)

    def test_installed_instruments_per_monument(self):
        per = {a["id"]: len(self.snap.instrument_rows(a["id"])) for a in self.snap.assets}
        self.assertEqual(per, {29: 26, 27: 39, 26: 30, 28: 19, 30: 9})
        self.assertEqual(sum(per.values()), 123)

    def test_ranverso_distinct_instruments(self):
        rows = self.snap.instrument_rows(29)
        self.assertEqual(len({r["instrument_id"] for r in rows}), 20)

    def test_lucretili_has_seven_crackmeters(self):
        rows = self.snap.instrument_rows(28)
        self.assertEqual(sum(1 for r in rows if r["instrument_type"] == "Crackmeter Sensor"), 7)

    def test_instrument_types(self):
        names = [t["name"] for t in self.snap.instrument_types.values()]
        self.assertEqual(len(names), 40)
        self.assertIn("Humidity Sensor", names)

    def test_policies(self):
        self.assertEqual(len(self.snap.policies), 181)
        self.assertEqual(len(self.snap.ad_rt_policies), 37)
        for _, m in self.snap.ad_rt_policies:
            for key in ("rule", "threat_name", "description", "threshold_overrides", "pilot"):
                self.assertIn(key, m)

    def test_rule_names_are_not_global(self):
        """Same rule-name prefix means different things at different pilots."""
        rules = {(m["pilot"], m["rule"]) for _, m in self.snap.ad_rt_policies}
        self.assertIn(("ranverso", "R4b_soil_low"), rules)
        self.assertIn(("baltanas", "R4b_soil_range"), rules)


if __name__ == "__main__":
    unittest.main()
