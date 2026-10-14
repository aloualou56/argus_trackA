"""Tests for tools/pi/guardian_live.py, the Pi's reader of the newest ARGUS records.

Run from the repo root:  python3 -I -m unittest discover -s tools/tests -t tools -v
"""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import math
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import build_game_data as b

_spec = importlib.util.spec_from_file_location("guardian_live", Path(__file__).resolve().parents[1] / "pi" / "guardian_live.py")
live = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(live)

SNAPSHOT_OK = (b.SNAPSHOT_DIR / "threat-contexts.json").exists()


class FakeApi:
    """The ARGUS API's paging: 15 records a page, oldest first, with meta.last_page and meta.total."""

    def __init__(self, **resources):
        self.resources = {name.replace("_", "-"): list(records) for name, records in resources.items()}
        self.calls = []
        self.broken = False

    def __call__(self, url):
        if self.broken:
            raise RuntimeError("ARGUS is down")
        parsed = urlparse(url)
        resource = parsed.path.rsplit("/", 1)[1]
        page = int(parse_qs(parsed.query)["page"][0])
        self.calls.append((resource, page))
        records = self.resources.get(resource, [])
        return {"data": records[(page - 1) * 15: page * 15],
                "meta": {"last_page": max(1, math.ceil(len(records) / 15)), "total": len(records)}}


def check(id_, key, at, state="inactive", probability=0.01, pilot="delos"):
    return {"id": id_, "metadata": json.dumps({
        "kind": "ira_threat_evaluation", "pilot": pilot, "scenario_key": key, "evaluated_at": at,
        "previous_state": "inactive",
        "evaluation": {"state": state, "probability": probability,
                       "thresholds": {"watch": 0.1, "active": 0.25, "escalated": 0.5}}})}


def alarm(id_, at, value=3.0, rule="R1a_rain_1h", site="delos", kind="EK"):
    return {"id": id_, "metadata": json.dumps({"kind": "ad_rt_event", "alarm": {
        "site": site, "type": kind, "rule": rule, "timestamp": at, "score": None, "threshold": None,
        "variables": [{"name": "rain_1h", "value": value, "threshold": 2.0}]}})}


@unittest.skipUnless(SNAPSHOT_OK, "snapshot/ not present")
class SameAsTheBuild(unittest.TestCase):
    """On the snapshot's records, the Pi keeps what the game's data build reads from them."""

    @classmethod
    def setUpClass(cls):
        cls.raw = b.load_snapshot(b.SNAPSHOT_DIR)
        cls.snap = b.Snapshot(cls.raw)
        cls.data = json.loads(b.OUT_JSON.read_text(encoding="utf-8"))

    def test_latest_check_of_each_danger(self):
        state = live.empty_state()
        live.add_records(state, "threat-contexts", self.raw["threat-contexts"]["records"])
        self.assertEqual(set(state["risks"]), set(self.snap.risk_evaluations))
        for key, evaluations in self.snap.risk_evaluations.items():
            last, kept = evaluations[-1], state["risks"][key]
            self.assertEqual(kept["state"], last["evaluation"]["state"], key)
            self.assertEqual(kept["probability"], last["evaluation"]["probability"], key)
            self.assertEqual(kept["evaluated_at"], live.utc(last["evaluated_at"]), key)
            self.assertEqual(kept["pilot"], last["pilot"], key)

    def test_alarms_counted_once_as_the_build_does(self):
        keys = {}
        for record in self.raw["events"]["records"]:
            found = live.sensor_alarm(record)
            if found:
                keys.setdefault(found["site"], set()).add(found["key"])
        for mon in self.data["monuments"]:
            self.assertEqual(len(keys.get(mon["pilot_key"], ())), mon["alarm_funnel"]["unique"], mon["pilot_key"])

    def test_published_file_is_small(self):
        state = live.empty_state()
        live.add_records(state, "threat-contexts", self.raw["threat-contexts"]["records"])
        live.add_records(state, "events", self.raw["events"]["records"])
        data = live.published(state, dt.datetime(2026, 10, 14, tzinfo=dt.timezone.utc))
        self.assertLess(len(json.dumps(data, ensure_ascii=False).encode("utf-8")), 40 * 1024)
        for site in data["sites"].values():
            self.assertLessEqual(len(site.get("alarms", [])), live.ALARMS_KEPT)


class Reading(unittest.TestCase):
    def test_reads_only_what_is_new(self):
        api = FakeApi(threat_contexts=[check(i, f"delos-masks.k{i}.site", "2026-10-12T21:00:00+00:00") for i in range(1, 41)])
        state = live.empty_state()
        self.assertEqual(live.refresh(state, api, pause=0)["threat-contexts"], 40)
        self.assertEqual([p for r, p in api.calls if r == "threat-contexts"], [1, 2, 3])
        api.calls.clear()
        api.resources["threat-contexts"] += [check(i, f"delos-masks.k{i - 40}.site", "2026-10-13T21:00:00+00:00") for i in range(41, 46)]
        self.assertEqual(live.refresh(state, api, pause=0)["threat-contexts"], 5)
        self.assertEqual([p for r, p in api.calls if r == "threat-contexts"], [3])  # the last page only
        self.assertEqual(state["risks"]["delos-masks.k1.site"]["evaluated_at"], "2026-10-13T21:00:00Z")
        api.calls.clear()
        self.assertEqual(live.refresh(state, api, pause=0)["threat-contexts"], 0)

    def test_starts_again_when_records_disappear(self):
        api = FakeApi(events=[alarm(i, f"2026-10-0{1 + i % 5}T20:30:00", value=float(i)) for i in range(1, 31)])
        state = live.empty_state()
        live.refresh(state, api, pause=0)
        api.resources["events"] = api.resources["events"][:3]
        live.refresh(state, api, pause=0)
        self.assertEqual({a["variables"][0]["value"] for a in state["alarms"]["delos"]}, {1.0, 2.0, 3.0})

    def test_the_same_alarm_recorded_twice_is_kept_once(self):
        state = live.empty_state()
        live.add_records(state, "events", [alarm(1, "2026-10-02T20:30:00", 3.0), alarm(2, "2026-10-02T20:30:00", 3.1),
                                           alarm(3, "2026-10-02T21:30:00", 4.0)])
        kept = state["alarms"]["delos"]
        self.assertEqual([a["timestamp"] for a in kept], ["2026-10-02T21:30:00", "2026-10-02T20:30:00"])
        self.assertEqual(kept[1]["variables"][0]["value"], 3.0)  # its first record

    def test_odd_records_are_skipped(self):
        odd = [
            {"id": 1, "metadata": "not json"},
            {"id": 2, "metadata": None},
            {"id": 3, "metadata": json.dumps({"kind": "ira_threat_evaluation", "pilot": "delos"})},
            check(4, "delos-masks.k.site", "yesterday"),
            check(5, "delos-masks.k.site", "2026-10-13T21:00:00"),  # no zone
            {"id": 6, "metadata": json.dumps({"kind": "ira_threat_evaluation", "pilot": "delos", "scenario_key": "k",
                                              "evaluated_at": "2026-10-13T21:00:00+00:00",
                                              "evaluation": {"state": "watch", "probability": True}})},
        ]
        state = live.empty_state()
        self.assertEqual(live.add_records(state, "threat-contexts", odd), 0)
        self.assertEqual(live.add_records(state, "events", [alarm(7, "2026-13-40T99:00:00"), {"id": 8}]), 0)
        nan = alarm(9, "2026-10-02T20:30:00")
        nan["metadata"] = nan["metadata"].replace("3.0", "NaN")
        live.add_records(state, "events", [nan])
        self.assertIsNone(state["alarms"]["delos"][0]["variables"][0]["value"])


class Publishing(unittest.TestCase):
    def test_last_run_of_each_monument(self):
        state = live.empty_state()
        live.add_records(state, "threat-contexts", [
            check(1, "delos-masks.old.site", "2026-10-01T21:00:00+00:00"),
            check(2, "delos-masks.a.site", "2026-10-13T21:00:33.400435+00:00", state="watch", probability=0.12),
            check(3, "delos-masks.b.site", "2026-10-13T21:01:02+00:00"),
            check(4, "schenkenberg.c", "2026-10-13T21:02:06+00:00", pilot="schenkenberg"),
        ])
        live.add_records(state, "events", [alarm(i, f"2026-10-{i:02d}T20:30:00") for i in range(1, 13)])
        data = live.published(state, dt.datetime(2026, 10, 14, 9, 15, tzinfo=dt.timezone.utc))
        self.assertEqual(data["schema"], 1)
        self.assertEqual(data["checked_at"], "2026-10-14T09:15:00Z")
        delos = data["sites"]["delos"]
        self.assertEqual(delos["risk"]["evaluated_at"], "2026-10-13T21:01:02Z")
        self.assertEqual([s["key"] for s in delos["risk"]["scenarios"]], ["delos-masks.a.site", "delos-masks.b.site"])
        self.assertEqual(delos["risk"]["scenarios"][0]["state"], "watch")
        self.assertEqual(delos["risk"]["scenarios"][0]["thresholds"], {"watch": 0.1, "active": 0.25, "escalated": 0.5})
        self.assertNotIn("pilot", delos["risk"]["scenarios"][0])
        self.assertEqual([a["timestamp"][:10] for a in delos["alarms"]][:2], ["2026-10-12", "2026-10-11"])
        self.assertEqual(len(delos["alarms"]), live.ALARMS_KEPT)
        self.assertNotIn("key", delos["alarms"][0])
        self.assertNotIn("alarms", data["sites"]["schenkenberg"])

    def test_a_failed_run_keeps_the_last_good_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            api = FakeApi(threat_contexts=[check(1, "delos-masks.a.site", "2026-10-13T21:00:00+00:00")])
            said = io.StringIO()
            with contextlib.redirect_stdout(said), contextlib.redirect_stderr(said):
                self.assertEqual(live.main(["--out", tmp], fetch=api), 0)
                public = Path(tmp) / "public" / "argus-now.json"
                first = public.read_text(encoding="utf-8")
                self.assertIn("delos-masks.a.site", first)
                api.broken = True
                self.assertEqual(live.main(["--out", tmp], fetch=api), 1)
            self.assertIn("guardian-live: 1 new checks", said.getvalue())
            self.assertIn("ARGUS is down", said.getvalue())
            self.assertEqual(public.read_text(encoding="utf-8"), first)
            self.assertEqual(sorted(p.name for p in (Path(tmp) / "public").iterdir()), ["argus-now.json"])


if __name__ == "__main__":
    unittest.main()
