"""python -m pytest tests/"""
from pipeline.common import load_config, load_vocab
from pipeline.load_scryfall import dedupe_printings, normalize, split_type_line
from pipeline.rules import creature_types_from, rule_tags
from pipeline.tagging import extract_json, render_vocab, validate_card
from pipeline.themes import validate_themes

VOCAB, CFG = load_vocab(), load_config()


def scry(**kw):
    base = {"oracle_id": "o1", "name": "Test Card", "type_line": "Creature — Phyrexian Rat",
            "oracle_text": "", "keywords": [], "color_identity": ["B"], "cmc": 2,
            "legalities": {"commander": "legal"}, "layout": "normal", "mana_cost": "{1}{B}"}
    base.update(kw)
    return base


def test_vocab_loads_and_renders():
    assert "infect" in VOCAB["by_id"]
    assert "## counters" in render_vocab(VOCAB)


def test_split_type_line_mdfc():
    sup, types, subs = split_type_line("Legendary Creature — Elf Druid // Legendary Land")
    assert sup == ["Legendary"] and "Land" in types and subs == ["Elf", "Druid"]


def test_dedupe_keeps_one_per_oracle_and_cheapest_price():
    rows = [scry(prices={"usd": "3.00"}, released_at="2020-01-01"),
            scry(prices={"usd": "0.50"}, released_at="2024-01-01", promo=True)]
    out = dedupe_printings(rows)
    assert len(out) == 1 and out[0]["prices"]["usd"] == "0.50"


def test_reminder_text_does_not_trigger_rules():
    c = normalize(scry(oracle_text="Infect (This creature deals damage to creatures in the form of -1/-1 counters.)",
                       keywords=["Infect"]))
    tags = {h["tag"] for h in rule_tags(c)}
    assert "infect" in tags and "minus1_counters" not in tags


def test_typal_token_maker_is_enabler_not_payoff():
    c = normalize(scry(type_line="Sorcery", oracle_text="Create two 2/2 black Zombie creature tokens."))
    zombie = next(h for h in rule_tags(c, {"Zombie"}) if h["tag"] == "typal:Zombie")
    assert zombie["role"] == "enabler"


def test_non_creature_subtypes_are_not_typal():
    cards = [normalize(scry(type_line="Kindred Enchantment — Elf Aura"))]
    assert creature_types_from(cards) == {"Elf"}


def test_validate_card_drops_unknown_and_flags_missed_hints():
    c = normalize(scry(oracle_text="Whenever this creature attacks, proliferate."))
    raw = {"oracle_id": "o1", "quality": 0.5,
           "tags": [{"tag": "made_up", "role": "enabler", "strength": 1},
                    {"tag": "proliferate", "role": "enabler", "strength": 0.9}]}
    out = validate_card(raw, c, VOCAB, {"Rat", "Phyrexian"}, CFG, {})
    got = {t["tag"] for t in out["tags"]}
    assert "made_up" not in got and "proliferate" in got and "typal:Rat" in got
    assert "unknown_tag:made_up" in out["review_flags"]
    assert "missed_hint:attack_triggers" in out["review_flags"]


def test_extract_json_handles_fences():
    assert extract_json('Sure!\n```json\n[{"a": 1}]\n```') == [{"a": 1}]


def test_theme_validation_rules():
    raw = {"themes": [
        {"name": "A", "kind": "core", "tags": [{"tag": "infect", "weight": 0.5}, {"tag": "proliferate", "weight": 0.25}]},
        {"name": "B", "kind": "core", "tags": [{"tag": "infect", "weight": 1}]},             # same top tag
        {"name": "C", "kind": "stretch", "tags": [{"tag": "nope", "weight": 1}]},            # unknown
        {"name": "D", "kind": "core", "tags": [{"tag": "typal:Mutant", "weight": 1}]},
    ]}
    themes, errors = validate_themes(raw, VOCAB, {"Mutant"}, CFG)
    assert [t["name"] for t in themes] == ["A", "D"]
    assert themes[0]["tags"][0]["weight"] == 1.0 and themes[0]["tags"][1]["weight"] == 0.5  # normalized
    assert any("same top tag" in e for e in errors) and any("unknown" in e for e in errors)
    assert any("stretch" in e for e in errors)


def test_art_records_split_double_faced_cards():
    from pipeline.load_scryfall import art_records
    card = scry(card_faces=[
        {"name": "Front", "illustration_id": "i1", "artist": "A", "image_uris": {"art_crop": "f.jpg", "normal": "fn.jpg"}},
        {"name": "Back", "illustration_id": "i2", "artist": "B", "image_uris": {"art_crop": "b.jpg", "normal": "bn.jpg"}}])
    rows = art_records(card)
    assert [(r["face"], r["illustration_id"], r["artist"]) for r in rows] == [(0, "i1", "A"), (1, "i2", "B")]


def test_art_tag_validation_keeps_only_vocab_values():
    from pipeline.art_tags import load_art_vocab, validate_art
    item = {"illustration_id": "i1", "oracle_id": "o1", "face_name": "X"}
    raw = {"mood": ["grim", "spooky"], "setting": "wasteland", "palette": ["sickly"], "lighting": "glowing",
           "subject": "horde", "motifs": ["Gas Mask"], "description": "d"}
    out = validate_art(raw, item, load_art_vocab(), {})
    assert out["mood"] == ["grim"] and out["setting"] == ["wasteland"] and out["motifs"] == ["gas mask"]
    assert "bad_mood:spooky" in out["review_flags"]


def test_theme_art_direction_is_validated():
    raw = {"themes": [
        {"name": "A", "kind": "core", "tags": [{"tag": "infect", "weight": 1}],
         "art": {"mood": ["grim", "cozy"], "setting": "wasteland", "motifs": ["Gas Mask"], "vibe": ["x"]}},
        {"name": "B", "kind": "core", "tags": [{"tag": "proliferate", "weight": 1}]},
        {"name": "C", "kind": "stretch", "tags": [{"tag": "rad_counters", "weight": 1}]}]}
    themes, errors = validate_themes(raw, VOCAB, set(), CFG)
    assert themes[0]["art"] == {"mood": ["grim"], "setting": ["wasteland"], "motifs": ["gas mask"]}
    assert "art" not in themes[1]
    assert any("cozy" in e for e in errors) and any("vibe" in e for e in errors)


def test_motif_supply_counts_distinct_cards_and_drops_thin_motifs():
    from pipeline.themes import check_motifs
    cmd = {"oracle_id": "c", "color_identity": ["B"], "commander_legal": True}
    cards = [{"oracle_id": f"x{i}", "color_identity": ["B"], "commander_legal": True} for i in range(12)]
    motifs = {f"x{i}": {"mutant", "super mutant"} for i in range(12)}   # both labels, one card each
    motifs["x0"] |= {"gas mask"}
    themes = [{"name": "T", "art": {"motifs": ["mutant", "gas mask"], "setting": ["wasteland"]}}]
    errors = []
    check_motifs(themes, cmd, cards, motifs, 10, errors)
    assert themes[0]["art_supply"] == {"mutant": 12, "gas mask": 1}   # 12 cards, not 24 label hits
    assert themes[0]["art"] == {"motifs": ["mutant"], "setting": ["wasteland"]}
    assert any("gas mask" in e for e in errors)


def test_tagger_ingest_rolls_up_ancestors_and_maps_fields(tmp_path):
    import json
    from pipeline.tagger_art import build_rows
    from pipeline.common import load_yaml, ROOT
    tags = [
        {"id": "m", "label": "mutant", "type": "illustration", "parent_ids": [], "taggings": []},
        {"id": "sm", "label": "super mutant", "type": "illustration", "parent_ids": ["m"],
         "taggings": [{"illustration_id": "i1", "weight": "strong"}]},
        {"id": "w", "label": "wasteland", "type": "illustration", "parent_ids": [],
         "taggings": [{"illustration_id": "i1", "weight": "median"}]},
        {"id": "sig", "label": "artist signature", "type": "illustration", "parent_ids": [],
         "taggings": [{"illustration_id": "i1", "weight": "median"}]},
    ]
    f = tmp_path / "t.jsonl"
    f.write_text("\n".join(json.dumps(t) for t in tags))
    rows = build_rows(f, [{"illustration_id": "i1", "oracle_id": "o"}], load_yaml(ROOT / "vocab" / "art_map.yaml"))
    r = rows[0]
    assert set(r["motifs"]) == {"super mutant", "mutant", "wasteland"}   # ancestor added, meta label dropped
    assert r["setting"] == ["wasteland"]


def test_ingest_request_matches_by_ref_and_name():
    import json as _json
    from pipeline.tagging import ingest_request
    a = normalize(scry(oracle_id="oa", name="Predator Ooze", oracle_text="Indestructible"))
    b = normalize(scry(oracle_id="ob", name="Predation Steward", oracle_text="oil counter"))
    payload = [{"ref": "c1", "name": a["name"]}, {"ref": "c2", "name": b["name"]}]
    req = {"custom_id": "tag-000001", "params": {"messages": [{"role": "user", "content":
           "Tag these cards:\n```json\n" + _json.dumps(payload) + "\n```"}]}}
    by_name = {a["name"]: a, b["name"]: b}
    raw = [  # model put Steward's answer under c1 and answered Ooze twice
        {"ref": "c1", "name": "Predation Steward", "quality": 0.25,
         "tags": [{"tag": "oil_counters", "role": "both", "strength": 0.7}]},
        {"ref": "c1", "name": "Predation Steward", "quality": 0.25, "tags": []},
    ]
    rows, problems = ingest_request(req, raw, by_name, VOCAB, set(), CFG, {})
    assert [r["name"] for r in rows] == ["Predation Steward"]          # matched by name, not ref
    assert any("matched by name" in p for p in problems)
    assert any("second answer" in p for p in problems)
    assert any("no answer for 'Predator Ooze'" in p for p in problems)  # so it gets retried


def test_oracle_mapper_exact_patterns_and_typal():
    from pipeline.common import ROOT, load_yaml
    from pipeline.tagger_oracle import OracleMapper
    m = OracleMapper(load_yaml(ROOT / "vocab" / "oracle_map.yaml"), VOCAB, {"Zombie", "Elf"})
    assert m.map_label("removal-toughness") == [("shrink", "enabler"), ("spot_removal", "enabler")]
    assert m.map_label("synergy-proliferate") == [("proliferate", "payoff")]
    assert m.map_label("typal-zombie") == [("typal:Zombie", "payoff")]
    assert m.map_label("typal-choose") == []
    assert m.map_label("tutor-land-basic") == [("tutor", "enabler")]
    assert m.map_label("alliteration") == []


def test_validate_card_accepts_compact_triples_and_dropped():
    c = normalize(scry(oracle_text="Whenever this creature attacks, proliferate."))
    raw = {"quality": 0.5, "tags": [["proliferate", "e", 0.9], ["made_up", "enabler", 1]],
           "dropped": ["attack_triggers"]}
    out = validate_card(raw, c, VOCAB, {"Rat", "Phyrexian"}, CFG, {})
    assert out["tags"][0] == {"tag": "proliferate", "role": "enabler", "strength": 0.9, "source": "llm"}
    assert "unknown_tag:made_up" in out["review_flags"]
    assert not any(f.startswith("missed_hint:attack") for f in out["review_flags"])


def test_extract_json_takes_last_corrected_array_and_line_fallback():
    text = ('[\n{"ref":"c1","name":"A","tags":[],"quality":0}\n]\n\nCorrection: the array above is invalid.\n\n'
            '[\n{"ref":"c1","name":"A","tags":[["ramp","enabler",0.6]],"quality":0.35}\n]')
    assert extract_json(text)[0]["quality"] == 0.35
    trunc = '[\n{"ref":"c1","name":"A","tags":[],"quality":0.2},\n{"ref":"c2","name":"B","ta'
    assert [r["ref"] for r in extract_json(trunc)] == ["c1"]


def test_every_commander_gets_min_themes_relaxed_then_fallback():
    from pipeline.themes import ensure_min_themes
    tcfg = CFG["themes"]
    cmd = {"oracle_id": "c"}
    cmd_tags = {"tags": [{"tag": "ramp", "role": "enabler", "strength": 0.6}]}
    supply = {"ramp": {"enabler": 90, "payoff": 0}, "card_draw": {"enabler": 60, "payoff": 0},
              "legends_matter": {"enabler": 500, "payoff": 0}, "tutor": {"enabler": 5, "payoff": 0}}
    mk = lambda i, via, st: {"id": i, "name": i, "kind": "core", "tags": [{"tag": i, "weight": 1.0}],
                             "viable_cards": via, "status": st}
    fake = lambda themes: {t["id"]: 50 for t in themes}

    # relax: best unviable theme above the relaxed floor is kept
    themes = [mk("infect", 30, "rejected_unviable"), mk("proliferate", 5, "rejected_unviable"),
              mk("protection", 20, "rejected_unviable")]
    out = ensure_min_themes(themes, [], cmd, cmd_tags, supply, tcfg, fake)
    assert {t["id"] for t in out if t["status"] == "relaxed"} == {"infect", "protection"}
    assert not any(t["status"] == "fallback" for t in out)

    # fallback: nothing usable -> broad themes from supply, never a non-archetype tag
    out = ensure_min_themes([mk("proliferate", 5, "rejected_unviable")], [], cmd, cmd_tags, supply, tcfg, fake)
    fb = [t for t in out if t["status"] == "fallback"]
    assert [t["tags"][0]["tag"] for t in fb] == ["ramp", "card_draw"]   # commander's own tag first
    assert all(t["viable_cards"] >= tcfg["viability_relaxed_min_cards"] for t in fb)


def test_load_db_helpers():
    from pipeline.load_db import ci_mask, norm
    assert ci_mask([]) == 0 and ci_mask(["B", "G"]) == 4 | 16 and ci_mask(list("WUBRG")) == 31
    assert norm("Lim-Dûl's Vault") == "lim-dul's vault"
