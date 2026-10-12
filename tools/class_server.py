#!/usr/bin/env python3
"""Class server: serves the built game and keeps a class's anonymous records on this computer.

    python3 -I tools/class_server.py                 # http://127.0.0.1:8765, this computer only
    python3 -I tools/class_server.py --lan           # also for devices on the same network (a classroom)
    python3 -I tools/class_server.py --online-maps   # allow satellite and street-map pictures from the internet

Needs a build first (cd web && npm run build). Nothing is sent anywhere: the server only answers
requests. By default it listens on this computer alone, and the page it serves is told to ask for
nothing outside this server (drawn plan instead of satellite pictures); a Content-Security-Policy
header makes the browser enforce that. Records are the same anonymous ones the game keeps on a
device (no names, no times, no device ids); they go to class_data/plays.jsonl and quizzes.jsonl,
one JSON object per line. Requests are not logged, so no addresses are written anywhere.

The page learns about this server from a small script added to index.html (see web/src/runtime.ts).
Standard library only, Python 3.9+.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import ipaddress
import json
import re
import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DIST = ROOT / "web" / "dist"
DEFAULT_DATA = ROOT / "class_data"
DEFAULT_PORT = 8765

MAX_BODY = 4096  # bytes: a play record is a few hundred
MAX_RECORDS = 50_000  # per file: a full disk must not be one request away
MAX_ANSWER = 5_000  # records in one answer, newest kept

# The same rules as supabase/schema.sql, so a record means the same wherever it is kept.
LEVELS = {"low", "medium", "high", "extreme", "catastrophic"}
MONUMENT = re.compile(r"^[a-z]{3,20}$")
CARD = re.compile(r"^[a-z_]{2,30}$")
CLASS_CODE = re.compile(r"^[A-HJ-NP-Z2-9]{6}$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FIRST_DAY = dt.date(2026, 1, 1)

TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
}


class Invalid(ValueError):
    pass


# --------------------------------------------------------------------------- records

def _whole(value: Any, low: int, high: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise Invalid(f"{name}: a whole number from {low} to {high}")
    return value


def _day(value: Any) -> str:
    if not isinstance(value, str) or not DAY.match(value):
        raise Invalid("day: YYYY-MM-DD")
    try:
        day = dt.date.fromisoformat(value)
    except ValueError:
        raise Invalid("day: not a date") from None
    if not FIRST_DAY <= day <= dt.date.today() + dt.timedelta(days=1):
        raise Invalid("day: out of range")
    return value


def _common(raw: Any) -> Dict[str, Any]:
    if not isinstance(raw, dict):
        raise Invalid("a record is a JSON object")
    if not isinstance(raw.get("monument"), str) or not MONUMENT.match(raw["monument"]):
        raise Invalid("monument: 3 to 20 small letters")
    record: Dict[str, Any] = {"v": 1, "monument": raw["monument"]}
    code = raw.get("classCode")
    if code is not None:
        if not isinstance(code, str) or not CLASS_CODE.match(code):
            raise Invalid("classCode: not a class code")
        record["classCode"] = code
    return record


def clean_play(raw: Any) -> Dict[str, Any]:
    """A play record with exactly the fields the game knows, or Invalid. Unknown fields are dropped."""
    record = _common(raw)
    if raw.get("level") not in LEVELS:
        raise Invalid("level: unknown")
    picks = raw.get("picks")
    if not isinstance(picks, dict) or len(picks) > 40:
        raise Invalid("picks: an object of card counts")
    for card, count in picks.items():
        if not CARD.match(card):
            raise Invalid("picks: unknown card name")
        _whole(count, 1, 99, f"picks.{card}")
    if not isinstance(raw.get("detected"), bool):
        raise Invalid("detected: true or false")
    record.update(level=raw["level"], picks=dict(picks), score=_whole(raw.get("score"), 0, 100, "score"),
                  detected=raw["detected"], day=_day(raw.get("day")))
    decision = raw.get("decision")
    if decision is not None:
        if not isinstance(decision, str) or not CARD.match(decision):
            raise Invalid("decision: unknown")
        record["decision"] = decision
    return record


def _marks(value: Any, name: str) -> List[bool]:
    if not isinstance(value, list) or not 1 <= len(value) <= 20 or not all(isinstance(m, bool) for m in value):
        raise Invalid(f"{name}: a list of true/false")
    return value


def clean_quiz(raw: Any) -> Dict[str, Any]:
    record = _common(raw)
    record.update(pre=None if raw.get("pre") is None else _marks(raw["pre"], "pre"),
                  post=_marks(raw.get("post"), "post"), day=_day(raw.get("day")))
    return record


class Store:
    """Records in memory and in one file per kind, one JSON object per line. Safe across threads."""

    def __init__(self, folder: Path, max_records: int = MAX_RECORDS):
        self.folder = folder
        self.max_records = max_records
        self.lock = threading.Lock()
        self.records: Dict[str, List[Dict[str, Any]]] = {"plays": [], "quizzes": []}
        folder.mkdir(parents=True, exist_ok=True)
        for kind, clean in (("plays", clean_play), ("quizzes", clean_quiz)):
            path = folder / f"{kind}.jsonl"
            if not path.exists():
                continue
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    self.records[kind].append(clean(json.loads(line)))
                except (ValueError, TypeError):
                    continue  # a line edited by hand or cut off by a power loss: skip it

    def add(self, kind: str, record: Dict[str, Any]) -> bool:
        with self.lock:
            if len(self.records[kind]) >= self.max_records:
                return False
            with (self.folder / f"{kind}.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
            self.records[kind].append(record)
            return True

    def find(self, kind: str, **equals: Optional[str]) -> List[Dict[str, Any]]:
        wanted = {key: value for key, value in equals.items() if value is not None}
        with self.lock:
            found = [r for r in self.records[kind] if all(r.get(k) == v for k, v in wanted.items())]
        return found[-MAX_ANSWER:]


# --------------------------------------------------------------------------- the page

def tile_origins(dist: Path) -> List[str]:
    """Where the game's satellite and street-map pictures come from (read from the built data pack)."""
    try:
        data = json.loads((dist / "data" / "game_data.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    origins = []
    for layer in data.get("basemaps", {}).get("layers", []):
        parts = urlsplit(layer.get("url") or "")
        if parts.scheme == "https" and parts.netloc and f"https://{parts.netloc}" not in origins:
            origins.append(f"https://{parts.netloc}")
    return origins


class Site:
    """What every request needs: the built game, the records, and the page settings."""

    def __init__(self, dist: Path, store: Store, online_maps: bool = False, public_url: Optional[str] = None):
        self.dist = dist.resolve()
        self.store = store
        settings = {"store": "lan", "localOnly": not online_maps, "publicUrl": public_url}
        # "<" is escaped so no setting can ever close the script element.
        self.script = "window.__GUARDIAN__=" + json.dumps(settings).replace("<", "\\u003c") + ";"
        digest = base64.b64encode(hashlib.sha256(self.script.encode("utf-8")).digest()).decode("ascii")
        pictures = " ".join(["'self'", "data:", "blob:"] + (tile_origins(self.dist) if online_maps else []))
        # The browser itself refuses anything not listed here: with the defaults, nothing outside this server.
        self.policy = "; ".join([
            "default-src 'self'",
            f"script-src 'self' 'sha256-{digest}'",
            "style-src 'self' 'unsafe-inline'",  # the map library positions its tiles and pins with inline styles
            f"img-src {pictures}",
            "connect-src 'self'",
            "worker-src 'self'",
            "manifest-src 'self'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ])
        self.names = {"localhost", socket.gethostname().lower()}

    def index(self) -> bytes:
        html = (self.dist / "index.html").read_text(encoding="utf-8")
        if "</head>" not in html:
            raise RuntimeError("index.html has no </head>")
        return html.replace("</head>", f"<script>{self.script}</script></head>", 1).encode("utf-8")

    def file(self, url_path: str) -> Optional[Path]:
        """The built file for a URL path, or None. Never a file outside the build folder."""
        target = (self.dist / url_path.lstrip("/")).resolve()
        if target != self.dist and self.dist not in target.parents:
            return None
        return target if target.is_file() else None

    def host_allowed(self, header: Optional[str]) -> bool:
        """This computer's names and plain addresses only: a page elsewhere cannot reach us by pointing its own name here."""
        if not header:
            return False
        host = header.rsplit(":", 1)[0] if not header.endswith("]") else header
        host = host.strip("[]").lower()
        if host in self.names:
            return True
        try:
            ipaddress.ip_address(host)
            return True
        except ValueError:
            return False


def make_handler(site: Site, verbose: bool = False):
    class Handler(BaseHTTPRequestHandler):
        server_version = "GuardianClassServer/1"
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 (the base class's name)
            if verbose:
                # Method, path and status only: never the address the request came from.
                sys.stderr.write("class_server: " + (format % args) + "\n")

        # ------------------------------------------------------------- answers
        def answer(self, status: int, body: bytes, content_type: str, cache: str = "no-cache") -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", site.policy)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def answer_json(self, status: int, payload: Dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.answer(status, body, TYPES[".json"], cache="no-store")

        def refuse(self, status: int, why: str) -> None:
            self.close_connection = True  # an unread body may still be on the line
            self.answer_json(status, {"error": why})

        # ------------------------------------------------------------- GET
        def do_GET(self) -> None:  # noqa: N802 (http.server's name)
            if not site.host_allowed(self.headers.get("Host")):
                return self.refuse(403, "unknown host name")
            url = urlsplit(self.path)
            query = {key: values[0] for key, values in parse_qs(url.query).items()}
            if url.path == "/api/health":
                return self.answer_json(200, {"ok": True})
            if url.path == "/api/plays":
                found = site.store.find("plays", monument=query.get("monument"), level=query.get("level"),
                                        classCode=query.get("class"))
                return self.answer_json(200, {"records": found})
            if url.path == "/api/quizzes":
                return self.answer_json(200, {"records": site.store.find("quizzes", classCode=query.get("class"))})
            if url.path.startswith("/api/"):
                return self.refuse(404, "no such address")
            if url.path in ("/", "/index.html"):
                return self.answer(200, site.index(), TYPES[".html"])
            found = site.file(url.path)
            if not found:
                return self.refuse(404, "not found")
            # Built files have content hashes in their names; the data pack and sw.js do not.
            hashed = "/assets/" in url.path
            self.answer(200, found.read_bytes(), TYPES.get(found.suffix.lower(), "application/octet-stream"),
                        cache="public, max-age=31536000, immutable" if hashed else "no-cache")

        do_HEAD = do_GET  # noqa: N815

        # ------------------------------------------------------------- POST
        def do_POST(self) -> None:  # noqa: N802
            if not site.host_allowed(self.headers.get("Host")):
                return self.refuse(403, "unknown host name")
            url = urlsplit(self.path)
            kinds = {"/api/plays": ("plays", clean_play), "/api/quizzes": ("quizzes", clean_quiz)}
            if url.path not in kinds:
                return self.refuse(404, "no such address")
            # Only the game's own page may add records. A page from elsewhere cannot send JSON here
            # without the browser asking first (which we never allow), and its Origin gives it away.
            if self.headers.get_content_type() != "application/json":
                return self.refuse(415, "send JSON")
            origin = self.headers.get("Origin")
            if origin and urlsplit(origin).netloc.lower() != (self.headers.get("Host") or "").lower():
                return self.refuse(403, "another site")
            try:
                length = int(self.headers.get("Content-Length") or "")
            except ValueError:
                return self.refuse(411, "no length")
            if not 0 < length <= MAX_BODY:
                return self.refuse(413, "too large")
            kind, clean = kinds[url.path]
            try:
                record = clean(json.loads(self.rfile.read(length).decode("utf-8")))
            except Invalid as exc:
                return self.answer_json(400, {"error": str(exc)})
            except (ValueError, UnicodeDecodeError):
                return self.answer_json(400, {"error": "not JSON"})
            if not site.store.add(kind, record):
                return self.answer_json(507, {"error": "the class file is full"})
            self.answer_json(201, {"ok": True})

    return Handler


def make_server(dist: Path, data: Path, host: str = "127.0.0.1", port: int = DEFAULT_PORT, online_maps: bool = False,
                public_url: Optional[str] = None, verbose: bool = False) -> ThreadingHTTPServer:
    site = Site(dist, Store(data), online_maps=online_maps, public_url=public_url)
    server = ThreadingHTTPServer((host, port), make_handler(site, verbose))
    server.daemon_threads = True
    return server


def lan_address() -> Optional[str]:
    """This computer's address on the local network, or None. Opens no connection and sends nothing:
    a UDP socket is only asked which of the computer's addresses it would use."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))
        address = probe.getsockname()[0]
    except OSError:
        return None
    finally:
        probe.close()
    return None if address.startswith("127.") else address


def main(argv: Optional[List[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")  # -I ignores PYTHONIOENCODING
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--lan", action="store_true",
                        help="also answer devices on the same network (default: this computer only)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--dist", type=Path, default=DEFAULT_DIST, help="the built game (default: web/dist)")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="where records are kept (default: class_data/)")
    parser.add_argument("--online-maps", action="store_true",
                        help="let browsers load satellite and street-map pictures from the internet")
    parser.add_argument("--verbose", action="store_true", help="print each request (never the sender's address)")
    args = parser.parse_args(argv)

    if not (args.dist / "index.html").is_file():
        print(f"class_server: no built game in {args.dist}. Run 'npm run build' in web/ first.", file=sys.stderr)
        return 1
    address = lan_address() if args.lan else None
    public_url = f"http://{address}:{args.port}/" if address else None
    try:
        server = make_server(args.dist, args.data, "0.0.0.0" if args.lan else "127.0.0.1", args.port,
                             online_maps=args.online_maps, public_url=public_url, verbose=args.verbose)
    except OSError as exc:
        print(f"class_server: cannot listen on port {args.port} ({exc}). Try --port with another number.", file=sys.stderr)
        return 1

    print(f"class_server: on this computer   http://127.0.0.1:{args.port}/")
    if args.lan:
        print(f"class_server: for the class      {public_url or 'no network address found: check the connection'}")
    else:
        print("class_server: this computer only. Add --lan for other devices on the same network.")
    print("class_server: maps               " + ("satellite and street map from the internet, plus the drawn plan"
                                                  if args.online_maps else "drawn plan only: the page asks for nothing outside this server"))
    print(f"class_server: records            {args.data}")
    print("class_server: stop with Ctrl+C", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nclass_server: stopped")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
