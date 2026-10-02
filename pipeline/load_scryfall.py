"""Normalize a Scryfall bulk file ("Oracle Cards" or "Default Cards", .json or .jsonl) into data/cards.jsonl.

Usage:
    python -m pipeline.load_scryfall data/raw/oracle-cards-*.json [--out data/cards.jsonl]

Download the bulk file from https://scryfall.com/docs/api/bulk-data ("Oracle Cards",
one entry per unique card). Scryfall asks that you use bulk files rather than
hammering the API, and to re-download at most daily.

Only fields the tagger / scorer / site actually use are kept, so the output is
small and diffable. `source_updated` lets later stages detect changed cards.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from .common import DATA, write_json, write_jsonl

SKIP_LAYOUTS = {
    "token", "double_faced_token", "emblem", "art_series", "vanguard",
    "scheme", "planar", "augment", "host", "reversible_card",
}
SUPERTYPES = {"Legendary", "Basic", "Snow", "World", "Ongoing", "Host", "Elite"}


def _join_faces(card: dict, field: str) -> str | None:
    if card.get(field):
        return card[field]
    faces = card.get("card_faces") or []
    parts = [f.get(field) for f in faces if f.get(field)]
    return "\n//\n".join(parts) if parts else None


def split_type_line(type_line: str) -> tuple[list[str], list[str], list[str]]:
    """Return (supertypes, types, subtypes) across all faces."""
    sup, types, subs = [], [], []
    for face in type_line.split("//"):
        left, _, right = face.partition("—")
        for w in left.split():
            (sup if w in SUPERTYPES else types).append(w)
        subs.extend(right.split())
    dedupe = lambda xs: list(dict.fromkeys(xs))
    return dedupe(sup), dedupe(types), dedupe(subs)


def commander_eligible(card: dict, sup, types, oracle: str) -> bool:
    if card.get("legalities", {}).get("commander") != "legal":
        return False
    front = card["type_line"].split("//")[0]
    if "Legendary" in front and "Creature" in front:
        return True
    if re.search(r"can be your commander", oracle or "", re.I):
        return True
    # Legendary vehicles/spacecraft with P/T became eligible in 2025 rules updates.
    if "Legendary" in front and ("Vehicle" in front or "Spacecraft" in front) and card.get("power"):
        return True
    return False


def normalize(card: dict) -> dict | None:
    if card.get("layout") in SKIP_LAYOUTS or "Stickers" in (card.get("type_line") or ""):
        return None
    # EDH = Commander: only cards legal in the format are kept (banned and not-legal cards,
    # tokens, un-cards, etc. never enter the dataset).
    if card.get("legalities", {}).get("commander") != "legal":
        return None
    oracle = _join_faces(card, "oracle_text") or ""
    type_line = card.get("type_line") or _join_faces(card, "type_line") or ""
    card = {**card, "type_line": type_line}
    sup, types, subs = split_type_line(type_line)
    faces = card.get("card_faces") or []
    return {
        "oracle_id": card["oracle_id"],
        "name": card["name"],
        "mana_cost": card.get("mana_cost") or _join_faces(card, "mana_cost") or "",
        "cmc": card.get("cmc", 0),
        "type_line": type_line,
        "supertypes": sup,
        "types": types,
        "subtypes": subs,
        "oracle_text": oracle,
        "flavor_text": _join_faces(card, "flavor_text"),
        "keywords": card.get("keywords", []),
        "power": card.get("power") or (faces[0].get("power") if faces else None),
        "toughness": card.get("toughness") or (faces[0].get("toughness") if faces else None),
        "colors": card.get("colors") or sorted({c for f in faces for c in f.get("colors", [])}),
        "color_identity": card.get("color_identity", []),
        "produced_mana": card.get("produced_mana", []),
        "commander_legal": card["legalities"]["commander"] == "legal",
        "commander_eligible": commander_eligible(card, sup, types, oracle),
        "game_changer": bool(card.get("game_changer", False)),
        "edhrec_rank": card.get("edhrec_rank"),
        "price_usd": (card.get("prices") or {}).get("usd"),
        "layout": card.get("layout"),
        "released_at": card.get("released_at"),
        # Images of the representative printing. Every other printing's art is in art.jsonl.
        "image": _front_images(card).get("normal"),
        "image_small": _front_images(card).get("small"),
        "art_crop": _front_images(card).get("art_crop"),
        "artist": card.get("artist") or (faces[0].get("artist") if faces else None),
        "illustration_id": card.get("illustration_id") or (faces[0].get("illustration_id") if faces else None),
        "scryfall_uri": card.get("scryfall_uri"),
    }


def _front_images(card: dict) -> dict:
    faces = card.get("card_faces") or []
    return card.get("image_uris") or (faces[0].get("image_uris") if faces else None) or {}


def art_records(card: dict) -> list[dict]:
    """One row per illustration on this printing (two for double-faced cards).
    Art-based themes need these: the same card can have very different art across
    printings, and a player may care which one they're looking at."""
    faces = card.get("card_faces") or []
    sources = [(0, card)] if card.get("image_uris") else list(enumerate(faces))
    out = []
    for face_idx, src in sources:
        ill = src.get("illustration_id") or card.get("illustration_id")
        imgs = src.get("image_uris") or {}
        if not ill or not imgs.get("art_crop"):
            continue
        out.append({
            "illustration_id": ill,
            "oracle_id": card["oracle_id"],
            "face": face_idx,
            "face_name": src.get("name", card["name"]),
            "artist": src.get("artist") or card.get("artist"),
            "set": card.get("set"),
            "collector_number": card.get("collector_number"),
            "released_at": card.get("released_at"),
            "art_crop": imgs.get("art_crop"),
            "image": imgs.get("normal"),
            "image_small": imgs.get("small"),
            "frame": card.get("frame"),
            "full_art": card.get("full_art", False),
            "border_color": card.get("border_color"),
            "promo": card.get("promo", False),
            "digital": card.get("digital", False),
            "flavor_text": src.get("flavor_text") or card.get("flavor_text"),
        })
    return out


def iter_bulk(path: Path):
    """Scryfall bulk files come as a JSON array (.json) or one card per line (.jsonl)."""
    with open(path, encoding="utf-8") as f:
        first = f.read(1)
        f.seek(0)
        if first == "[":
            yield from json.load(f)
        else:
            for line in f:
                line = line.strip().rstrip(",")
                if line and line not in ("[", "]"):
                    yield json.loads(line)


def is_paper(c: dict) -> bool:
    """Printed on paper at some point. Digital-only sets (Alchemy, "Through the Omenpaths") are MTGO/Arena
    only, and sometimes re-skin a paper card under another name, so the site ignores them."""
    return "paper" in (c.get("games") or ["paper"])


def _printing_rank(c: dict) -> tuple:
    """Higher is better: which printing represents the card (flavor text, image)."""
    return (
        is_paper(c),                     # paper printings first
        c.get("lang", "en") == "en",     # then English: the site shows English card art
        not c.get("digital", False),
        c.get("set_type") not in ("funny", "memorabilia", "token", "minigame", "alchemy"),
        not c.get("promo", False),
        c.get("border_color") == "black",
        c.get("released_at") or "",
    )


def dedupe_printings(cards, art_sink: dict | None = None) -> list[dict]:
    """Default/All Cards have one row per printing; collapse to one per oracle_id.
    Oracle-level fields (text, legality, edhrec_rank) are identical across printings;
    price becomes the cheapest printing's USD price. If `art_sink` is given, every
    unique (card, illustration) pair is collected into it. The same illustration can
    appear on different cards (Alchemy rebalances, promos), so the key includes oracle_id."""
    best: dict[str, dict] = {}
    cheapest: dict[str, float] = {}
    for c in cards:
        oid = c.get("oracle_id") or (c.get("card_faces") or [{}])[0].get("oracle_id")
        if not oid:
            continue
        c["oracle_id"] = oid
        if art_sink is not None and c.get("lang", "en") == "en" and is_paper(c):   # English paper art only
            for a in art_records(c):
                key = (a["oracle_id"], a["illustration_id"])
                prev = art_sink.get(key)
                # keep the earliest paper printing as the canonical home of an illustration
                if prev is None or (prev["digital"], prev["released_at"] or "") > (a["digital"], a["released_at"] or ""):
                    art_sink[key] = a
        usd = (c.get("prices") or {}).get("usd")
        if usd:
            cheapest[oid] = min(cheapest.get(oid, 1e9), float(usd))
        if oid not in best or _printing_rank(c) > _printing_rank(best[oid]):
            best[oid] = c
    for oid, c in best.items():
        if oid in cheapest:
            c.setdefault("prices", {})["usd"] = f"{cheapest[oid]:.2f}"
    return [c for c in best.values() if is_paper(c)]    # cards that never had a paper printing are dropped


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("bulk_file", type=Path)
    ap.add_argument("--out", type=Path, default=DATA / "cards.jsonl")
    args = ap.parse_args(argv)

    art: dict[str, dict] = {}
    raw = dedupe_printings(iter_bulk(args.bulk_file), art_sink=art)
    rows = [n for c in raw if (n := normalize(c))]
    rows.sort(key=lambda r: r["name"])
    write_jsonl(args.out, rows)
    keep = {r["oracle_id"] for r in rows}
    art_rows = sorted((a for a in art.values() if a["oracle_id"] in keep),
                      key=lambda a: (a["oracle_id"], a["released_at"] or ""))
    write_jsonl(args.out.parent / "art.jsonl", art_rows)
    print(f"{len(art_rows)} unique illustrations -> {args.out.parent / 'art.jsonl'}")
    n_cmd = sum(r["commander_eligible"] for r in rows)
    # Global stats the engine needs even when it only loads a subset of cards
    # (e.g. obscurity = edhrec_rank / max rank across ALL cards).
    ranks = [r["edhrec_rank"] for r in rows if r["edhrec_rank"]]
    write_json(args.out.parent / "meta.json", {
        "source": args.bulk_file.name, "cards": len(rows), "commanders": n_cmd,
        "max_edhrec_rank": max(ranks) if ranks else None, "ranked_cards": len(ranks),
    })
    print(f"{len(rows)} cards -> {args.out} ({n_cmd} commander-eligible)")


if __name__ == "__main__":
    main()
