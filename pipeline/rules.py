"""Deterministic, high-precision tags from card text and keywords.

These run before the LLM for three reasons:
  1. They're fed to the model as hints, which makes its output more consistent.
  2. After the LLM runs, any rule tag the model dropped is flagged for review
     (cheap recall check across 30k cards).
  3. Typal tags are handled entirely here - the model doesn't need to know 300
     creature types.

Rules only say "this card involves tag X". Role (enabler/payoff) and strength
are the model's job, except where a rule is unambiguous.
"""
from __future__ import annotations

import re

from .common import TYPAL_PREFIX

# (tag, regex over lowercased oracle text, default role or None)
TEXT_RULES: list[tuple[str, str, str | None]] = [
    ("plus1_counters", r"\+1/\+1 counter", None),
    ("minus1_counters", r"-1/-1 counter|\bwither\b", None),
    ("proliferate", r"\bproliferate\b", "enabler"),
    ("infect", r"\binfect\b|\btoxic \d|\bpoisonous \d", None),
    ("infect", r"poison counter", None),
    ("rad_counters", r"\brad counter", None),
    ("oil_counters", r"\boil counter", None),
    ("shield_counters", r"\bshield counter", None),
    ("stun_counters", r"\bstun counter", None),
    ("experience_counters", r"\bexperience counter", None),
    ("energy", r"\{e\}|energy counter", None),
    ("counter_doubling", r"twice that many .*counters|that many plus one .*counters", "enabler"),  # not "an additional counter": that is plain +1/+1 counters
    ("counter_movement", r"\bmove (a|any number of|one or more) .*counters?", None),
    ("creature_tokens", r"create[s]? .*creature token", "enabler"),
    ("noncreature_tokens", r"create[s]? .*\b(treasure|clue|food|blood|map|powerstone|gold|incubator)\b token", "enabler"),
    ("treasure", r"\btreasure\b", None),
    ("token_doubling", r"twice that many .*tokens|create (that many|one) .*tokens? .*instead", "enabler"),
    ("self_mill", r"\bmill\b|\bsurveil\b", None),
    ("reanimation", r"return .* from (your|a) graveyard to the battlefield|put .* from (a|your) graveyard onto the battlefield", "payoff"),
    ("recursion", r"return .* from your graveyard to your hand", "payoff"),
    ("graveyard_size", r"\bthreshold\b|\bdelirium\b|\bdescend\b|cards? in your graveyard", None),
    ("sac_outlet", r"sacrifice (a|another) (creature|permanent|artifact)[^.]*:", "enabler"),
    ("death_trigger", r"whenever (a|another|one or more) .*(creature|creatures)[^.]* dies|whenever .* is put into a graveyard from the battlefield", "payoff"),
    ("edict", r"(each|target) (opponent|player) sacrifices", "enabler"),
    ("lifegain", r"gain[s]? .* life|\blifelink\b", None),
    ("drain", r"(each opponent|target opponent|target player) loses \d+ life|loses life equal", "enabler"),
    ("spellslinger", r"instant (or|and) sorcery spell", "payoff"),
    ("landfall", r"\blandfall\b|whenever a land (you control )?enters", "payoff"),
    ("ramp", r"add \{[wubrgc]\}|add .*mana of any|search your library for [^.]*(land|forest|plains|island|swamp|mountain) cards?[^.]* onto the battlefield", "enabler"),
    ("card_draw", r"draw (a|two|three|x|that many) cards?", "enabler"),
    ("tutor", r"search your library for (a|an|up to (one|two)) (?!basic land)(?!land)(?!(forest|plains|island|swamp|mountain))(?!.*(forest|plains|island|swamp|mountain) card)", "enabler"),
    ("counterspell", r"counter target", "enabler"),
    ("shrink", r"gets? (twice )?[-−](\d+|x)/[-−](\d+|x)", "enabler"),
    ("board_wipe", r"destroy all|exile all (creatures|nonland|permanents)|all creatures get -\d", "enabler"),
    ("spot_removal", r"(destroy|exile) target (creature|permanent|artifact|enchantment|nonland)|target creature gets -\d", "enabler"),
    ("blink", r"exile .* then return (it|them|that card) to the battlefield", "enabler"),
    ("attack_triggers", r"whenever .* attacks", "payoff"),
    ("combat_damage_triggers", r"deals combat damage to a player", "payoff"),
    ("extra_combat", r"additional combat phase", "enabler"),
    ("goad", r"\bgoad", "enabler"),
    ("equipment", r"\bequip\b|equipped creature", None),
    ("auras", r"enchanted creature|\baura\b", None),
    ("mutate", r"\bmutate\b", None),
    ("clones", r"copy of (target|a|another) (creature|permanent)|enter as a copy", "enabler"),
    ("untap", r"\buntap (target|all|another|each)", "enabler"),
    ("protection", r"\bhexproof\b|\bindestructible\b|\bphase[s]? out\b|protection from", None),
    ("etb_value", r"when .* enters", None),
    ("cost_reduction", r"costs? \{\d\} less|cost \{\d\} less", "enabler"),
    ("theft", r"gain control of", "enabler"),
    ("alt_wincon", r"you win the game|loses the game", "payoff"),
    ("politics", r"\bmonarch\b|\binitiative\b|\bvote\b|council's dilemma|will of the council", None),
]

KEYWORD_RULES: dict[str, tuple[str, str | None]] = {
    "Infect": ("infect", "enabler"),
    "Toxic": ("infect", "enabler"),
    "Poisonous": ("infect", "enabler"),
    "Proliferate": ("proliferate", "enabler"),
    "Trample": ("trample", "enabler"),
    "Flying": ("evasion", "enabler"),
    "Menace": ("evasion", "enabler"),
    "Shadow": ("evasion", "enabler"),
    "Horsemanship": ("evasion", "enabler"),
    "Wither": ("minus1_counters", "enabler"),
    "Persist": ("sac_fodder", "enabler"),
    "Undying": ("sac_fodder", "enabler"),
    "Lifelink": ("lifegain", "enabler"),
    "Flash": ("flash", "enabler"),
    "Mutate": ("mutate", "enabler"),
    "Landfall": ("landfall", "payoff"),
    "Evolve": ("plus1_counters", "payoff"),
    "Mentor": ("plus1_counters", "enabler"),
    "Modular": ("plus1_counters", "enabler"),
    "Graft": ("counter_movement", "enabler"),
    "Mill": ("self_mill", None),
    "Surveil": ("self_mill", "enabler"),
    "Cascade": ("cast_from_exile", "enabler"),
    "Goad": ("goad", "enabler"),
    "Hexproof": ("protection", "enabler"),
    "Indestructible": ("protection", "enabler"),
    "Ward": ("protection", "enabler"),
}

IRREGULAR_PLURALS = {
    "Elf": "Elves", "Dwarf": "Dwarves", "Wolf": "Wolves", "Werewolf": "Werewolves",
    "Mouse": "Mice", "Fungus": "Fungi", "Sphinx": "Sphinxes", "Fox": "Foxes",
    "Ox": "Oxen", "Octopus": "Octopi", "Cyclops": "Cyclopes", "Homunculus": "Homunculi",
    "Djinn": "Djinn", "Sheep": "Sheep", "Fish": "Fish", "Moonfolk": "Moonfolk",
    "Kithkin": "Kithkin", "Merfolk": "Merfolk", "Samurai": "Samurai", "Ninja": "Ninja",
}


# Subtypes that can sit on a creature/kindred type line but aren't creature types.
NON_CREATURE_SUBTYPES = {
    # land
    "Forest", "Island", "Swamp", "Mountain", "Plains", "Desert", "Gate", "Lair", "Locus",
    "Mine", "Power-Plant", "Tower", "Urza's", "Cave", "Sphere", "Town", "Planet",
    # artifact
    "Equipment", "Vehicle", "Food", "Treasure", "Clue", "Blood", "Gold", "Map", "Powerstone",
    "Incubator", "Fortification", "Contraption", "Attraction", "Junk", "Spacecraft", "Bobblehead",
    # enchantment
    "Aura", "Saga", "Shrine", "Cartouche", "Curse", "Rune", "Shard", "Class", "Case", "Room",
    "Role", "Background",
    # spell / other
    "Adventure", "Arcane", "Trap", "Lesson", "Omen", "Siege",
}


def creature_types_from(cards: list[dict]) -> set[str]:
    out: set[str] = set()
    for c in cards:
        for face in c["type_line"].split("//"):
            left, _, right = face.partition("—")
            if "Creature" in left or "Kindred" in left or "Tribal" in left:
                out.update(right.split())
    return out - NON_CREATURE_SUBTYPES


def _plural(t: str) -> str:
    if t in IRREGULAR_PLURALS:
        return IRREGULAR_PLURALS[t]
    if t.endswith(("s", "x", "ch", "sh")):
        return t + "es"
    if t.endswith("y") and t[-2:-1] not in "aeiou":
        return t[:-1] + "ies"
    return t + "s"


def typal_tags(card: dict, creature_types: set[str]) -> list[dict]:
    """member = the card IS that type; payoff = its text references that type."""
    out: dict[str, dict] = {}
    is_creatureish = any(t in card["types"] for t in ("Creature", "Kindred", "Tribal"))
    if is_creatureish:
        for st in card["subtypes"]:
            if st in creature_types:
                out[st] = {"tag": TYPAL_PREFIX + st, "role": "enabler", "source": "rule:type_line"}
    text = strip_reminder(card["oracle_text"] or "")
    # strip the card's own name so "Goblin Guide" doesn't read as Goblin-matters
    text = text.replace(card["name"], "CARDNAME")
    sentences = re.split(r"(?<=[.\n])", text)
    for t in creature_types:
        if len(t) < 3:
            continue
        word = re.compile(rf"\b({re.escape(t)}|{re.escape(_plural(t))})\b")
        hits = [s for s in sentences if word.search(s)]
        if not hits:
            continue
        # "create a 2/2 black Zombie creature token" makes Zombies; it doesn't reward them
        makes_only = all(re.search(r"\bcreate", s, re.I) and "token" in s.lower() for s in hits)
        if makes_only:
            if t not in out:
                out[t] = {"tag": TYPAL_PREFIX + t, "role": "enabler", "source": "rule:token"}
            continue
        role = "both" if t in out else "payoff"
        out[t] = {"tag": TYPAL_PREFIX + t, "role": role, "source": "rule:oracle"}
    if "Changeling" in card.get("keywords", []):
        out["*"] = {"tag": TYPAL_PREFIX + "*", "role": "enabler", "source": "rule:changeling"}
    return list(out.values())


def strip_reminder(text: str) -> str:
    """Drop reminder text: "(Infect ... -1/-1 counters ...)" would otherwise trip
    the -1/-1 rule on every infect creature."""
    return re.sub(r"\([^()]*\)", "", text)


def rule_tags(card: dict, creature_types: set[str] | None = None) -> list[dict]:
    text = strip_reminder(card.get("oracle_text") or "").lower()
    hits: dict[str, dict] = {}

    def add(tag, role, source):
        prev = hits.get(tag)
        if prev is None:
            hits[tag] = {"tag": tag, "role": role, "source": source}
        elif prev["role"] is None:
            prev["role"] = role

    for kw in card.get("keywords", []):
        if kw in KEYWORD_RULES:
            tag, role = KEYWORD_RULES[kw]
            add(tag, role, f"rule:keyword:{kw}")
    is_land = "Land" in card.get("types", [])
    for tag, pattern, role in TEXT_RULES:
        if is_land and tag in ("ramp", "etb_value"):
            continue  # every land "adds mana"/"enters"; that's not ramp or ETB value
        if re.search(pattern, text):
            add(tag, role, f"rule:text:{tag}")
    out = list(hits.values())
    if creature_types:
        out.extend(typal_tags(card, creature_types))
    return out
