"""Commander theme generation: build requests, validate output, check viability.

    python -m pipeline.themes build   [--only "Agent Frank Horrigan"] [--ids-file ids.json] [--all]
    python -m pipeline.themes submit  [--requests FILE]
    python -m pipeline.themes status  <batch_id>
    python -m pipeline.themes collect <batch_id>      # saves raw answers, then ingests
    python -m pipeline.themes ingest  <model_output.json | theme_results.<id>.jsonl> [--quiet]

`build` skips commanders that already have themes in --out (use --all to redo them) and, with
--ids-file, keeps only the oracle ids listed. `ingest` merges into --out by oracle_id.

Validation (every theme must pass or the commander is queued for regeneration):
  - every tag is in the vocab (or a real `typal:<Type>`)
  - 1-4 tags, weights in (0, 1], top weight normalized to 1.0
  - required mix of core / stretch themes
  - no two themes share their top-weighted tag
  - viability: enough legal, decent cards score >= viability_min_fit for the theme
    (computed by the JS engine so it uses exactly the production scoring)
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import subprocess
from pathlib import Path

from .common import (DATA, ROOT, TYPAL_PREFIX, is_valid_tag, load_config, load_vocab,
                     read_jsonl, write_json, write_jsonl)
from .rules import creature_types_from
from .tagging import extract_json, prompt_hash, system_prompt


def legal_for(card: dict, commander: dict) -> bool:
    return (card["commander_legal"] and card["oracle_id"] != commander["oracle_id"]
            and set(card["color_identity"]) <= set(commander["color_identity"]))


def tag_supply(commander: dict, cards: list[dict], tags_by_id: dict, min_strength: float) -> dict:
    """How many legal cards in the commander's colors carry each tag (by role)."""
    sup = collections.defaultdict(lambda: {"enabler": 0, "payoff": 0})
    for c in cards:
        t = tags_by_id.get(c["oracle_id"])
        if not t or not legal_for(c, commander):
            continue
        for x in t["tags"]:
            if x["strength"] < min_strength:
                continue
            for side in (["enabler", "payoff"] if x["role"] == "both" else [x["role"]]):
                sup[x["tag"]][side] += 1
    return dict(sorted(sup.items(), key=lambda kv: -(kv[1]["enabler"] + kv[1]["payoff"])))


def theme_request(commander: dict, cmd_tags: dict, supply: dict, vocab: dict, cfg: dict,
                  motif_rows: list[str] | None = None, n_legal: int | None = None) -> dict:
    tcfg = cfg["themes"]
    supply_rows = [f"{t}: {v['enabler']} enablers / {v['payoff']} payoffs" for t, v in list(supply.items())[:80]]
    payload = {
        "oracle_id": commander["oracle_id"],
        "name": commander["name"],
        "mana_cost": commander["mana_cost"],
        "type_line": commander["type_line"],
        "oracle_text": commander["oracle_text"],
        "flavor_text": commander.get("flavor_text"),
        "color_identity": commander["color_identity"],
        "commander_tags": [{k: x[k] for k in ("tag", "role", "strength")} for x in cmd_tags["tags"]],
    }
    return {
        "custom_id": f"themes-{commander['oracle_id']}",
        "params": {
            "model": tcfg["model"],
            "max_tokens": tcfg["max_tokens"],
            "system": [{"type": "text", "text": system_prompt("commander_themes", vocab),
                        "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content":
                          f"Design {tcfg['themes_per_commander']} themes for this commander.\n```json\n"
                          + json.dumps(payload, ensure_ascii=False, indent=1)
                          + "\n```\n"
                          + (f"Legal pool: {n_legal} cards. A theme is only shown if at least "
                             f"{tcfg['viability_min_cards']} decent cards fit it (a loose fit is allowed "
                             f"when the pool is small).\n" if n_legal else "")
                          + "tag_supply (legal cards in these colors):\n" + "\n".join(supply_rows)
                          + ("\n\nart_motif_supply (Scryfall Tagger art labels; legal cards in these colors whose art has it):\n"
                             + "\n".join(motif_rows) if motif_rows else "")}],
        },
    }


def clean_art(art, errors: list, name: str) -> dict | None:
    """Keep only art-direction values that exist in vocab/art.yaml."""
    if not isinstance(art, dict):
        return None
    from .art_tags import load_art_vocab
    av = load_art_vocab()
    out = {}
    for field, vals in art.items():
        vals = [vals] if isinstance(vals, str) else list(vals or [])
        if field == "motifs":
            good = [str(v).lower()[:40] for v in vals][:5]
        elif field in av and field != "version":
            good = [v for v in vals if v in av[field]][:3]
            bad = [v for v in vals if v not in av[field]]
            if bad:
                errors.append(f"{name}: dropped unknown art {field} {bad}")
        else:
            errors.append(f"{name}: unknown art field '{field}'")
            continue
        if good:
            out[field] = good
    return out or None


def validate_themes(raw: dict, vocab: dict, creature_types: set[str], cfg: dict) -> tuple[list[dict], list[str]]:
    errors, themes = [], []
    seen_top = {}
    for th in raw.get("themes", []):
        name = th.get("name", "?")
        tags = [t for t in th.get("tags", []) if isinstance(t, dict)]
        bad = [t.get("tag") for t in tags if not is_valid_tag(t.get("tag", ""), vocab, creature_types)]
        if bad:
            errors.append(f"{name}: unknown tags {bad}")
            continue
        if not 1 <= len(tags) <= 4:
            errors.append(f"{name}: needs 1-4 tags, has {len(tags)}")
            continue
        top_w = max(float(t.get("weight", 0)) for t in tags) or 1.0
        norm = []
        for t in tags:
            w = float(t.get("weight", 0)) / top_w
            if w <= 0:
                continue
            rf = t.get("role_focus", "any")
            norm.append({"tag": t["tag"], "weight": round(w, 2),
                         "role_focus": rf if rf in ("any", "enabler", "payoff") else "any"})
        norm.sort(key=lambda t: -t["weight"])
        top = norm[0]["tag"]
        if top in seen_top:
            errors.append(f"{name}: same top tag '{top}' as '{seen_top[top]}'")
            continue
        seen_top[top] = name
        slug = th.get("id") or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
        theme = {"id": slug, "name": name, "pitch": th.get("pitch", ""),
                 "kind": th.get("kind", "core"), "tags": norm}
        art = clean_art(th.get("art"), errors, name)
        if art:
            theme["art"] = art
        themes.append(theme)
    kinds = collections.Counter(t["kind"] for t in themes)
    if kinds["core"] < 2:
        errors.append(f"need >=2 core themes, got {kinds['core']}")
    if kinds["stretch"] < 1:
        errors.append(f"need >=1 stretch theme, got {kinds['stretch']}")
    return themes, errors


# ---------------------------------------------------------------- art motifs

def load_card_motifs(art_path: Path, art_tags_path: Path) -> dict[str, set[str]]:
    """oracle_id -> union of Tagger motifs across all of the card's printings."""
    if not (art_path.exists() and art_tags_path.exists()):
        return {}
    motifs_by_ill = {t["illustration_id"]: t.get("motifs", []) for t in read_jsonl(art_tags_path)}
    out: dict[str, set[str]] = collections.defaultdict(set)
    for a in read_jsonl(art_path):
        out[a["oracle_id"]] |= set(motifs_by_ill.get(a["illustration_id"], []))
    return out


def motif_supply(commander: dict, cards: list[dict], card_motifs: dict) -> collections.Counter:
    sup = collections.Counter()
    for c in cards:
        if legal_for(c, commander):
            sup.update(card_motifs.get(c["oracle_id"], ()))
    return sup


def motif_supply_rows(commander: dict, sup: collections.Counter, card_motifs: dict,
                      n_legal: int, top: int = 100) -> list[str]:
    """Distinctive art labels for the prompt: skip labels on >20% of legal cards
    (humanoid, weapon...), always include the commander's own art labels."""
    own = card_motifs.get(commander["oracle_id"], set())
    rows = [(m, n) for m, n in sup.most_common() if n <= 0.2 * n_legal and n >= 3][:top]
    listed = {m for m, _ in rows}
    rows += [(m, sup.get(m, 0)) for m in sorted(own) if m not in listed]
    return [f"{m}: {n}" for m, n in rows]


def motif_matches(motif: str, label: str) -> bool:
    """Same rule as engine/score.mjs motifMatches: whole label or whole-word run."""
    if motif == label:
        return True
    return re.search(rf"(^|[\s(]){re.escape(motif)}($|[\s)])", label) is not None


def extract_theme_json(text: str):
    """The model's theme object: the last fenced block if there is one, else the outermost {...}."""
    fenced = re.findall(r"```(?:json)?\s*(.*?)```", text, re.S)
    body = fenced[-1] if fenced else text[text.find("{"): text.rfind("}") + 1]
    return json.loads(body)


_LEGAL_CACHE: dict = {}


def _legal_labels(commander: dict, cards: list[dict], card_motifs: dict) -> list[set]:
    """Motif label sets of every card legal for the commander, cached per color identity."""
    key = (id(cards), tuple(sorted(commander["color_identity"])))
    if key not in _LEGAL_CACHE:
        ci = set(commander["color_identity"])
        _LEGAL_CACHE[key] = [card_motifs.get(c["oracle_id"], set()) for c in cards
                             if c["commander_legal"] and set(c["color_identity"]) <= ci]
    return _LEGAL_CACHE[key]


def check_motifs(themes: list[dict], commander: dict, cards: list[dict], card_motifs: dict,
                 min_cards: int, errors: list) -> None:
    """Drop art motifs too few legal cards carry; record supply (distinct cards) for the rest.
    Each motif is matched against the distinct labels once, then cards are counted by set overlap
    (the naive card x label x motif loop took hours over the full pool)."""
    legal = _legal_labels(commander, cards, card_motifs)
    distinct = set().union(*legal) if legal else set()
    for th in themes:
        art = th.get("art")
        if not art or not art.get("motifs"):
            continue
        kept, supply = [], {}
        for m in art["motifs"]:
            hit = {lab for lab in distinct if motif_matches(m, lab)}
            n = sum(1 for labs in legal if labs & hit)
            supply[m] = n
            if n >= min_cards:
                kept.append(m)
            else:
                errors.append(f"{th['name']}: art motif '{m}' dropped, only {n} legal cards")
        art["motifs"] = kept
        if not kept:
            del art["motifs"]
        th["art_supply"] = supply
        if not art:
            del th["art"]


def pretty_tag(tag: str) -> str:
    return tag[len(TYPAL_PREFIX):] if tag.startswith(TYPAL_PREFIX) else tag.replace("_", " ").capitalize()


USABLE = ("ok", "relaxed", "fallback")   # statuses the site shows
NOT_AN_ARCHETYPE = {"legends_matter", "keyword_soup", "modified"}


def fallback_themes(commander: dict, cmd_tags: dict, supply: dict, taken: set[str], want: int,
                    tcfg: dict, viability_fn) -> list[dict]:
    """Broad, plainly named themes from the tags this commander's pool is best supplied with.
    Used only when the model's themes leave a commander with fewer than the minimum: cards
    may fit loosely and be popular, but every commander gets something to build."""
    own = {t["tag"]: t["strength"] for t in cmd_tags["tags"]}
    cands = []
    for tag, v in supply.items():
        total = v["enabler"] + v["payoff"]
        if tag in taken or tag in NOT_AN_ARCHETYPE or total < tcfg["viability_relaxed_min_cards"] * 2:
            continue
        cands.append((total + 300 * own.get(tag, 0), tag))
    cands.sort(reverse=True)
    themes = []
    for _, tag in cands[: tcfg["fallback_candidates"]]:
        label = pretty_tag(tag)
        themes.append({"id": f"broad-{re.sub(r'[^a-z0-9]+', '-', tag.lower()).strip('-')}",
                       "name": f"{label} package", "kind": "core" if tag in own else "stretch",
                       "pitch": f"A straightforward {label.lower()} build: the best {label.lower()} cards your colors offer.",
                       "tags": [{"tag": tag, "weight": 1.0, "role_focus": "any"}]})
    if not themes:
        return []
    via = viability_fn(themes)
    good = [t for t in themes if via[t["id"]] >= tcfg["viability_relaxed_min_cards"]][:want]
    for t in good:
        t["viable_cards"], t["status"] = via[t["id"]], "fallback"
    return good


def ensure_min_themes(themes: list[dict], errors: list, commander: dict, cmd_tags: dict, supply: dict,
                      tcfg: dict, viability_fn) -> list[dict]:
    """Every commander gets at least `min_themes_per_commander` usable themes.
    1) relax: an unviable theme with at least `viability_relaxed_min_cards` cards is kept as
       `relaxed` (best first); 2) fallback: broad themes generated from the pool's supply."""
    need = tcfg["min_themes_per_commander"]
    usable = [t for t in themes if t["status"] == "ok"]
    # A commander's signature (core) archetype can be real but thinly supplied, e.g. Aurelia's extra
    # combats. Keep it as a "relaxed" theme (the site marks it "broad picks, looser fit") instead of
    # dropping it, as long as it has at least `viability_relaxed_min_cards` cards. Stretch themes
    # don't get this: a thin stretch is just filler.
    for t in themes:
        if (t["status"] == "rejected_unviable" and t.get("kind") == "core"
                and t["viable_cards"] >= tcfg["viability_relaxed_min_cards"]):
            t["status"] = "relaxed"
            usable.append(t)
            errors.append(f"{t['name']}: core theme kept as relaxed ({t['viable_cards']} cards)")
    if len(usable) < need:
        rejected = sorted((t for t in themes if t["status"] == "rejected_unviable"),
                          key=lambda t: -t["viable_cards"])
        for t in rejected:
            if len(usable) >= need:
                break
            if t["viable_cards"] >= tcfg["viability_relaxed_min_cards"]:
                t["status"] = "relaxed"
                usable.append(t)
                errors.append(f"{t['name']}: kept as relaxed ({t['viable_cards']} cards)")
    if len(usable) < need:
        taken = {t["tags"][0]["tag"] for t in themes if t["status"] != "rejected_unviable"}
        extra = fallback_themes(commander, cmd_tags, supply, taken, need - len(usable), tcfg, viability_fn)
        for t in extra:
            errors.append(f"{t['name']}: broad fallback theme added ({t['viable_cards']} cards)")
        themes = themes + extra
    return themes


def check_viability(commander_name: str, themes: list[dict], cards_path: Path, tags_path: Path,
                    min_fit: float, min_quality: float) -> dict:
    """Ask the JS engine (the production scorer) how many cards fit each theme."""
    tmp = DATA / "tmp_themes.json"
    write_json(tmp, themes)
    out = subprocess.run(
        ["node", str(ROOT / "engine" / "cli.mjs"), "viability",
         "--cards", str(cards_path), "--tags", str(tags_path), "--themes", str(tmp),
         "--commander", commander_name, "--min-fit", str(min_fit), "--min-quality", str(min_quality)],
        capture_output=True, text=True, check=True)
    tmp.unlink(missing_ok=True)
    return json.loads(out.stdout)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["build", "submit", "status", "collect", "ingest"])
    ap.add_argument("arg", nargs="?")
    ap.add_argument("--cards", type=Path, default=DATA / "cards.jsonl")
    ap.add_argument("--tags", type=Path, default=DATA / "card_tags.jsonl")
    ap.add_argument("--out", type=Path, default=DATA / "commander_themes.jsonl")
    ap.add_argument("--requests", type=Path, default=DATA / "batch" / "theme_requests.jsonl")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--ids-file", type=Path, default=None, help="JSON list of oracle ids to build")
    ap.add_argument("--all", action="store_true", help="build even commanders already in --out")
    ap.add_argument("--quiet", action="store_true", help="ingest: print only the summary")
    ap.add_argument("--min-cards", type=int, default=None, help="override viability_min_cards (small test pools)")
    ap.add_argument("--art", type=Path, default=DATA / "art.jsonl")
    ap.add_argument("--art-tags", type=Path, default=DATA / "art_tags.jsonl")
    ap.add_argument("--motif-cards", type=Path, default=None,
                    help="card file to count art-motif supply over (default: --cards). Use the full "
                         "data/cards.jsonl when --cards is a small test pool.")
    args = ap.parse_args(argv)

    vocab, cfg = load_vocab(), load_config()
    tcfg = cfg["themes"]
    cards = read_jsonl(args.cards)
    by_id = {c["oracle_id"]: c for c in cards}
    tags_by_id = {t["oracle_id"]: t for t in read_jsonl(args.tags)}
    ctypes = creature_types_from(cards)
    commanders = [c for c in cards if c["commander_eligible"] and c["oracle_id"] in tags_by_id
                  and (not args.only or c["name"] in args.only)]
    if args.ids_file:
        want = set(json.loads(args.ids_file.read_text(encoding="utf-8")))
        commanders = [c for c in commanders if c["oracle_id"] in want]
    if args.cmd == "build" and not args.all and args.out.exists():
        done = {r["oracle_id"] for r in read_jsonl(args.out)}
        skipped = sum(c["oracle_id"] in done for c in commanders)
        commanders = [c for c in commanders if c["oracle_id"] not in done]
        if skipped:
            print(f"skipping {skipped} commanders already in {args.out.name} (--all to redo)")
    motif_cards = read_jsonl(args.motif_cards) if args.motif_cards else cards
    card_motifs = load_card_motifs(args.art, args.art_tags)

    if args.cmd == "build":
        reqs = []
        for c in commanders:
            sup = tag_supply(c, cards, tags_by_id, tcfg["supply_min_strength"])
            msup = motif_supply(c, motif_cards, card_motifs)
            n_legal = sum(legal_for(x, c) for x in motif_cards)
            rows = motif_supply_rows(c, msup, card_motifs, n_legal) if card_motifs else None
            reqs.append(theme_request(c, tags_by_id[c["oracle_id"]], sup, vocab, cfg, rows, n_legal))
        write_jsonl(args.requests, reqs)
        print(f"{len(reqs)} theme requests -> {args.requests}")
        if len(reqs) == 1:
            print(reqs[0]["params"]["messages"][0]["content"])

    elif args.cmd == "submit":
        import datetime as dt
        import anthropic
        reqs = read_jsonl(args.requests)
        batch = anthropic.Anthropic().messages.batches.create(requests=reqs)
        print(f"submitted batch {batch.id} ({len(reqs)} requests)")
        with open(DATA / "batch" / "batches.log", "a", encoding="utf-8") as f:
            f.write(f"{dt.datetime.now().isoformat(timespec='seconds')}\t{batch.id}\t{args.requests}\t{len(reqs)}\n")
        print(f"check it with:  python -m pipeline.themes status {batch.id}")

    elif args.cmd == "status":
        import anthropic
        b = anthropic.Anthropic().messages.batches.retrieve(args.arg)
        c = b.request_counts
        print(f"{b.id}: {b.processing_status} | processing {c.processing}, succeeded {c.succeeded}, "
              f"errored {c.errored}, canceled {c.canceled}, expired {c.expired}")
        if b.processing_status == "ended":
            print(f"collect with:   python -m pipeline.themes collect {b.id}")

    elif args.cmd == "collect":
        import anthropic
        client = anthropic.Anthropic()
        b = client.messages.batches.retrieve(args.arg)
        if b.processing_status != "ended":
            raise SystemExit(f"batch {b.id} is still {b.processing_status}; try again later")
        saved, usage, failed = [], collections.Counter(), []
        for r in client.messages.batches.results(args.arg):
            if r.result.type != "succeeded":
                failed.append(r.custom_id)
                continue
            m = r.result.message
            u = m.usage
            usage.update(input=u.input_tokens, output=u.output_tokens,
                         cache_write=u.cache_creation_input_tokens or 0, cache_read=u.cache_read_input_tokens or 0)
            saved.append({"custom_id": r.custom_id, "type": "succeeded", "stop_reason": m.stop_reason,
                          "text": "".join(x.text for x in m.content if x.type == "text")})
        raw = DATA / "batch" / f"theme_results.{args.arg}.jsonl"
        write_jsonl(raw, saved)
        (DATA / "batch" / f"theme_results.{args.arg}.usage.json").write_text(
            json.dumps({"requests": len(saved), "failed": failed, **usage}, indent=1), encoding="utf-8")
        print(f"{len(saved)} answers saved -> {raw.name}" + (f"; {len(failed)} failed: {failed[:5]}" if failed else ""))
        print(f"tokens: {dict(usage)}")
        args.arg = str(raw)
        args.cmd = "ingest"

    if args.cmd == "ingest":
        src = Path(args.arg)
        if src.suffix == ".jsonl":
            raw_all = []
            for row in read_jsonl(src):
                if row.get("type") != "succeeded":
                    continue
                try:
                    d = extract_theme_json(row["text"])
                except (json.JSONDecodeError, ValueError):
                    print(f"unreadable answer for {row['custom_id']}")
                    continue
                if isinstance(d, dict):
                    d.setdefault("oracle_id", row["custom_id"].split("-", 1)[1])
                    raw_all.append(d)
        else:
            raw_all = json.loads(src.read_text(encoding="utf-8"))
            raw_all = raw_all if isinstance(raw_all, list) else [raw_all]
        min_cards = args.min_cards or tcfg["viability_min_cards"]
        rows = []
        for raw in raw_all:
            cmd = by_id[raw["oracle_id"]]
            themes, errors = validate_themes(raw, vocab, ctypes, cfg)
            if card_motifs:
                check_motifs(themes, cmd, motif_cards, card_motifs, tcfg["art_motif_min_cards"], errors)
            via = check_viability(cmd["name"], themes, args.cards, args.tags,
                                  tcfg["viability_min_fit"], 0.35)
            for th in themes:
                th["viable_cards"] = via[th["id"]]
                th["status"] = "ok"
                if via[th["id"]] < min_cards:
                    th["status"] = "rejected_unviable"
                    errors.append(f"{th['name']}: only {via[th['id']]} viable cards (< {min_cards})")
            themes = ensure_min_themes(
                themes, errors, cmd, tags_by_id[cmd["oracle_id"]],
                tag_supply(cmd, cards, tags_by_id, tcfg["supply_min_strength"]), tcfg,
                lambda ths: check_viability(cmd["name"], ths, args.cards, args.tags,
                                            tcfg["viability_relaxed_min_fit"], 0.35))
            n_ok = sum(th["status"] == "ok" for th in themes)
            n_usable = sum(th["status"] in USABLE for th in themes)
            status = "ok" if n_ok >= tcfg["themes_per_commander"] else (
                "partial" if n_usable >= tcfg["min_themes_per_commander"] else "needs_regeneration")
            rows.append({"oracle_id": cmd["oracle_id"], "name": cmd["name"], "themes": themes,
                         "status": status, "errors": errors,
                         "meta": {"model": tcfg["model"], "vocab_version": vocab["version"],
                                  "prompt_hash": prompt_hash(system_prompt("commander_themes", vocab))}})
            print(f"{cmd['name']}: {status}") if not args.quiet else None
            for th in themes if not args.quiet else []:
                tags = " · ".join(f"{t['tag']}({t['weight']})" for t in th["tags"])
                print(f"  [{th['kind']:7}] {th['name']:<28} {th['viable_cards']:>3} viable  {th['status']:<18} {tags}")
                if th.get("art_supply"):
                    print("            art motifs: " + ", ".join(f"{m} ({n} cards)" for m, n in th["art_supply"].items()))
            for e in errors if not args.quiet else []:
                print(f"  ! {e}")
        # merge by oracle_id: new rows replace old ones, everything else in --out is kept
        merged = {r["oracle_id"]: r for r in (read_jsonl(args.out) if args.out.exists() else [])}
        merged.update({r["oracle_id"]: r for r in rows})
        write_jsonl(args.out, list(merged.values()))
        by_status = collections.Counter(r["status"] for r in rows)
        print(f"ingested {len(rows)} commanders {dict(by_status)}; {args.out.name} now has {len(merged)}")


if __name__ == "__main__":
    main()
