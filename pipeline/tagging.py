"""AI card tagging: build Message Batch requests, submit, collect, validate.

    python -m pipeline.tagging build   [--cards data/cards.jsonl] [--only NAME ...]
    python -m pipeline.tagging submit  # needs ANTHROPIC_API_KEY
    python -m pipeline.tagging collect <batch_id>
    python -m pipeline.tagging ingest  <responses.json>   # raw model JSON you got elsewhere

Output: data/card_tags.jsonl, one validated record per card. Every record carries
the model, vocab version and prompt hash it was produced with, so a later
re-tag can target only stale cards.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
from pathlib import Path

from .common import (DATA, PROMPTS, TYPAL_PREFIX, is_valid_tag, load_config,
                     load_vocab, read_jsonl, write_json, write_jsonl)
from .rules import creature_types_from, rule_tags

ROLES = {"enabler", "payoff", "both"}
ROLE_ALIASES = {"e": "enabler", "p": "payoff", "b": "both"}


# ---------------------------------------------------------------- prompts

def render_vocab(vocab: dict) -> str:
    lines = []
    for cat, desc in vocab["categories"].items():
        lines.append(f"## {cat} — {desc}")
        for t in vocab["tags"]:
            if t["category"] == cat:
                lines.append(f"- `{t['id']}`: {t['definition']} ENABLER: {t['enabler']} PAYOFF: {t['payoff']}")
        lines.append("")
    return "\n".join(lines).strip()


def system_prompt(name: str, vocab: dict) -> str:
    tpl = (PROMPTS / f"{name}.system.md").read_text(encoding="utf-8")
    out = tpl.replace("{{VOCAB_VERSION}}", vocab["version"]).replace("{{VOCAB}}", render_vocab(vocab))
    if "{{ART_VOCAB}}" in out:
        from .art_tags import load_art_vocab, render_art_vocab
        out = out.replace("{{ART_VOCAB}}", render_art_vocab(load_art_vocab()))
    return out


def prompt_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def card_payload(card: dict, hints: list[dict], ref: str | None = None,
                 tagger: list[dict] | None = None) -> dict:
    # A short per-request `ref` (c1..c8) instead of the 36-char oracle_id: models copy
    # long UUIDs back imperfectly, which once put one card's tags on another card.
    out = {
        "ref": ref or card["oracle_id"],
        "name": card["name"],
        "mana_cost": card["mana_cost"],
        "type_line": card["type_line"],
        "oracle_text": card["oracle_text"],
        "power_toughness": f"{card['power']}/{card['toughness']}" if card.get("power") else None,
        "keywords": card["keywords"],
        "rule_hints": sorted({h["tag"] for h in hints if not h["tag"].startswith(TYPAL_PREFIX)}),
        # human-curated (Scryfall Tagger), mapped to our tags with a suggested role
        "tagger_hints": [f"{h['tag']} ({h['role']})" for h in (tagger or [])],
    }
    return {k: v for k, v in out.items() if v not in (None, [], "")}  # empty fields cost tokens


def load_oracle_hints(path: Path = DATA / "oracle_hints.jsonl") -> dict[str, list[dict]]:
    """oracle_id -> Tagger-derived hints (pipeline/tagger_oracle.py); empty if not built."""
    if not path.exists():
        return {}
    return {r["oracle_id"]: r["hints"] for r in read_jsonl(path)}


def build_requests(cards: list[dict], vocab: dict, cfg: dict, creature_types: set[str],
                   oracle_hints: dict | None = None) -> list[dict]:
    tcfg = cfg["tagging"]
    system = system_prompt("tag_cards", vocab)
    reqs = []
    n = tcfg["cards_per_request"]
    for i in range(0, len(cards), n):
        chunk = cards[i:i + n]
        oh = oracle_hints or {}
        payload = [card_payload(c, rule_tags(c, creature_types), f"c{j + 1}", oh.get(c["oracle_id"]))
                   for j, c in enumerate(chunk)]
        reqs.append({
            "custom_id": f"tag-{i // n:06d}",
            "params": {
                "model": tcfg["model"],
                "max_tokens": tcfg["max_tokens"],
                # cache_control on the big shared system prompt: every request in the
                # batch reuses it, so the vocab is paid for ~once.
                "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                "messages": [{"role": "user", "content":
                              "Tag these cards:\n```json\n" + "[\n" + ",\n".join(json.dumps(p, ensure_ascii=False, separators=(",", ":")) for p in payload) + "\n]" + "\n```"}],
            },
        })
    return reqs


# ---------------------------------------------------------------- parsing / validation

def extract_json(text: str):
    """The model's JSON answer. Models occasionally emit an array, notice a mistake, and
    write a corrected array after it; the LAST complete top-level array wins. Falls back
    to one-object-per-line parsing when no array decodes (e.g. a truncated answer)."""
    fenced = re.findall(r"```(?:json)?\s*(.*?)```", text, re.S)
    if len(fenced) == 1:
        text = fenced[0]
    dec = json.JSONDecoder()
    found, i = [], 0
    while True:
        i = text.find("[", i)
        if i < 0:
            break
        try:
            val, end = dec.raw_decode(text, i)
        except json.JSONDecodeError:
            i += 1
            continue
        if isinstance(val, list) and val and isinstance(val[0], dict):
            found.append(val)
        i = end
    if found:
        return found[-1]
    rows = []
    for line in text.splitlines():
        line = line.strip().rstrip(",")
        if line.startswith("{"):
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    if rows:
        return rows
    start = min([i for i in (text.find("["), text.find("{")) if i >= 0], default=0)
    return json.loads(text[start:])  # raises with a useful message


def validate_card(raw: dict, card: dict, vocab: dict, creature_types: set[str], cfg: dict,
                  meta: dict, oracle_hints: dict | None = None) -> dict:
    tcfg = cfg["tagging"]
    flags: list[str] = []
    tags: dict[str, dict] = {}

    for t in raw.get("tags", []):
        if isinstance(t, (list, tuple)):  # compact form: [tag, role, strength]
            t = dict(zip(("tag", "role", "strength"), t))
        tag, role = t.get("tag"), t.get("role")
        role = ROLE_ALIASES.get(role, role)
        if not tag or not is_valid_tag(tag, vocab, creature_types | {"*"}):
            flags.append(f"unknown_tag:{tag}")
            continue
        if role not in ROLES:
            flags.append(f"bad_role:{tag}:{role}")
            role = "both"
        try:
            s = max(0.0, min(1.0, float(t.get("strength", 0.5))))
        except (TypeError, ValueError):
            s = 0.5
            flags.append(f"bad_strength:{tag}")
        if s < tcfg["min_strength_kept"]:
            continue
        prev = tags.get(tag)
        if prev:  # model listed a tag twice (e.g. once as enabler, once as payoff)
            prev["role"] = prev["role"] if prev["role"] == role else "both"
            prev["strength"] = max(prev["strength"], s)
            continue
        tags[tag] = {"tag": tag, "role": role, "strength": round(s, 2), "source": "llm"}
        if t.get("why"):  # older runs / hand tags carry a reason
            tags[tag]["why"] = t["why"][:120]

    # merge rule typal tags (type-line membership) the model didn't restate
    hints = rule_tags(card, creature_types)
    for h in hints:
        if h["tag"].startswith(TYPAL_PREFIX) and h["tag"] not in tags:
            s = tcfg["typal_member_strength"] if h["role"] == "enabler" else 0.6
            tags[h["tag"]] = {"tag": h["tag"], "role": h["role"], "strength": s,
                              "why": h["source"], "source": "rule"}

    # recall check: rule/Tagger hint the model neither kept nor explained
    dropped = {d if isinstance(d, str) else d.get("tag")
               for d in (raw.get("dropped") or raw.get("dropped_hints") or [])}
    for h in (oracle_hints or {}).get(card["oracle_id"], []):
        if not h["tag"].startswith(TYPAL_PREFIX) and h["tag"] not in tags and h["tag"] not in dropped:
            flags.append(f"missed_tagger:{h['tag']}")
    for h in hints:
        if not h["tag"].startswith(TYPAL_PREFIX) and h["tag"] not in tags and h["tag"] not in dropped:
            flags.append(f"missed_hint:{h['tag']}")

    try:
        quality = round(max(0.0, min(1.0, float(raw.get("quality")))), 2)
    except (TypeError, ValueError):
        quality = None
        flags.append("missing_quality")
    if not tags:
        flags.append("no_tags")

    return {
        "oracle_id": card["oracle_id"],
        "name": card["name"],
        "tags": sorted(tags.values(), key=lambda t: -t["strength"]),
        "quality": quality,
        "review_flags": flags,
        "meta": meta,
    }


def request_cards(req: dict, cards_by_name: dict) -> dict[str, dict]:
    """ref -> card for the cards inside one request (read back from its user message)."""
    content = req["params"]["messages"][0]["content"]
    payload = json.loads(content.split("```json\n", 1)[1].rsplit("```", 1)[0])
    return {p["ref"]: cards_by_name[p["name"]] for p in payload}


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def ingest_request(req: dict, model_output: list[dict], cards_by_name: dict, vocab, creature_types,
                   cfg, meta, oracle_hints: dict | None = None) -> tuple[list[dict], list[str]]:
    """Match each answer to its card by ref AND name; refuse rows that don't agree, and
    never accept two rows for one card. Returns (rows, problems)."""
    refs = request_cards(req, cards_by_name)
    by_norm = {_norm(c["name"]): c for c in refs.values()}
    rows, problems, used = [], [], set()
    for raw in model_output:
        card = refs.get(raw.get("ref"))
        if card is None or _norm(raw.get("name")) != _norm(card["name"]):
            alt = by_norm.get(_norm(raw.get("name")))
            if alt is None:
                problems.append(f"{req['custom_id']}: unmatched answer ref={raw.get('ref')} name={raw.get('name')!r}")
                continue
            if card is not None:
                problems.append(f"{req['custom_id']}: ref {raw.get('ref')} was {card['name']!r} but answer named "
                                f"{raw.get('name')!r}; matched by name")
            card = alt
        if card["oracle_id"] in used:
            problems.append(f"{req['custom_id']}: second answer for {card['name']!r} ignored")
            continue
        used.add(card["oracle_id"])
        rows.append(validate_card(raw, card, vocab, creature_types, cfg, meta, oracle_hints))
    for c in refs.values():
        if c["oracle_id"] not in used:
            problems.append(f"{req['custom_id']}: no answer for {c['name']!r}")
    return rows, problems


def ingest(model_output: list[dict], cards_by_id: dict, vocab, creature_types, cfg, meta,
           oracle_hints: dict | None = None) -> list[dict]:
    out = []
    for raw in model_output:
        card = cards_by_id.get(raw.get("oracle_id"))
        if not card:
            print(f"  ! response for unknown oracle_id {raw.get('oracle_id')}")
            continue
        out.append(validate_card(raw, card, vocab, creature_types, cfg, meta, oracle_hints))
    return out


# ---------------------------------------------------------------- CLI

def _load(cards_path: Path, colors: str | None = None):
    cards = read_jsonl(cards_path)
    # creature types are a property of the whole card pool, not of this subset
    full = DATA / "cards.jsonl"
    ctypes = creature_types_from(read_jsonl(full) if full.exists() and cards_path != full else cards)
    if colors is not None:  # e.g. "BG" -> cards whose color identity fits in B/G (colorless included)
        allowed = set(colors.upper())
        cards = [c for c in cards if set(c.get("color_identity") or []) <= allowed]
    return cards, {c["oracle_id"]: c for c in cards}, ctypes


def _finish(args, rows, failed, problems, cards, usage, n_requests=None) -> None:
    write_jsonl(args.out, rows)
    print(f"{len(rows)} cards tagged -> {args.out}; {len(failed)} failed requests")
    for cid, err in (failed if failed and isinstance(failed[0], tuple) else [(f, "failed") for f in failed]):
        print(f"  ! {cid}: {err}")
    for p in problems:
        print(f"  ~ {p}")
    got = {r["oracle_id"] for r in rows}
    requested = {c["oracle_id"] for c in cards}
    skipped = [c for c in cards if c["oracle_id"] not in got]
    if skipped and len(skipped) < len(requested):
        miss_path = args.out.with_name(args.out.stem + ".missing.jsonl")
        write_jsonl(miss_path, skipped)
        print(f"{len(skipped)} cards still without tags -> {miss_path} "
              f"(re-run: build --cards {miss_path}, then direct)")
    if usage is not None:
        print("usage: " + ", ".join(f"{k} {v:,}" for k, v in usage.items()))
        write_json(args.out.with_suffix(".usage.json"),
                   {"requests": n_requests, "failed": failed, "problems": problems, **usage})


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["build", "submit", "status", "collect", "direct", "ingest"])
    ap.add_argument("--concurrency", type=int, default=6, help="parallel requests for `direct`")
    ap.add_argument("--model", default=None, help="override config tagging.model for `build`")
    ap.add_argument("arg", nargs="?")
    ap.add_argument("--cards", type=Path, default=DATA / "cards.jsonl")
    ap.add_argument("--out", type=Path, default=DATA / "card_tags.jsonl")
    ap.add_argument("--requests", type=Path, default=DATA / "batch" / "tag_requests.jsonl")
    ap.add_argument("--colors", default=None,
                    help="only cards whose color identity fits in these colors, e.g. BG (colorless included)")
    ap.add_argument("--model-label", default=None, help="model name to record for `ingest`")
    ap.add_argument("--oracle-hints", type=Path, default=DATA / "oracle_hints.jsonl",
                    help="Tagger hints from pipeline.tagger_oracle (used if the file exists)")
    args = ap.parse_args(argv)

    vocab, cfg = load_vocab(), load_config()
    if args.model:
        cfg["tagging"]["model"] = args.model
    cards, by_id, ctypes = _load(args.cards, args.colors)
    by_name = {c["name"]: c for c in cards}
    oh = load_oracle_hints(args.oracle_hints)
    sys_text = system_prompt("tag_cards", vocab)
    meta = {"model": args.model_label or cfg["tagging"]["model"], "vocab_version": vocab["version"],
            "prompt_hash": prompt_hash(sys_text), "tagged_at": dt.date.today().isoformat()}

    if args.cmd == "build":
        reqs = build_requests(cards, vocab, cfg, ctypes, oh)
        if oh:
            print(f"Tagger hints attached for {sum(c['oracle_id'] in oh for c in cards)} of {len(cards)} cards")
        write_jsonl(args.requests, reqs)
        print(f"{len(reqs)} requests for {len(cards)} cards -> {args.requests}")
        print(f"system prompt ~{len(sys_text) // 4} tokens (cached), hash {meta['prompt_hash']}")

    elif args.cmd == "submit":
        import anthropic
        reqs = read_jsonl(args.requests)
        batch = anthropic.Anthropic().messages.batches.create(requests=reqs)
        print(f"submitted batch {batch.id} ({len(reqs)} requests)")
        with open(DATA / "batch" / "batches.log", "a", encoding="utf-8") as f:
            f.write(f"{dt.datetime.now().isoformat(timespec='seconds')}\t{batch.id}\t{args.requests}\t{len(reqs)}\n")
        print(f"check it with:  python -m pipeline.tagging status {batch.id}")

    elif args.cmd == "status":
        import anthropic
        b = anthropic.Anthropic().messages.batches.retrieve(args.arg)
        c = b.request_counts
        print(f"{b.id}: {b.processing_status} | processing {c.processing}, succeeded {c.succeeded}, "
              f"errored {c.errored}, canceled {c.canceled}, expired {c.expired}")
        if b.processing_status == "ended":
            print(f"collect with:   python -m pipeline.tagging collect {b.id} [--cards ... --out ...]")

    elif args.cmd == "collect":
        import anthropic
        client = anthropic.Anthropic()
        reqs_by_id = {r["custom_id"]: r for r in read_jsonl(args.requests)}
        rows, failed, problems = [], [], []
        usage = {"input": 0, "output": 0, "cache_write": 0, "cache_read": 0}
        for res in client.messages.batches.results(args.arg):
            if res.result.type != "succeeded":
                failed.append(res.custom_id)
                continue
            u = res.result.message.usage
            usage["input"] += u.input_tokens
            usage["output"] += u.output_tokens
            usage["cache_write"] += u.cache_creation_input_tokens or 0
            usage["cache_read"] += u.cache_read_input_tokens or 0
            text = "".join(b.text for b in res.result.message.content if b.type == "text")
            try:
                got, probs = ingest_request(reqs_by_id[res.custom_id], extract_json(text), by_name,
                                            vocab, ctypes, cfg, meta, oh)
                rows += got
                problems += probs
            except json.JSONDecodeError:
                failed.append(res.custom_id)
        # only the cards this batch asked for count as "missing"
        asked = [c for r in reqs_by_id.values() for c in request_cards(r, by_name).values()]
        _finish(args, rows, failed, problems, asked, usage, n_requests=len(reqs_by_id))

    elif args.cmd == "direct":
        # Same requests as the batch, sent immediately in parallel. Full price (a batch is
        # ~half), but done in minutes; meant for small runs and tests.
        import anthropic
        from concurrent.futures import ThreadPoolExecutor, as_completed
        client = anthropic.Anthropic(max_retries=4)
        reqs = read_jsonl(args.requests)
        usage = {"input": 0, "output": 0, "cache_write": 0, "cache_read": 0}

        def run(req):
            return req, client.messages.create(**req["params"])

        def run_all(batch_reqs):
            out, errs = [], []
            todo = list(batch_reqs)
            if todo:  # first request alone so it writes the prompt cache the rest can read
                first = todo.pop(0)
                try:
                    out.append(run(first))
                except Exception as e:  # noqa: BLE001
                    errs.append((first["custom_id"], str(e)[:200]))
            with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
                futs = {pool.submit(run, r): r["custom_id"] for r in todo}
                for f in as_completed(futs):
                    try:
                        out.append(f.result())
                    except Exception as e:  # noqa: BLE001
                        errs.append((futs[f], str(e)[:200]))
            return out, errs

        def absorb(results, rows, problems, failed):
            for req, msg in sorted(results, key=lambda x: x[0]["custom_id"]):
                u = msg.usage
                usage["input"] += u.input_tokens
                usage["output"] += u.output_tokens
                usage["cache_write"] += u.cache_creation_input_tokens or 0
                usage["cache_read"] += u.cache_read_input_tokens or 0
                text = "".join(b.text for b in msg.content if b.type == "text")
                try:
                    got, probs = ingest_request(req, extract_json(text), by_name, vocab, ctypes, cfg, meta, oh)
                    rows += got
                    problems += probs
                except json.JSONDecodeError:
                    failed.append((req["custom_id"], f"unparseable output (stop_reason={msg.stop_reason})"))

        rows, problems, failed = [], [], []
        results, errs = run_all(reqs)
        failed += errs
        absorb(results, rows, problems, failed)
        # cards with no accepted answer (skipped, mismatched, or failed request): retry once
        requested = [c for r in reqs for c in request_cards(r, by_name).values()]
        have = {r["oracle_id"] for r in rows}
        missing = [c for c in requested if c["oracle_id"] not in have]
        if missing:
            print(f"retrying {len(missing)} card(s) without an accepted answer: "
                  f"{', '.join(c['name'] for c in missing[:20])}{' ...' if len(missing) > 20 else ''}")
            retry = build_requests(missing, vocab, cfg, ctypes, oh)
            for r in retry:
                r["custom_id"] = "retry-" + r["custom_id"]
            results, errs = run_all(retry)
            failed += errs
            absorb(results, rows, problems, failed)
        _finish(args, rows, failed, problems, cards, usage, n_requests=len(reqs))

    elif args.cmd == "ingest":
        raw = json.loads(Path(args.arg).read_text(encoding="utf-8"))
        rows = ingest(raw, by_id, vocab, ctypes, cfg, meta, oh)
        write_jsonl(args.out, rows)
        flagged = [r for r in rows if r["review_flags"]]
        print(f"{len(rows)} cards -> {args.out}; {len(flagged)} with review flags")
        for r in flagged:
            print(f"  {r['name']}: {', '.join(r['review_flags'])}")


if __name__ == "__main__":
    main()
