"""Turn Scryfall Tagger ORACLE tags into per-card hints in our tag vocabulary.

    python -m pipeline.tagger_oracle data/raw/oracle-tags.jsonl [--out data/oracle_hints.jsonl]

Output: one row per card:  {"oracle_id", "hints": [{"tag", "role", "labels": [...]}],
"labels": [raw Tagger labels]}. The tagging prompt receives these as human-curated
hints, and the validator flags any the model drops without saying why.
"""
from __future__ import annotations

import argparse
import collections
import re
from pathlib import Path

from .common import DATA, ROOT, TYPAL_PREFIX, load_vocab, load_yaml, read_jsonl, write_jsonl

MAP_PATH = ROOT / "vocab" / "oracle_map.yaml"


class OracleMapper:
    def __init__(self, omap: dict, vocab: dict, creature_types: set[str] | None = None):
        self.exact = omap.get("exact", {})
        self.patterns = [(re.compile(p), tag, role) for p, tag, role in omap.get("patterns", [])]
        self.vocab_ids = set(vocab["by_id"])
        self.creature_types = {t.lower(): t for t in (creature_types or set())}
        bad = {t for pairs in self.exact.values() for t, _ in pairs} - self.vocab_ids
        if bad:
            raise ValueError(f"oracle_map.yaml references unknown tags: {sorted(bad)}")

    def map_label(self, label: str) -> list[tuple[str, str]]:
        if label in self.exact:
            return [tuple(x) for x in self.exact[label]]
        for rx, tag, role in self.patterns:
            m = rx.search(label)
            if not m:
                continue
            if tag == "typal":
                t = self.creature_types.get(m.group(1).replace("-", " ").lower())
                return [(TYPAL_PREFIX + t, role)] if t else []
            return [(tag, role)]
        return []


def build_hints(tagger_path: Path, cards: list[dict], mapper: OracleMapper) -> list[dict]:
    wanted = {c["oracle_id"] for c in cards}
    labels: dict[str, list[str]] = collections.defaultdict(list)
    for t in read_jsonl(tagger_path):
        if t.get("type") != "oracle":
            continue
        for g in t["taggings"]:
            if g["oracle_id"] in wanted:
                labels[g["oracle_id"]].append(t["label"])
    rows = []
    for oid, labs in labels.items():
        merged: dict[str, dict] = {}
        for lab in sorted(set(labs)):
            for tag, role in mapper.map_label(lab):
                h = merged.setdefault(tag, {"tag": tag, "role": role, "labels": []})
                if h["role"] != role:
                    h["role"] = "both"
                h["labels"].append(lab)
        rows.append({"oracle_id": oid, "hints": sorted(merged.values(), key=lambda h: h["tag"]),
                     "labels": sorted(set(labs))})
    return rows


def main(argv=None):
    from .rules import creature_types_from
    ap = argparse.ArgumentParser()
    ap.add_argument("tagger_file", type=Path)
    ap.add_argument("--cards", type=Path, default=DATA / "cards.jsonl")
    ap.add_argument("--out", type=Path, default=DATA / "oracle_hints.jsonl")
    args = ap.parse_args(argv)
    cards = read_jsonl(args.cards)
    mapper = OracleMapper(load_yaml(MAP_PATH), load_vocab(), creature_types_from(cards))
    rows = build_hints(args.tagger_file, cards, mapper)
    write_jsonl(args.out, rows)
    with_hints = sum(bool(r["hints"]) for r in rows)
    print(f"{len(rows)} cards with Tagger labels, {with_hints} with at least one mapped hint "
          f"({100 * with_hints // max(1, len(cards))}% of {len(cards)}) -> {args.out}")


if __name__ == "__main__":
    main()
