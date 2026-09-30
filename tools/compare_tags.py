"""Compare two card-tag files (e.g. the API batch vs. the hand-tagged test pool).

    python tools/compare_tags.py data/sample/card_tags.jsonl data/sample/card_tags_api.jsonl

Reports, per card and overall: tags only in A / only in B, role disagreements, strength
and quality differences. Use it to judge a model before paying for all 32k cards.
"""
import json
import statistics
import sys


def load(p):
    return {r["oracle_id"]: r for r in map(json.loads, open(p, encoding="utf-8")) if r}


def tagmap(r, min_strength=0.3):
    return {t["tag"]: t for t in r["tags"] if t["strength"] >= min_strength and not t["tag"].startswith("typal:")}


def main(a_path, b_path):
    A, B = load(a_path), load(b_path)
    common = sorted(set(A) & set(B), key=lambda k: A[k]["name"])
    jacc, qdiff, sdiff, role_mis, rows = [], [], [], 0, []
    for k in common:
        ta, tb = tagmap(A[k]), tagmap(B[k])
        inter, union = set(ta) & set(tb), set(ta) | set(tb)
        jacc.append(len(inter) / len(union) if union else 1)
        if A[k]["quality"] is not None and B[k]["quality"] is not None:
            qdiff.append(B[k]["quality"] - A[k]["quality"])
        for t in inter:
            sdiff.append(abs(ta[t]["strength"] - tb[t]["strength"]))
            role_mis += ta[t]["role"] != tb[t]["role"]
        rows.append((jacc[-1], A[k]["name"], sorted(set(ta) - set(tb)), sorted(set(tb) - set(ta)),
                     A[k]["quality"], B[k]["quality"]))
    print(f"{len(common)} cards in both ({len(A)} in A, {len(B)} in B)")
    print(f"tag overlap (Jaccard, strength>=0.3): mean {statistics.mean(jacc):.2f}, median {statistics.median(jacc):.2f}")
    print(f"quality B-A: mean {statistics.mean(qdiff):+.2f}, mean abs {statistics.mean(map(abs, qdiff)):.2f}")
    print(f"shared tags: mean strength gap {statistics.mean(sdiff):.2f}, role disagreements {role_mis}/{len(sdiff)}")
    print("\nbiggest disagreements:")
    for j, name, only_a, only_b, qa, qb in sorted(rows)[:25]:
        print(f"  {j:.2f}  {name:<34} only A: {', '.join(only_a) or '-':<40} only B: {', '.join(only_b) or '-'}  q {qa}->{qb}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
