"""Card-art tagging with a vision model: build Message Batch requests, collect, validate.

    python -m pipeline.art_tags build   [--scope default|all] [--oracle-ids FILE]
    python -m pipeline.art_tags submit  # needs ANTHROPIC_API_KEY
    python -m pipeline.art_tags collect <batch_id>
    python -m pipeline.art_tags ingest  <model_output.json>

Images are passed to the model as URLs (Scryfall's `art_crop`), so nothing is
downloaded here; the API fetches them. `--scope default` tags one illustration per
card (the printing in cards.jsonl, ~32k); `--scope all` tags every unique
illustration in art.jsonl (~48k), which lets the site pick the printing whose art
best fits a theme.

Output: data/art_tags_vision.jsonl, one row per illustration_id. This is a supplement:
the main art data comes from Scryfall Tagger (pipeline/tagger_art.py), which merges
these rows in to fill mood/palette gaps. Use `--only-missing` style selection by
passing a smaller art file if you only want to cover illustrations Tagger lacks.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

from .common import DATA, PROMPTS, ROOT, load_config, load_yaml, read_jsonl, write_jsonl
from .tagging import extract_json, prompt_hash

ART_VOCAB_PATH = ROOT / "vocab" / "art.yaml"
LIST_FIELDS = {"mood": (1, 2), "setting": (1, 2), "palette": (1, 3)}
ONE_FIELDS = ("lighting", "subject")


def load_art_vocab(path: Path = ART_VOCAB_PATH) -> dict:
    return load_yaml(path)


def render_art_vocab(av: dict) -> str:
    return "\n".join(f"- `{k}`: {', '.join(v)}" for k, v in av.items() if k != "version")


def system_prompt(av: dict) -> str:
    tpl = (PROMPTS / "tag_art.system.md").read_text(encoding="utf-8")
    return tpl.replace("{{ART_VOCAB_VERSION}}", av["version"]).replace("{{ART_VOCAB}}", render_art_vocab(av))


def select_illustrations(cards: list[dict], art: list[dict], scope: str) -> list[dict]:
    """Art is tagged once per illustration_id even if several cards share it."""
    if scope == "all":
        return list({a["illustration_id"]: a for a in art}.values())
    by_ill = {a["illustration_id"]: a for a in art}
    out = []
    for c in cards:
        a = by_ill.get(c.get("illustration_id"))
        if a:
            out.append(a)
    return out


def build_requests(items: list[dict], av: dict, cfg: dict) -> list[dict]:
    acfg = cfg["art"]
    system = system_prompt(av)
    n = acfg["images_per_request"]
    reqs = []
    for i in range(0, len(items), n):
        chunk = items[i:i + n]
        content = []
        for a in chunk:
            content.append({"type": "text", "text": json.dumps({
                "illustration_id": a["illustration_id"], "card": a["face_name"],
                "flavor_text": a.get("flavor_text")}, ensure_ascii=False)})
            content.append({"type": "image", "source": {"type": "url", "url": a["art_crop"]}})
        content.append({"type": "text", "text": f"Describe these {len(chunk)} artworks."})
        reqs.append({
            "custom_id": f"art-{i // n:06d}",
            "params": {
                "model": acfg["model"], "max_tokens": acfg["max_tokens"],
                "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                "messages": [{"role": "user", "content": content}],
            },
        })
    return reqs


def validate_art(raw: dict, item: dict, av: dict, meta: dict) -> dict:
    flags = []
    row = {"illustration_id": item["illustration_id"], "oracle_id": item["oracle_id"],
           "face_name": item["face_name"], "artist": item.get("artist")}
    for field, (lo, hi) in LIST_FIELDS.items():
        vals = raw.get(field) or []
        vals = [vals] if isinstance(vals, str) else vals
        good = [v for v in vals if v in av[field]]
        flags += [f"bad_{field}:{v}" for v in vals if v not in av[field]]
        if len(good) < lo:
            flags.append(f"missing_{field}")
        row[field] = good[:hi]
    for field in ONE_FIELDS:
        v = raw.get(field)
        if v not in av[field]:
            flags.append(f"bad_{field}:{v}")
            v = None
        row[field] = v
    row["motifs"] = [str(m).lower()[:40] for m in (raw.get("motifs") or [])][:5]
    row["description"] = (raw.get("description") or "")[:200]
    row["review_flags"] = flags
    row["meta"] = meta
    return row


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["build", "submit", "collect", "ingest"])
    ap.add_argument("arg", nargs="?")
    ap.add_argument("--cards", type=Path, default=DATA / "cards.jsonl")
    ap.add_argument("--art", type=Path, default=DATA / "art.jsonl")
    ap.add_argument("--scope", choices=["default", "all"], default=None)
    ap.add_argument("--out", type=Path, default=DATA / "art_tags_vision.jsonl")
    ap.add_argument("--requests", type=Path, default=DATA / "batch" / "art_requests.jsonl")
    args = ap.parse_args(argv)

    av, cfg = load_art_vocab(), load_config()
    scope = args.scope or cfg["art"]["scope"]
    art = read_jsonl(args.art)
    items = select_illustrations(read_jsonl(args.cards), art, scope)
    by_ill = {a["illustration_id"]: a for a in art}
    meta = {"model": cfg["art"]["model"], "art_vocab_version": av["version"],
            "prompt_hash": prompt_hash(system_prompt(av)), "tagged_at": dt.date.today().isoformat()}

    if args.cmd == "build":
        reqs = build_requests(items, av, cfg)
        write_jsonl(args.requests, reqs)
        print(f"{len(reqs)} requests for {len(items)} illustrations (scope={scope}) -> {args.requests}")
    elif args.cmd == "submit":
        import anthropic
        batch = anthropic.Anthropic().messages.batches.create(requests=read_jsonl(args.requests))
        print(f"submitted batch {batch.id}")
    elif args.cmd in ("collect", "ingest"):
        raws = []
        if args.cmd == "collect":
            import anthropic
            for res in anthropic.Anthropic().messages.batches.results(args.arg):
                if res.result.type == "succeeded":
                    text = "".join(b.text for b in res.result.message.content if b.type == "text")
                    try:
                        raws += extract_json(text)
                    except json.JSONDecodeError:
                        print(f"  ! unparseable {res.custom_id}")
        else:
            raws = json.loads(Path(args.arg).read_text(encoding="utf-8"))
        rows = [validate_art(r, by_ill[r["illustration_id"]], av, meta)
                for r in raws if r.get("illustration_id") in by_ill]
        write_jsonl(args.out, rows)
        print(f"{len(rows)} illustrations -> {args.out}; {sum(bool(r['review_flags']) for r in rows)} flagged")


if __name__ == "__main__":
    main()
