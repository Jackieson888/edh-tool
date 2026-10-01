"""Which commanders do visitors want themes for?

    python -m pipeline.requested                  # table of the most-requested commanders without themes
    python -m pipeline.requested --top 15 --min 2 # only the top 15, with at least 2 requests
    python -m pipeline.requested --write          # also save the oracle ids for the theme builder

Reads the "Request themes" counts from the database (DATABASE_URL_UNPOOLED or DATABASE_URL, like
load_db). --write saves data/batch/ids_requested.json, which plugs straight into the pipeline:

    python -m pipeline.themes build --ids-file data/batch/ids_requested.json --requests data/batch/theme_requests.requested.jsonl
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import psycopg

from .common import DATA, load_dotenv


def main(argv=None):
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL"))
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--min", type=int, default=1, help="skip commanders with fewer requests than this")
    ap.add_argument("--write", nargs="?", const=str(DATA / "batch" / "ids_requested.json"), default=None,
                    help="save the oracle ids as JSON (default data/batch/ids_requested.json)")
    args = ap.parse_args(argv)
    if not args.url:
        ap.error("set DATABASE_URL or pass --url")

    with psycopg.connect(args.url) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT r.oracle_id, c.name, r.request_count, r.last_requested_at
                 FROM theme_requests r JOIN commanders c USING (oracle_id)
                WHERE (c.themes IS NULL OR jsonb_array_length(c.themes) = 0) AND r.request_count >= %s
                ORDER BY r.request_count DESC, r.last_requested_at DESC
                LIMIT %s""", (args.min, args.top))
        rows = cur.fetchall()

    if not rows:
        print("no pending requests")
        return
    width = max(len(r[1]) for r in rows)
    print(f"{'requests':>8}  {'commander':<{width}}  last requested")
    for _, name, n, last in rows:
        print(f"{n:>8}  {name:<{width}}  {last:%Y-%m-%d %H:%M}")
    if args.write:
        path = Path(args.write)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps([str(r[0]) for r in rows], indent=1), encoding="utf-8")
        print(f"\nwrote {len(rows)} ids -> {path}")


if __name__ == "__main__":
    main()
