#!/usr/bin/env python3
"""Fetch a fresh, complete snapshot from the ARGUS API into a new dated folder.

    python3 -I tools/fetch_snapshot.py                    # -> snapshot_<today>/
    python3 -I tools/fetch_snapshot.py --out snapshot_x   # another folder

Read-only: GET requests only, one page at a time with a short pause (the API returns 15
records per page and ignores page-size requests). Writes one file per resource in the same
layout as snapshot/: {resource, count, complete, fetched_at, records}. 'complete' is true
only when the number of records matches the API's own total.

The API answers without a token. If ARGUS_API_TOKEN is set in the environment it is sent as a
Bearer token; it is never printed or written anywhere. The original snapshot/ folder is never
touched: the tool refuses to write into an existing folder that already has files.
Standard library only, Python 3.9+. Needs internet.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "http://api.argusservices.athenarc.gr"  # 'Production' server in the ARGUS specs.json
USER_AGENT = "guardian-for-a-day/0.1 (ARGUS Open Innovation Challenge educational game)"
ATHENS = dt.timezone(dt.timedelta(hours=3))  # EEST until 25 Oct 2026

# What tools/build_game_data.py reads, plus threat-contexts (ARGUS risk evaluations per scenario).
RESOURCES = [
    "assets", "asset-states", "threats", "events", "threat-contexts", "policies",
    "installed-instruments", "installed-devices", "instruments", "instrument-types",
]


def get(path: str) -> Dict[str, Any]:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    token = os.environ.get("ARGUS_API_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(BASE_URL + path, headers=headers)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # network hiccup: wait and retry a few times
            if attempt == 3:
                raise RuntimeError(f"GET {path} failed: {exc}") from None
            time.sleep(2 * (attempt + 1))
    raise AssertionError("unreachable")


def fetch_resource(resource: str, delay: float) -> Dict[str, Any]:
    records: List[Dict[str, Any]] = []
    page, last_page, total = 1, 1, None
    while page <= last_page:
        body = get(f"/api/{resource}?page={page}")
        meta = body.get("meta") or {}
        last_page = int(meta.get("last_page") or 1)
        total = meta.get("total", total)
        records.extend(body.get("data") or [])
        print(f"\r  {resource}: page {page}/{last_page}, {len(records)} records", end="", flush=True)
        page += 1
        time.sleep(delay)
    print()
    unique = {r["id"]: r for r in records}  # pages can shift while new records arrive
    ordered = [unique[k] for k in sorted(unique)]
    return {
        "resource": resource,
        "count": len(ordered),
        "complete": total is not None and len(ordered) >= int(total),
        "fetched_at": dt.datetime.now(ATHENS).replace(microsecond=0).isoformat(),
        "records": ordered,
    }


def main(argv=None) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", type=Path, default=ROOT / f"snapshot_{dt.date.today().isoformat()}")
    parser.add_argument("--delay", type=float, default=0.25, help="seconds between requests")
    args = parser.parse_args(argv)
    out = args.out if args.out.is_absolute() else ROOT / args.out
    if out.resolve() == (ROOT / "snapshot").resolve() or (out.exists() and any(out.iterdir())):
        print(f"fetch_snapshot: refusing to write into {out} (exists or is the original snapshot)", file=sys.stderr)
        return 1
    out.mkdir(parents=True, exist_ok=True)
    incomplete = []
    for resource in RESOURCES:
        data = fetch_resource(resource, args.delay)
        (out / f"{resource}.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        if not data["complete"]:
            incomplete.append(resource)
    print(f"fetch_snapshot: wrote {len(RESOURCES)} files to {out.relative_to(ROOT)}"
          + (f"; INCOMPLETE: {', '.join(incomplete)}" if incomplete else "; all complete"))
    return 1 if incomplete else 0


if __name__ == "__main__":
    sys.exit(main())
