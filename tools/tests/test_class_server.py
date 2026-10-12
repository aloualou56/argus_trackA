"""Tests for tools/class_server.py. They start the server on this computer only (127.0.0.1, a free
port) with a made-up build folder, so they need no build and no internet.

Run from the repo root:  python3 -I -m unittest discover -s tools/tests -t tools -v
"""
import datetime as dt
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

import class_server as cs

TODAY = dt.date.today().isoformat()
PLAY = {"v": 1, "monument": "ranverso", "level": "extreme", "picks": {"rain_gauge": 1, "humidity": 2},
        "score": 80, "detected": True, "day": TODAY, "classCode": "ABC234", "decision": "inspect"}
QUIZ = {"v": 1, "monument": "ranverso", "pre": [True, False], "post": [True, True], "day": TODAY, "classCode": "ABC234"}
INDEX = "<!doctype html><html><head><title>game</title></head><body><div id=root></div></body></html>"
PACK = {"basemaps": {"layers": [{"id": "satellite", "url": "https://tiles.example.org/{z}/{y}/{x}"},
                                {"id": "plan", "type": "vector"}]}}


class Running:
    """A class server on a free port of this computer, with its own build and data folders."""

    def __init__(self, **options):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.dist, self.data = root / "dist", root / "data"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "data").mkdir()
        (self.dist / "index.html").write_text(INDEX, encoding="utf-8")
        (self.dist / "assets" / "app-abc123.js").write_text("console.log('game')", encoding="utf-8")
        (self.dist / "data" / "game_data.json").write_text(json.dumps(PACK), encoding="utf-8")
        (root / "secret.txt").write_text("not part of the game", encoding="utf-8")
        self.options = options
        self.start()

    def start(self):
        self.server = cs.make_server(self.dist, self.data, "127.0.0.1", 0, **self.options)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def close(self):
        self.stop()
        self.tmp.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            payload = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode("utf-8"))
            sent = {"Content-Type": "application/json"} if payload is not None else {}
            sent.update(headers or {})
            connection.request(method, path, body=payload, headers=sent)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def records(self, path):
        status, _, body = self.request("GET", path)
        assert status == 200, status
        return json.loads(body)["records"]


class ClassServer(unittest.TestCase):
    def setUp(self):
        self.site = Running()
        self.addCleanup(self.site.close)

    def test_serves_the_game_and_tells_the_page_it_is_local(self):
        status, headers, body = self.site.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers["Content-Type"])
        page = body.decode("utf-8")
        self.assertIn('<script>window.__GUARDIAN__={"store": "lan", "localOnly": true, "publicUrl": null};</script></head>', page)
        status, headers, body = self.site.request("GET", "/assets/app-abc123.js")
        self.assertEqual((status, body), (200, b"console.log('game')"))
        self.assertIn("javascript", headers["Content-Type"])
        self.assertIn("immutable", headers["Cache-Control"])

    def test_the_browser_is_told_to_ask_nothing_outside_this_server(self):
        _, headers, _ = self.site.request("GET", "/")
        policy = headers["Content-Security-Policy"]
        self.assertIn("default-src 'self'", policy)
        self.assertIn("connect-src 'self'", policy)
        self.assertIn("img-src 'self' data: blob:;", policy + ";")
        self.assertNotIn("http", policy)  # no outside address at all
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")

    def test_online_maps_must_be_asked_for_and_only_add_the_picture_hosts(self):
        online = Running(online_maps=True, public_url="http://192.168.1.20:8765/")
        self.addCleanup(online.close)
        _, headers, body = online.request("GET", "/")
        self.assertIn("img-src 'self' data: blob: https://tiles.example.org", headers["Content-Security-Policy"])
        self.assertIn("connect-src 'self'", headers["Content-Security-Policy"])
        self.assertIn('"localOnly": false, "publicUrl": "http://192.168.1.20:8765/"', body.decode("utf-8"))

    def test_the_added_script_matches_the_hash_the_browser_checks(self):
        import base64
        import hashlib
        _, headers, body = self.site.request("GET", "/")
        script = body.decode("utf-8").split("<script>")[1].split("</script>")[0]
        digest = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii")
        self.assertIn(f"'sha256-{digest}'", headers["Content-Security-Policy"])

    def test_keeps_a_class_apart_from_other_classes(self):
        self.assertEqual(self.site.request("POST", "/api/plays", PLAY)[0], 201)
        self.assertEqual(self.site.request("POST", "/api/plays", dict(PLAY, classCode="XYZ789", level="low"))[0], 201)
        self.assertEqual(self.site.request("POST", "/api/quizzes", QUIZ)[0], 201)
        self.assertEqual(self.site.records("/api/plays?class=ABC234"), [PLAY])
        self.assertEqual(len(self.site.records("/api/plays?monument=ranverso")), 2)
        self.assertEqual(len(self.site.records("/api/plays?monument=ranverso&level=low")), 1)
        self.assertEqual(self.site.records("/api/plays?monument=delos"), [])
        self.assertEqual(self.site.records("/api/quizzes?class=ABC234"), [QUIZ])
        self.assertEqual(self.site.records("/api/quizzes?class=XYZ789"), [])

    def test_records_survive_a_restart_and_a_damaged_line(self):
        self.site.request("POST", "/api/plays", PLAY)
        self.site.stop()
        with (self.site.data / "plays.jsonl").open("a", encoding="utf-8") as fh:
            fh.write('{"monument": "ranv\n')  # cut off, as after a power loss
        self.site.start()
        self.assertEqual(self.site.records("/api/plays"), [PLAY])

    def test_stores_only_the_fields_the_game_knows(self):
        extra = dict(PLAY, name="Maria", ip="10.0.0.7", userAgent="phone")
        self.assertEqual(self.site.request("POST", "/api/plays", extra)[0], 201)
        line = (self.site.data / "plays.jsonl").read_text(encoding="utf-8").strip()
        self.assertEqual(sorted(json.loads(line)), sorted(PLAY))
        self.assertNotIn("Maria", line)
        self.assertNotIn("127.0.0.1", line)

    def test_refuses_what_is_not_a_record(self):
        bad = [
            dict(PLAY, monument="../etc"), dict(PLAY, level="impossible"), dict(PLAY, score=101), dict(PLAY, score=True),
            dict(PLAY, picks={"humidity": 0}), dict(PLAY, picks={"<script>": 1}), dict(PLAY, picks=[1]),
            dict(PLAY, detected="yes"), dict(PLAY, day="2020-01-01"), dict(PLAY, day="2026-13-40"),
            dict(PLAY, classCode="abc234"), dict(PLAY, classCode="ABC10O"), dict(PLAY, decision="DROP TABLE"),
            ["not", "an", "object"],
        ]
        for record in bad:
            self.assertEqual(self.site.request("POST", "/api/plays", record)[0], 400, record)
        self.assertEqual(self.site.request("POST", "/api/quizzes", dict(QUIZ, post=[1, 0]))[0], 400)
        self.assertEqual(self.site.request("POST", "/api/quizzes", dict(QUIZ, post=[]))[0], 400)
        self.assertEqual(self.site.request("POST", "/api/quizzes", dict(QUIZ, pre="none"))[0], 400)
        self.assertEqual(self.site.request("POST", "/api/plays", b"{not json")[0], 400)
        self.assertEqual(self.site.records("/api/plays"), [])
        self.assertEqual(self.site.request("POST", "/api/quizzes", dict(QUIZ, pre=None))[0], 201)  # skipped first quiz

    def test_refuses_oversized_and_foreign_requests(self):
        big = dict(PLAY, picks={f"card_{'x' * 20}{i:02d}": 1 for i in range(40)}, padding="x" * 5000)
        self.assertEqual(self.site.request("POST", "/api/plays", big)[0], 413)
        # A page from somewhere else cannot add records: wrong content type, or its Origin gives it away.
        self.assertEqual(self.site.request("POST", "/api/plays", PLAY, {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.site.request("POST", "/api/plays", PLAY, {"Origin": "https://elsewhere.example"})[0], 403)
        own = {"Origin": f"http://127.0.0.1:{self.site.port}"}
        self.assertEqual(self.site.request("POST", "/api/plays", PLAY, own)[0], 201)
        # Nor can a foreign name pointed at this computer read or write here.
        self.assertEqual(self.site.request("GET", "/api/plays", headers={"Host": "attacker.example"})[0], 403)
        self.assertEqual(self.site.request("POST", "/api/plays", PLAY, {"Host": "attacker.example"})[0], 403)
        self.assertEqual(self.site.request("GET", "/api/plays", headers={"Host": f"localhost:{self.site.port}"})[0], 200)
        self.assertEqual(self.site.request("POST", "/api/other", PLAY)[0], 404)
        self.assertEqual(len(self.site.records("/api/plays")), 1)

    def test_never_serves_files_outside_the_build(self):
        for path in ("/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt",
                     "/nothing-here.js", "/assets"):
            status, _, body = self.site.request("GET", path)
            self.assertEqual(status, 404, path)
            self.assertNotIn(b"not part of the game", body)

    def test_stops_adding_when_the_file_is_full(self):
        store = cs.Store(self.site.data / "small", max_records=2)
        self.assertTrue(store.add("plays", cs.clean_play(PLAY)))
        self.assertTrue(store.add("plays", cs.clean_play(PLAY)))
        self.assertFalse(store.add("plays", cs.clean_play(PLAY)))
        self.assertEqual(len(store.find("plays")), 2)

    def test_listens_on_this_computer_only_by_default(self):
        import inspect
        self.assertEqual(inspect.signature(cs.make_server).parameters["host"].default, "127.0.0.1")
        self.assertEqual(self.site.server.server_address[0], "127.0.0.1")
        # The command line opens it to the network only when asked to.
        self.assertIn('"0.0.0.0" if args.lan else "127.0.0.1"', Path(cs.__file__).read_text(encoding="utf-8"))


class Records(unittest.TestCase):
    def test_same_rules_as_the_cloud_schema(self):
        schema = (cs.ROOT / "supabase" / "schema.sql").read_text(encoding="utf-8")
        self.assertIn("'^[a-z]{3,20}$'", schema)
        self.assertEqual(cs.MONUMENT.pattern, "^[a-z]{3,20}$")
        self.assertIn("'^[A-HJ-NP-Z2-9]{6}$'", schema)
        self.assertEqual(cs.CLASS_CODE.pattern, "^[A-HJ-NP-Z2-9]{6}$")
        for level in cs.LEVELS:
            self.assertIn(f"'{level}'", schema)

    def test_a_record_from_tomorrow_is_fine_but_not_from_next_week(self):
        tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()  # a phone in another time zone
        next_week = (dt.date.today() + dt.timedelta(days=7)).isoformat()
        self.assertEqual(cs.clean_play(dict(PLAY, day=tomorrow))["day"], tomorrow)
        with self.assertRaises(cs.Invalid):
            cs.clean_play(dict(PLAY, day=next_week))


if __name__ == "__main__":
    unittest.main()
