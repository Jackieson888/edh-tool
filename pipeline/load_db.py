"""Load the catalog into Postgres (Neon or local).

    DATABASE_URL=postgres://... python -m pipeline.load_db   # prefers DATABASE_URL_UNPOOLED (Neon direct connection) [--schema-only] [--no-art]

Applies db/schema.sql, then refreshes the catalog tables from the pipeline files. Cards are
upserted (deck_cards reference them, so they are never truncated); tags, art and commanders
are replaced wholesale. Deck tables are never touched. Safe to re-run.
"""
from __future__ import annotations

import argparse
import json
import os
import unicodedata
from pathlib import Path

import psycopg

from .common import DATA, ROOT, load_dotenv, load_vocab, read_jsonl
from .export_web import slugify

COLOR_BIT = {"W": 1, "U": 2, "B": 4, "R": 8, "G": 16}
USABLE = ("ok", "relaxed", "fallback")
CARD_COLS = ["oracle_id", "name", "name_norm", "mana_cost", "cmc", "type_line", "types", "supertypes", "subtypes",
             "oracle_text", "power", "toughness", "color_identity", "ci_mask", "produced_mana", "keywords",
             "commander_legal", "commander_eligible", "edhrec_rank", "game_changer", "price_usd", "quality",
             "image", "image_small", "art_crop", "artist", "scryfall_uri"]


def ci_mask(ci) -> int:
    return sum(COLOR_BIT[c] for c in ci)


def norm(name: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKD", name) if not unicodedata.combining(ch)).lower()


def copy_rows(cur, table: str, cols: list[str], rows) -> int:
    n = 0
    with cur.copy(f"COPY {table} ({', '.join(cols)}) FROM STDIN") as cp:
        for r in rows:
            cp.write_row(r)
            n += 1
    return n


def main(argv=None):
    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL"))
    ap.add_argument("--cards", type=Path, default=DATA / "cards.jsonl")
    ap.add_argument("--tags", type=Path, nargs="+", default=[DATA / "card_tags.jsonl"])
    ap.add_argument("--themes", type=Path, default=DATA / "commander_themes.jsonl")
    ap.add_argument("--art", type=Path, default=DATA / "art.jsonl")
    ap.add_argument("--art-tags", type=Path, default=DATA / "art_tags.jsonl")
    ap.add_argument("--schema-only", action="store_true")
    ap.add_argument("--no-art", action="store_true")
    args = ap.parse_args(argv)
    if not args.url:
        ap.error("set DATABASE_URL or pass --url")

    with psycopg.connect(args.url, autocommit=False) as conn, conn.cursor() as cur:
        cur.execute((ROOT / "db" / "schema.sql").read_text())
        if args.schema_only:
            conn.commit()
            print("schema applied")
            return

        # ---- tags (later files win) ----
        tags: dict[str, dict] = {}
        for p in args.tags:
            for r in read_jsonl(p):
                tags[r["oracle_id"]] = r
        cards = [c for c in read_jsonl(args.cards) if c["oracle_id"] in tags and c.get("commander_legal")]
        by_id = {c["oracle_id"]: c for c in cards}

        # ---- vocab ----
        vocab = load_vocab()
        cur.execute("DELETE FROM tag_vocab")
        copy_rows(cur, "tag_vocab", ["tag", "category", "definition"],
                  [(t["id"], t["category"], t["definition"]) for t in vocab["tags"]])

        # ---- cards: upsert via a temp table ----
        cur.execute("CREATE TEMP TABLE cards_in (LIKE cards INCLUDING DEFAULTS) ON COMMIT DROP")
        rows = []
        for c in cards:
            price = c.get("price_usd")
            rows.append((c["oracle_id"], c["name"], norm(c["name"]), c.get("mana_cost"), c.get("cmc") or 0,
                         c["type_line"], c.get("types") or [], c.get("supertypes") or [], c.get("subtypes") or [],
                         c.get("oracle_text"), c.get("power"), c.get("toughness"), c["color_identity"],
                         ci_mask(c["color_identity"]), c.get("produced_mana") or [], c.get("keywords") or [],
                         True, bool(c.get("commander_eligible")), c.get("edhrec_rank"), bool(c.get("game_changer")),
                         float(price) if price not in (None, "") else None, tags[c["oracle_id"]].get("quality"),
                         c.get("image"), c.get("image_small"), c.get("art_crop"), c.get("artist"), c.get("scryfall_uri")))
        copy_rows(cur, "cards_in", CARD_COLS, rows)
        sets = ", ".join(f"{k} = EXCLUDED.{k}" for k in CARD_COLS[1:])
        cur.execute(f"INSERT INTO cards SELECT * FROM cards_in ON CONFLICT (oracle_id) DO UPDATE SET {sets}")
        print(f"cards: {len(rows)} upserted")

        # ---- card_tags: replaced wholesale ----
        cur.execute("DELETE FROM card_tags")
        n = copy_rows(cur, "card_tags", ["oracle_id", "tag", "role", "strength"],
                      [(oid, t["tag"], t["role"], t["strength"]) for oid, r in tags.items() if oid in by_id
                       for t in r["tags"]])
        print(f"card_tags: {n}")

        # ---- art ----
        cur.execute("DELETE FROM art_tags")
        cur.execute("DELETE FROM art")
        if not args.no_art:
            seen: set[str] = set()
            art_rows = []
            for a in read_jsonl(args.art):
                if a["oracle_id"] in by_id and a["illustration_id"] not in seen:
                    seen.add(a["illustration_id"])
                    art_rows.append((a["illustration_id"], a["oracle_id"], a.get("face"), a.get("artist"),
                                     a.get("set"), a.get("image"), len(art_rows)))
            copy_rows(cur, "art", ["illustration_id", "oracle_id", "face", "artist", "set_code", "image", "seq"], art_rows)
            n = copy_rows(cur, "art_tags",
                          ["illustration_id", "mood", "setting", "palette", "lighting", "subject", "motifs"],
                          [(t["illustration_id"], t.get("mood") or [], t.get("setting") or [], t.get("palette") or [],
                            t.get("lighting") or [], t.get("subject") or [], t.get("motifs") or [])
                           for t in read_jsonl(args.art_tags) if t["illustration_id"] in seen])
            print(f"art: {len(art_rows)}, art_tags: {n}")

        # ---- commanders ----
        meta = DATA / "meta.json"
        ceiling = json.loads(meta.read_text())["max_edhrec_rank"] if meta.exists() else None
        themes = {r["oracle_id"]: r for r in read_jsonl(args.themes)} if args.themes.exists() else {}
        cur.execute("DELETE FROM commanders")
        used_slugs: set[str] = set()
        cmd_rows = []
        for c in cards:
            if not c.get("commander_eligible"):
                continue
            slug = slugify(c["name"])
            if slug in used_slugs:                       # same name, different card
                slug = f"{slug}-{c['oracle_id'][:6]}"
            used_slugs.add(slug)
            row = themes.get(c["oracle_id"])
            good = [t for t in (row or {}).get("themes", []) if t.get("status", "ok") in USABLE]
            ctags = {t["tag"] for t in tags[c["oracle_id"]]["tags"] if t.get("strength", 0) >= 0.5}
            ctags |= {tt["tag"] for t in good for tt in t["tags"]}
            cmd_rows.append((c["oracle_id"], slug, c["name"], ci_mask(c["color_identity"]), sorted(ctags),
                             json.dumps(good) if good else None, row.get("status") if row else None, ceiling,
                             c.get("edhrec_rank") or 10**9))
        copy_rows(cur, "commanders", ["oracle_id", "slug", "name", "ci_mask", "tags", "themes", "themes_status",
                                      "rank_ceiling", "browse_key"], cmd_rows)
        print(f"commanders: {len(cmd_rows)} ({sum(1 for r in cmd_rows if r[5])} with themes)")
        conn.commit()


if __name__ == "__main__":
    main()
