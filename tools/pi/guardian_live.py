#!/usr/bin/env python3
"""The newest ARGUS readings for the game's first screen, as one small file the Pi serves.

Every evening ARGUS's risk model checks each danger at each monument again, and its sensors raise
an alarm when a reading crosses a limit. This script, run on the Raspberry Pi every 15 minutes
(guardian-live.timer), reads from the ARGUS API only the records added since its last run (GET
requests, one page at a time with a short pause; the API pages are oldest first) and keeps, for
each monument, the latest check of each danger and its newest sensor alarms. It writes them to
<out>/public/argus-now.json, which Caddy serves as /live/argus-now.json (tools/pi/Caddyfile).

It knows nothing about the game: what to show, in which words, and which alarms the game can
explain is decided in the browser (web/src/game/live.ts), so a new version of the game never needs
a change here. Everything it writes comes from the ARGUS API as it is; nothing is made up, and a
failed run leaves the last good file in place.

    python3 -I guardian_live.py --out /var/lib/guardian-live

Standard library only, Python 3.9 (the Pi runs Debian 11). Installed on the Pi as
/usr/local/bin/guardian-live (tools/pi/README.md).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

API = "http://api.argusservices.athenarc.gr/api"  # the 'Production' server in the ARGUS specs.json
USER_AGENT = "guardian-for-a-day-live/1 (read-only, every 15 minutes)"
STATE_VERSION = 1
SCHEMA = 1
PAUSE = 0.5  # seconds between two pages
MAX_PAGES = 400  # per resource and run: the first run reads everything (about 100 pages each)
ALARMS_KEPT = 10  # newest sensor alarms kept per monument
RUN_WINDOW = dt.timedelta(hours=12)  # checks this close to a monument's newest one are the same run
TEXT_MAX = 200  # longest string copied from the API

Fetch = Callable[[str], Dict[str, Any]]


class Restart(Exception):
    """The API has fewer records than before: read that resource again from the start."""


def fetch_json(url: str) -> Dict[str, Any]:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except Exception as exc:  # network trouble: two more tries, then give up until the next run
            if attempt == 2:
                raise RuntimeError(f"GET {url} failed: {exc}") from None
            time.sleep(5 * (attempt + 1))
    raise AssertionError("unreachable")


def metadata(record: Dict[str, Any]) -> Dict[str, Any]:
    """metadata is usually a JSON-encoded string; sometimes null or already an object."""
    raw = record.get("metadata")
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return value if isinstance(value, dict) else {}
    return {}


def number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def text(value: Any) -> Optional[str]:
    return value[:TEXT_MAX] if isinstance(value, str) and value else None


def utc(value: Any) -> Optional[str]:
    """An ISO time with a zone, as UTC to the second ("2026-10-13T21:00:33Z")."""
    if not isinstance(value, str):
        return None
    try:
        when = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if when.tzinfo is None:
        return None
    return when.astimezone(dt.timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def plain_time(value: Any) -> Optional[str]:
    """An alarm's time as ARGUS gives it, without a zone ("2026-10-02T20:30:00"), checked."""
    if not isinstance(value, str):
        return None
    try:
        dt.datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return None
    return value[:19]


# --------------------------------------------------------------------------- one record

def risk_check(record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """A threat-contexts record: one danger checked again by the risk model, or None."""
    m = metadata(record)
    evaluation = m.get("evaluation") if isinstance(m.get("evaluation"), dict) else {}
    key, pilot, at = text(m.get("scenario_key")), text(m.get("pilot")), utc(m.get("evaluated_at"))
    state = text(evaluation.get("state") or m.get("current_state"))
    probability = number(evaluation.get("probability"))
    if m.get("kind") != "ira_threat_evaluation" or not (key and pilot and at and state) or probability is None:
        return None
    limits = evaluation.get("thresholds") if isinstance(evaluation.get("thresholds"), dict) else {}
    thresholds = {name: number(limits.get(name)) for name in ("watch", "active", "escalated")}
    return {
        "pilot": pilot,
        "key": key,
        "state": state,
        "probability": probability,
        "thresholds": thresholds if all(v is not None for v in thresholds.values()) else None,
        "previous_state": text(m.get("previous_state")),
        "evaluated_at": at,
    }


def sensor_alarm(record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """An events record that is a sensor alarm (AD-RT), kept as the game reads alarms, or None."""
    m = metadata(record)
    alarm = m.get("alarm") if isinstance(m.get("alarm"), dict) else {}
    site, when, kind = text(alarm.get("site")), plain_time(alarm.get("timestamp")), text(alarm.get("type"))
    if m.get("kind") != "ad_rt_event" or not (site and when and kind):
        return None
    # (every variable counts: the game explains an alarm only when it has exactly one)
    variables = [{"name": text(v.get("name")), "value": number(v.get("value")), "threshold": number(v.get("threshold"))}
                 for v in (alarm.get("variables") or [])[:3] if isinstance(v, dict)]
    # An AI alarm has no rule: the signal with the largest share drove it (the first, on a tie).
    contributions = alarm.get("top_feature_contributions")
    top = None
    if isinstance(contributions, dict):
        shares = {k: number(v) for k, v in contributions.items() if isinstance(k, str) and number(v) is not None}
        if shares:
            name = max(shares, key=lambda k: shares[k])
            top = {"name": name[:TEXT_MAX], "share": shares[name]}
    # The same alarm is often recorded several times: one with the same type, rule, time and signals
    # is the same alarm (as tools/build_game_data.py counts them).
    names = [v.get("name") for v in alarm.get("variables") or [] if isinstance(v, dict)]
    if not names and isinstance(contributions, dict):
        names = sorted(k for k in contributions if isinstance(k, str))
    return {
        "site": site,
        "key": json.dumps([kind, alarm.get("rule"), alarm.get("timestamp"), names], ensure_ascii=False),
        "timestamp": when,
        "type": kind,
        "rule": text(alarm.get("rule")),
        "variables": variables,
        "score": number(alarm.get("score")),
        "threshold": number(alarm.get("threshold")),
        "top_feature": top,
    }


# --------------------------------------------------------------------------- what is kept between runs

def empty_state() -> Dict[str, Any]:
    return {"version": STATE_VERSION, "cursors": {}, "risks": {}, "alarms": {}}


def add_records(state: Dict[str, Any], resource: str, records: List[Dict[str, Any]]) -> int:
    """Adds new records to what is kept; returns how many were of use."""
    used = 0
    if resource == "threat-contexts":
        for record in records:
            check = risk_check(record)
            if not check:
                continue
            kept = state["risks"].get(check["key"])
            if kept is None or check["evaluated_at"] >= kept["evaluated_at"]:
                state["risks"][check["key"]] = check
            used += 1
    elif resource == "events":
        for record in records:
            alarm = sensor_alarm(record)
            if not alarm:
                continue
            site = alarm.pop("site")
            alarms = {a["key"]: a for a in state["alarms"].get(site, [])}
            alarms.setdefault(alarm["key"], alarm)  # the first record of an alarm stays
            newest = sorted(alarms.values(), key=lambda a: (a["timestamp"], a["key"]), reverse=True)
            state["alarms"][site] = newest[:ALARMS_KEPT]
            used += 1
    return used


def read_new(resource: str, state: Dict[str, Any], fetch: Fetch, pause: float) -> List[Dict[str, Any]]:
    """The records added since the last run (all of them on the first), oldest first."""
    cursor = state["cursors"].get(resource) or {"page": 1, "last_id": 0, "total": 0}
    page, last_id = max(1, int(cursor["page"])), int(cursor["last_id"])
    found: List[Dict[str, Any]] = []
    for step in range(MAX_PAGES):
        if step:
            time.sleep(pause)
        body = fetch(f"{API}/{resource}?page={page}")
        meta = body.get("meta") if isinstance(body.get("meta"), dict) else {}
        last_page, total = int(meta.get("last_page") or 1), int(meta.get("total") or 0)
        if total < int(cursor["total"]) or last_page < int(cursor["page"]):
            raise Restart(resource)
        for record in body.get("data") or []:
            if isinstance(record, dict) and isinstance(record.get("id"), int) and record["id"] > last_id:
                found.append(record)
        if page >= last_page:
            break
        page += 1
    found.sort(key=lambda r: r["id"])
    new_last = max([last_id] + [r["id"] for r in found])
    # The last page is read again next time: it may have filled up since.
    state["cursors"][resource] = {"page": page, "last_id": new_last, "total": total}
    return found


def refresh(state: Dict[str, Any], fetch: Fetch = fetch_json, pause: float = PAUSE) -> Dict[str, int]:
    """Brings what is kept up to date with the API. Returns the count of useful new records."""
    counts = {}
    for resource in ("threat-contexts", "events"):
        try:
            records = read_new(resource, state, fetch, pause)
        except Restart:
            state["cursors"].pop(resource, None)
            state["risks" if resource == "threat-contexts" else "alarms"] = {}
            records = read_new(resource, state, fetch, pause)
        counts[resource] = add_records(state, resource, records)
    return counts


# --------------------------------------------------------------------------- the file the game reads

def published(state: Dict[str, Any], now: dt.datetime) -> Dict[str, Any]:
    sites: Dict[str, Dict[str, Any]] = {}
    by_pilot: Dict[str, List[Dict[str, Any]]] = {}
    for check in state["risks"].values():
        by_pilot.setdefault(check["pilot"], []).append(check)
    for pilot, checks in sorted(by_pilot.items()):
        newest = max(c["evaluated_at"] for c in checks)
        start = (dt.datetime.strptime(newest, "%Y-%m-%dT%H:%M:%SZ") - RUN_WINDOW).strftime("%Y-%m-%dT%H:%M:%SZ")
        run = sorted((c for c in checks if c["evaluated_at"] >= start), key=lambda c: c["key"])
        sites.setdefault(pilot, {})["risk"] = {
            "evaluated_at": newest,
            "scenarios": [{k: v for k, v in c.items() if k != "pilot"} for c in run],
        }
    for site, alarms in sorted(state["alarms"].items()):
        sites.setdefault(site, {})["alarms"] = [{k: v for k, v in a.items() if k != "key"} for a in alarms]
    return {
        "schema": SCHEMA,
        "source": "ARGUS API, " + API.rsplit("/api", 1)[0].split("//", 1)[1] + " (read-only)",
        "checked_at": now.astimezone(dt.timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sites": sites,
    }


def write_json(path: Path, data: Any) -> None:
    """Whole or not at all: a visitor never reads a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def load_state(path: Path) -> Dict[str, Any]:
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return empty_state()
    return state if isinstance(state, dict) and state.get("version") == STATE_VERSION else empty_state()


def main(argv: Optional[List[str]] = None, fetch: Fetch = fetch_json) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, required=True, help="folder for state.json and public/argus-now.json")
    args = parser.parse_args(argv)
    state_file, public_file = args.out / "state.json", args.out / "public" / "argus-now.json"
    state = load_state(state_file)
    try:
        counts = refresh(state, fetch)
    except Exception as exc:  # ARGUS unreachable or odd: keep the last good file, try again next run
        print(f"guardian-live: {exc}", file=sys.stderr)
        return 1
    write_json(state_file, state)
    data = published(state, dt.datetime.now(dt.timezone.utc))
    write_json(public_file, data)
    if any(counts.values()):
        newest = ", ".join(f"{p} {s['risk']['evaluated_at'][:16]}" for p, s in data["sites"].items() if "risk" in s)
        print(f"guardian-live: {counts['threat-contexts']} new checks, {counts['events']} new alarms; latest: {newest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
