"""Build card-art tags from Scryfall Tagger's illustration tags (free, human-curated).

    python -m pipeline.tagger_art art-tags.jsonl [--art data/art.jsonl] [--out data/art_tags.jsonl]

Input: Tagger's bulk export (one tag per line: label, parent_ids, taggings[] of
illustration_id + weight). Output: one row per illustration in data/art.jsonl:

    motifs    Tagger labels on the art plus all their ancestors ("super mutant" also
              gives "mutant" and "fallout (universe)"), minus production/meta labels
    labels    the directly-applied labels with Tagger's weight (weak..very_strong)
    mood / setting / palette / lighting / subject
              our fixed art fields, derived through vocab/art_map.yaml
    source    "tagger" or "tagger+vision" when data/art_tags_vision.jsonl filled gaps

Themes match `motifs` directly, so a theme can ask for "power armor" or
"ghoul (fallout)" and hit exactly the cards Tagger's community tagged that way.
"""
from __future__ import annotations

import argparse
import collections
from pathlib import Path

from .common import DATA, ROOT, load_yaml, read_jsonl, write_jsonl

MAP_PATH = ROOT / "vocab" / "art_map.yaml"
FIELDS = ("mood", "setting", "palette", "lighting", "subject")
WEIGHT_ORDER = {"weak": 0, "median": 1, "strong": 2, "very_strong": 3}


def load_tagger(path: Path) -> tuple[dict, dict]:
    tags = read_jsonl(path)
    by_id = {t["id"]: t for t in tags}
    return tags, by_id


def ancestors(tag_id: str, by_id: dict, memo: dict) -> set[str]:
    if tag_id in memo:
        return memo[tag_id]
    memo[tag_id] = set()  # cycle guard
    out = set()
    for p in by_id[tag_id].get("parent_ids", []):
        if p in by_id:
            out.add(p)
            out |= ancestors(p, by_id, memo)
    memo[tag_id] = out
    return out


def invert_map(amap: dict) -> dict[str, list[tuple[str, str]]]:
    """label -> [(field, value)]"""
    inv = collections.defaultdict(list)
    for field in FIELDS:
        for value, labels in (amap.get(field) or {}).items():
            for lab in labels:
                inv[lab].append((field, value))
    return inv


def build_rows(tagger_path: Path, art: list[dict], amap: dict) -> list[dict]:
    tags, by_id = load_tagger(tagger_path)
    stop = set(amap.get("stoplist", []))
    inv = invert_map(amap)
    wanted = {a["illustration_id"] for a in art}
    direct: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    for t in tags:
        if t.get("type") != "illustration":
            continue
        for g in t["taggings"]:
            if g["illustration_id"] in wanted:
                direct[g["illustration_id"]].append((t["id"], g.get("weight", "median")))

    memo: dict = {}
    rows = []
    for ill, applied in direct.items():
        labels, motifs, raw = [], set(), []
        for tid, w in sorted(applied, key=lambda x: -WEIGHT_ORDER.get(x[1], 1)):
            lab = by_id[tid]["label"]
            raw.append(lab)
            if lab not in stop:
                labels.append({"label": lab, "weight": w})
                motifs.add(lab)
            motifs |= {by_id[a]["label"] for a in ancestors(tid, by_id, memo)} - stop
        derived = {f: [] for f in FIELDS}
        for lab in raw + sorted(motifs):   # raw: stoplisted labels like "solo" still inform subject
            for field, value in inv.get(lab, []):
                if value not in derived[field]:
                    derived[field].append(value)
        # a lone figure is a "creature" unless Tagger says it's human
        if not derived["subject"] and any(l in motifs for l in ("animal", "dragon", "beast", "monster")):
            derived["subject"] = ["creature"]
        rows.append({"illustration_id": ill, **derived, "motifs": sorted(motifs),
                     "labels": labels, "source": "tagger"})
    return rows


def merge_vision(rows: list[dict], vision: list[dict]) -> None:
    """Vision tags fill fields Tagger left empty (mostly mood and palette)."""
    by_ill = {v["illustration_id"]: v for v in vision}
    for r in rows:
        v = by_ill.get(r["illustration_id"])
        if not v:
            continue
        for f in FIELDS:
            vv = v.get(f)
            vv = [vv] if isinstance(vv, str) else (vv or [])
            if not r[f] and vv:
                r[f] = vv
        r["motifs"] = sorted(set(r["motifs"]) | set(v.get("motifs") or []))
        r["description"] = v.get("description")
        r["source"] = "tagger+vision"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("tagger_file", type=Path)
    ap.add_argument("--art", type=Path, default=DATA / "art.jsonl")
    ap.add_argument("--vision", type=Path, default=DATA / "art_tags_vision.jsonl")
    ap.add_argument("--out", type=Path, default=DATA / "art_tags.jsonl")
    args = ap.parse_args(argv)

    amap = load_yaml(MAP_PATH)
    art = read_jsonl(args.art)
    rows = build_rows(args.tagger_file, art, amap)
    if args.vision.exists():
        merge_vision(rows, read_jsonl(args.vision))
    rows.sort(key=lambda r: r["illustration_id"])
    write_jsonl(args.out, rows)
    n_art = len({a["illustration_id"] for a in art})
    filled = {f: sum(bool(r[f]) for r in rows) for f in FIELDS}
    print(f"{len(rows)} of {n_art} illustrations tagged -> {args.out}")
    print("  field coverage: " + ", ".join(f"{f} {100 * n // max(1, len(rows))}%" for f, n in filled.items()))


if __name__ == "__main__":
    main()
