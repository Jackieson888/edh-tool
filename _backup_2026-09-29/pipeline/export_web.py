"""Export per-commander data bundles for the website.

    python -m pipeline.export_web [--tags data/card_tags.jsonl ...] [--themes data/commander_themes.jsonl]

Writes web/data/commanders/<slug>.json (everything the engine needs to recommend for one
commander: its themes and every tagged card in its color identity, with printings and
art tags) plus web/data/commanders/index.json (the list the home page shows).

Only display/scoring fields are kept, so a bundle is a few MB instead of the ~110 MB of
raw pipeline files. The site loads a bundle on the server and runs engine/score.mjs on it.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from .common import DATA, ROOT, load_vocab, read_jsonl

WEB_DATA = ROOT / "web" / "data" / "commanders"

CARD_FIELDS = ["oracle_id", "name", "mana_cost", "cmc", "type_line", "types", "supertypes", "subtypes",
               "oracle_text", "power", "toughness", "color_identity", "commander_legal", "commander_eligible",
               "edhrec_rank", "game_changer", "price_usd", "image", "image_small", "art_crop", "artist",
               "scryfall_uri"]
# pool cards: only what scoring and the pick tiles use (the commander keeps CARD_FIELDS)
POOL_FIELDS = ["oracle_id", "name", "mana_cost", "type_line", "types", "supertypes", "color_identity",
               "commander_legal", "edhrec_rank", "game_changer", "price_usd", "image", "scryfall_uri"]
ART_FIELDS = ["illustration_id", "oracle_id", "face", "artist", "set", "image"]
ART_TAG_FIELDS = ["illustration_id", "mood", "setting", "palette", "lighting", "subject", "motifs"]


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def pick(d: dict, fields: list[str]) -> dict:
    # drop missing values but keep empty lists: color_identity [] means colorless, and the
    # engine reads supertypes/types unconditionally
    return {k: d[k] for k in fields if d.get(k) not in (None, "")}


def load_tags(paths: list[Path]) -> dict[str, dict]:
    """Later files win, so a re-tag of a card replaces the older row."""
    out: dict[str, dict] = {}
    for p in paths:
        for r in read_jsonl(p):
            out[r["oracle_id"]] = {"oracle_id": r["oracle_id"], "quality": r.get("quality"),
                                   "tags": [{k: t[k] for k in ("tag", "role", "strength") if k in t} for t in r["tags"]]}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--cards", type=Path, default=DATA / "cards.jsonl")
    ap.add_argument("--tags", type=Path, nargs="+", default=[DATA / "card_tags.jsonl"])
    ap.add_argument("--themes", type=Path, default=DATA / "commander_themes.jsonl")
    ap.add_argument("--art", type=Path, default=DATA / "art.jsonl")
    ap.add_argument("--art-tags", type=Path, default=DATA / "art_tags.jsonl")
    ap.add_argument("--out", type=Path, default=WEB_DATA)
    args = ap.parse_args(argv)

    cards = {c["oracle_id"]: c for c in read_jsonl(args.cards)}
    tags = load_tags(args.tags)
    meta_path = args.cards.parent / "meta.json"
    rank_ceiling = json.loads(meta_path.read_text())["max_edhrec_rank"] if meta_path.exists() else None

    art_by_card: dict[str, list[dict]] = {}
    for a in read_jsonl(args.art):
        if a["oracle_id"] in tags:
            art_by_card.setdefault(a["oracle_id"], []).append(pick(a, ART_FIELDS))
    wanted_ill = {a["illustration_id"] for rows in art_by_card.values() for a in rows}
    art_tags = {t["illustration_id"]: {k: v for k, v in pick(t, ART_TAG_FIELDS).items() if v != []}
                for t in read_jsonl(args.art_tags)
                if t["illustration_id"] in wanted_ill}

    args.out.mkdir(parents=True, exist_ok=True)
    listing = []
    for row in read_jsonl(args.themes):
        cmd = cards.get(row["oracle_id"])
        if not cmd or row["oracle_id"] not in tags:
            print(f"skip {row.get('name')}: commander not tagged")
            continue
        ci = set(cmd["color_identity"])
        pool = [c for oid, c in cards.items()
                if oid in tags and c.get("commander_legal") and set(c["color_identity"]) <= ci]
        pool_ids = {c["oracle_id"] for c in pool}
        art = [a for oid in pool_ids for a in art_by_card.get(oid, [])]
        bundle = {
            "commander": pick(cmd, CARD_FIELDS),
            "themes": [t for t in row["themes"] if t.get("status", "ok") == "ok"],
            "rankCeiling": rank_ceiling,
            "cards": [pick(c, POOL_FIELDS) for c in pool],
            "tags": [tags[oid] for oid in pool_ids],
            "art": art,
            "artTags": [art_tags[a["illustration_id"]] for a in art if a["illustration_id"] in art_tags],
        }
        slug = slugify(cmd["name"])
        path = args.out / f"{slug}.json"
        path.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        listing.append({"slug": slug, "name": cmd["name"], "oracle_id": cmd["oracle_id"],
                        "color_identity": cmd["color_identity"], "art_crop": cmd.get("art_crop"),
                        "image": cmd.get("image"), "artist": cmd.get("artist"),
                        "themes": [{"id": t["id"], "name": t["name"], "kind": t["kind"]} for t in bundle["themes"]],
                        "pool": len(pool)})
        print(f"{cmd['name']}: {len(pool)} cards, {len(art)} printings, {len(bundle['themes'])} themes "
              f"-> {path} ({path.stat().st_size / 1e6:.1f} MB)")
    vocab = load_vocab()
    (args.out.parent / "vocab.json").write_text(json.dumps(
        {"version": vocab["version"], "categories": vocab["categories"],
         "tags": {t["id"]: {"category": t["category"], "definition": t["definition"]} for t in vocab["tags"]}},
        ensure_ascii=False, indent=1), encoding="utf-8")
    (args.out / "index.json").write_text(json.dumps(listing, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
