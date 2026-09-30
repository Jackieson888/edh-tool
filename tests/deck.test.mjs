// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../engine/score.mjs";
import { activeThemeIds, deckRecommendations, deckThemeProfile, suggestCommanders } from "../engine/deck.mjs";

const card = (name, ci, rank = 5000, extra = {}) => ({
  oracle_id: name, name, color_identity: ci, commander_legal: true, supertypes: [], types: ["Creature"],
  type_line: "Creature — Test", edhrec_rank: rank, ...extra,
});
const tagrow = (name, quality, tags) => ({
  oracle_id: name, quality, tags: tags.map(([tag, role, strength]) => ({ tag, role, strength })),
});

const cards = [
  card("Horrigan", ["B", "G"], 3000, { supertypes: ["Legendary"] }),
  card("Mono Black Cmdr", ["B"], 3000, { supertypes: ["Legendary"] }),
  card("Drown", ["B"], 4000),
  card("Toxin 1", ["G"], 6000),
  card("Toxin 2", ["B"], 7000),
  card("Toxin 3", ["G"], 8000),
  card("Grower 1", ["G"], 6000),
  card("Grower 2", ["G"], 6500),
  card("Prolif", ["G"], 9000),
  card("Blue Thing", ["U"], 100),
];
const tags = [
  tagrow("Horrigan", 0.7, [["proliferate", "enabler", 1], ["plus1_counters", "payoff", 0.6]]),
  tagrow("Mono Black Cmdr", 0.6, [["sacrifice", "payoff", 0.9]]),
  tagrow("Drown", 0.6, [["infect", "enabler", 0.8], ["proliferate", "enabler", 0.8]]),
  tagrow("Toxin 1", 0.7, [["infect", "enabler", 0.9]]),
  tagrow("Toxin 2", 0.7, [["infect", "enabler", 0.9]]),
  tagrow("Toxin 3", 0.7, [["infect", "payoff", 0.9]]),
  tagrow("Grower 1", 0.7, [["plus1_counters", "enabler", 0.9]]),
  tagrow("Grower 2", 0.7, [["plus1_counters", "payoff", 0.9]]),
  tagrow("Prolif", 0.7, [["proliferate", "enabler", 0.9]]),
  tagrow("Blue Thing", 0.9, [["infect", "enabler", 1]]),
];
const index = buildIndex(cards, tags, { rankCeiling: 32000 });
const infect = { id: "infect", name: "Spontaneous Infection", kind: "core", status: "ok",
  tags: [{ tag: "infect", weight: 1 }, { tag: "proliferate", weight: 0.7 }] };
const counters = { id: "counters", name: "Forced Evolution", kind: "core", status: "ok",
  tags: [{ tag: "plus1_counters", weight: 1 }, { tag: "proliferate", weight: 0.5 }] };
const dead = { id: "dead", name: "Rejected", kind: "stretch", status: "rejected_unviable", tags: [{ tag: "infect", weight: 1 }] };
const horrigan = index.get("Horrigan");

test("profile ranks themes by what the deck already plays and sets aside untagged/off-color", () => {
  const p = deckThemeProfile(index, horrigan, [infect, counters, dead],
    ["Horrigan", "Toxin 1", "Toxin 2", "Grower 1", "Blue Thing", "Unknown Card"]);
  assert.deepEqual(p.themes.map((t) => t.themeId), ["infect", "counters"]);   // rejected theme ignored
  assert.equal(p.themes[0].count, 2);
  assert.equal(p.analyzed, 3);                    // commander itself not counted
  assert.deepEqual(p.notAnalyzed, ["Unknown Card"]);
  assert.deepEqual(p.offColor, ["Blue Thing"]);
});

test("a card that only rides a secondary tag doesn't count toward a theme", () => {
  const p = deckThemeProfile(index, horrigan, [infect], ["Prolif"]);
  assert.equal(p.themes[0].count, 0);
});

test("active themes: pinned wins, auto follows the deck, empty deck falls back to a core theme", () => {
  const p = deckThemeProfile(index, horrigan, [infect, counters], ["Grower 1", "Grower 2"]);
  assert.deepEqual(activeThemeIds(p, [infect, counters]), ["counters"]);
  assert.deepEqual(activeThemeIds(p, [infect, counters], { mode: "pinned", pinned: ["infect", "gone"] }), ["infect"]);
  assert.deepEqual(activeThemeIds(p, [infect, counters], { mode: "pinned", pinned: ["gone"] }), ["counters"]);
  const empty = deckThemeProfile(index, horrigan, [infect, counters], []);
  assert.deepEqual(activeThemeIds(empty, [infect, counters]), ["infect"]);
});

test("recommendations skip deck cards, flag maybeboard cards and explain shared tags", () => {
  const { picks } = deckRecommendations(index, horrigan, infect, ["Toxin 1", "Drown"], undefined,
    { k: 10, maybeIds: ["Toxin 3"] });
  const names = picks.map((p) => p.name);
  assert.ok(!names.includes("Toxin 1") && !names.includes("Drown") && !names.includes("Horrigan"));
  assert.ok(!names.includes("Blue Thing"));
  const t3 = picks.find((p) => p.name === "Toxin 3");
  assert.ok(t3.deck.inMaybe);
  assert.deepEqual(t3.deck.shared, [{ tag: "infect", deckCards: 2 }]);
  assert.ok(t3.deck.mult > 1);
});

test("suggestCommanders: Drown in Ichor finds the commander whose theme it fits", () => {
  const cmds = [
    { slug: "horrigan", entry: horrigan, themes: [infect, counters] },
    { slug: "mono-black", entry: index.get("Mono Black Cmdr"),
      themes: [{ id: "sac", name: "Sac", kind: "core", tags: [{ tag: "sacrifice", weight: 1 }] }] },
  ];
  const [top, ...rest] = suggestCommanders(index, cmds, [{ oracle_id: "Drown", color_identity: ["B"] }]);
  assert.equal(top.slug, "horrigan");
  assert.equal(top.theme.id, "infect");
  assert.deepEqual(top.theme.tags, ["infect", "proliferate"]);
  assert.equal(rest.length, 0);   // no theme fit or synergy → not suggested
});

test("suggestCommanders: colors of untagged cards still rule commanders out", () => {
  const cmds = [{ slug: "mono-black", entry: index.get("Mono Black Cmdr"),
    themes: [{ id: "inf", name: "Inf", kind: "core", tags: [{ tag: "infect", weight: 1 }] }] }];
  assert.equal(suggestCommanders(index, cmds, [{ oracle_id: "Toxin 2", color_identity: ["B"] }]).length, 1);
  assert.equal(suggestCommanders(index, cmds, [{ oracle_id: "Toxin 2", color_identity: ["B"] },
    { oracle_id: "some red card", color_identity: ["R"] }]).length, 0);
});
