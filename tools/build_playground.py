"""Bundle the real engine + a tagged card pool into one self-contained HTML page
for tuning weights by eye.

    python tools/build_playground.py [--cards data/sample/pool_cards.jsonl]
        [--tags data/sample/card_tags.jsonl] [--themes data/sample/commander_themes.jsonl]
        [--commander "Agent Frank Horrigan"] [--out out/playground.html]
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEEP = ["oracle_id", "name", "mana_cost", "type_line", "oracle_text", "power", "toughness",
        "supertypes", "types", "color_identity", "commander_legal", "edhrec_rank", "artist"]


def rj(p):
    return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]


def main():
    ap = argparse.ArgumentParser()
    d = ROOT / "data" / "sample"
    ap.add_argument("--cards", default=d / "pool_cards.jsonl")
    ap.add_argument("--tags", default=d / "card_tags.jsonl")
    ap.add_argument("--themes", default=d / "commander_themes.jsonl")
    ap.add_argument("--commander", default="Agent Frank Horrigan")
    ap.add_argument("--art", default=d / "pool_art.jsonl")
    ap.add_argument("--art-tags", default=d / "pool_art_tags.jsonl")
    ap.add_argument("--out", default=ROOT / "out" / "playground.html")
    a = ap.parse_args()

    cards = [{k: c.get(k) for k in KEEP} for c in rj(a.cards)]
    tags = [{"oracle_id": t["oracle_id"], "quality": t["quality"],
             "tags": [{k: x[k] for k in ("tag", "role", "strength")} for x in t["tags"]]} for t in rj(a.tags)]
    cmd_id = next(c["oracle_id"] for c in cards if c["name"] == a.commander)
    row = next(r for r in rj(a.themes) if r["oracle_id"] == cmd_id)
    themes = [t for t in row["themes"] if t.get("status", "ok") == "ok"] or row["themes"]
    meta = json.loads((ROOT / "data" / "meta.json").read_text())
    tag_model = rj(a.tags)[0]["meta"]["model"]

    art, art_tags = [], []
    if Path(a.art).exists() and Path(a.art_tags).exists():
        art = [{k: r.get(k) for k in ("oracle_id", "illustration_id", "set", "artist", "released_at")}
               for r in rj(a.art)]
        art_tags = [{k: r.get(k) for k in ("illustration_id", "mood", "setting", "palette", "lighting", "subject", "motifs")}
                    for r in rj(a.art_tags)]
    data = {"cards": cards, "tags": tags, "themes": themes, "commander": a.commander,
            "art": art, "artTags": art_tags,
            "rankCeiling": meta["max_edhrec_rank"], "meta": meta, "tagModel": tag_model}
    engine = (ROOT / "engine" / "score.mjs").read_text(encoding="utf-8")
    engine = re.sub(r"^export ", "", engine, flags=re.M)   # classic script: same code, no module wrapper
    html = (ROOT / "tools" / "playground.template.html").read_text(encoding="utf-8")
    html = html.replace("/*__DATA__*/", "window.BENCH_DATA = " + json.dumps(data, ensure_ascii=False).replace("</", "<\\/") + ";")
    html = html.replace("/*__ENGINE__*/", engine)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"{out} ({out.stat().st_size // 1024} KB, {len(cards)} cards, {len(themes)} themes)")


if __name__ == "__main__":
    main()
