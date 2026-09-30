"""Compare tag sets from different models on the same cards, including the effect on
actual recommendations (theme top-10s through the real engine).

    python tools/compare_models.py REF.jsonl A.jsonl [B.jsonl ...]
"""
import json
import math
import statistics
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(p):
    return {r["oracle_id"]: r for r in map(json.loads, open(p, encoding="utf-8"))}


def tagset(r, th=0.3):
    return {t["tag"] for t in r["tags"] if t["strength"] >= th and not t["tag"].startswith("typal:")}


def corr(xs, ys):
    mx, my = statistics.mean(xs), statistics.mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return num / math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))


def agree(A, B):
    ks = sorted(set(A) & set(B))
    jac = [len(tagset(A[k]) & tagset(B[k])) / max(1, len(tagset(A[k]) | tagset(B[k]))) for k in ks]
    qa = [A[k]["quality"] for k in ks]
    qb = [B[k]["quality"] for k in ks]
    return {"cards": len(ks), "tag_overlap": statistics.mean(jac), "quality_corr": corr(qa, qb),
            "quality_mae": statistics.mean(abs(a - b) for a, b in zip(qa, qb))}


def top10s(tags_path):
    js = f"""
import {{ readFileSync }} from "node:fs";
import {{ buildIndex, findByName, rankTheme }} from "{ROOT}/engine/score.mjs";
const rj = (p) => readFileSync(p, "utf8").split("\\n").filter(Boolean).map(JSON.parse);
const d = "{ROOT}/data/sample/";
const idx = buildIndex(rj(d + "pool_cards.jsonl"), rj("{tags_path}"), {{ rankCeiling: 32340,
  art: rj(d + "pool_art.jsonl"), artTags: rj(d + "pool_art_tags.jsonl") }});
const c = findByName(idx, "Agent Frank Horrigan");
const out = {{}};
for (const th of rj(d + "commander_themes.jsonl")[0].themes) out[th.name] = rankTheme(idx, c, th).slice(0, 10).map((r) => r.name);
console.log(JSON.stringify(out));
"""
    return json.loads(subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True).stdout)


def main(ref, *others):
    R = load(ref)
    sets = {Path(p).stem.replace("card_tags.", ""): load(p) for p in others}
    print(f"{'vs reference':<32}{'tag overlap':>12}{'quality r':>11}{'quality MAE':>13}{'tags/card':>11}{'q spread':>10}{'flagged':>9}")
    for name, S in sets.items():
        a = agree(R, S)
        tpc = statistics.mean(len(tagset(r, 0.15)) for r in S.values())
        spread = statistics.pstdev(r["quality"] for r in S.values())
        flagged = sum(bool(r["review_flags"]) for r in S.values())
        print(f"{name:<32}{a['tag_overlap']:>12.2f}{a['quality_corr']:>11.2f}{a['quality_mae']:>13.3f}{tpc:>11.1f}{spread:>10.3f}{flagged:>9}")
    print(f"{'reference (hand tags)':<32}{'':>12}{'':>11}{'':>13}{statistics.mean(len(tagset(r, .15)) for r in R.values()):>11.1f}{statistics.pstdev(r['quality'] for r in R.values()):>10.3f}")
    names = list(sets)
    if len(names) >= 2:
        a = agree(sets[names[0]], sets[names[1]])
        print(f"\n{names[0]} vs {names[1]}: tag overlap {a['tag_overlap']:.2f}, quality r {a['quality_corr']:.2f}, MAE {a['quality_mae']:.3f}")
    print("\nTheme top-10 overlap with the reference (same engine, same themes):")
    ref_top = top10s(ref)
    tops = {n: top10s(p) for n, p in zip(names, others)}
    for th in ref_top:
        row = "  ".join(f"{n}: {len(set(ref_top[th]) & set(tops[n][th]))}/10" for n in names)
        extra = ""
        if len(names) >= 2:
            extra = f"   | {names[0]} vs {names[1]}: {len(set(tops[names[0]][th]) & set(tops[names[1]][th]))}/10"
        print(f"  {th:<26} {row}{extra}")
    return tops


if __name__ == "__main__":
    main(*sys.argv[1:])
