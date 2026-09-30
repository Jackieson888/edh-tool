// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG, buildIndex, findByName, isLegalFor, mergeConfig, motifMatches, popularityMult,
  rankTheme, recommend, sampleRecs, themeFit, viability,
} from "../engine/score.mjs";

const card = (name, ci, rank, extra = {}) => ({
  oracle_id: name, name, color_identity: ci, commander_legal: true, supertypes: [], types: ["Creature"],
  type_line: "Creature — Test", edhrec_rank: rank, ...extra,
});
const tagrow = (name, quality, tags) => ({
  oracle_id: name, quality, tags: tags.map(([tag, role, strength]) => ({ tag, role, strength })),
});

const cards = [
  card("Cmdr", ["B", "G"], 3000),
  card("Poison A", ["G"], 500),
  card("Poison B", ["B"], 9000),
  card("Poison Combo", ["B"], 7000),
  card("Just Prolif", ["G"], 8000),
  card("Blue Poison", ["U"], 100),
  card("Obscure Junk", ["B"], 30000),
  card("Obscure Gem", ["G"], 25000),
  card("Forest", ["G"], 5, { supertypes: ["Basic"], types: ["Land"] }),
];
const tags = [
  tagrow("Cmdr", 0.6, [["proliferate", "enabler", 1]]),
  tagrow("Poison A", 0.6, [["infect", "enabler", 0.9]]),
  tagrow("Poison B", 0.6, [["infect", "enabler", 0.9]]),
  tagrow("Poison Combo", 0.6, [["infect", "enabler", 0.9], ["proliferate", "enabler", 0.7]]),
  tagrow("Just Prolif", 0.6, [["proliferate", "enabler", 0.9]]),
  tagrow("Blue Poison", 0.9, [["infect", "enabler", 1]]),
  tagrow("Obscure Junk", 0.36, [["infect", "enabler", 0.9]]),
  tagrow("Obscure Gem", 0.75, [["infect", "enabler", 0.9]]),
  tagrow("Forest", 0.5, [["ramp", "enabler", 0.2]]),
];
const theme = { id: "t", name: "T", tags: [{ tag: "infect", weight: 1 }, { tag: "proliferate", weight: 0.7 }] };
const index = buildIndex(cards, tags, { rankCeiling: 32000 });
const cmdr = findByName(index, "Cmdr");

test("color identity and basics are enforced", () => {
  assert.equal(isLegalFor(findByName(index, "Blue Poison"), cmdr), false);
  assert.equal(isLegalFor(findByName(index, "Forest"), cmdr), false);
  assert.equal(isLegalFor(cmdr, cmdr), false);
  const names = rankTheme(index, cmdr, theme).map((r) => r.name);
  assert.ok(!names.includes("Blue Poison"));
});

test("matching two theme tags beats matching one", () => {
  const combo = themeFit(findByName(index, "Poison Combo"), theme).fit;
  const single = themeFit(findByName(index, "Poison B"), theme).fit;
  assert.ok(combo > single);
});

test("secondary-only matches are damped below anchor matches", () => {
  const prolif = themeFit(findByName(index, "Just Prolif"), theme);
  assert.equal(prolif.offAnchor, true);
  assert.ok(prolif.fit < themeFit(findByName(index, "Poison B"), theme).fit / 2);
});

test("deep-cut boost is gated by quality", () => {
  const cfg = mergeConfig(DEFAULT_CONFIG, { popularity: { lambda: 3 } });
  const junk = popularityMult(findByName(index, "Obscure Junk"), cfg).mult;
  const gem = popularityMult(findByName(index, "Obscure Gem"), cfg).mult;
  assert.ok(gem > 2 && junk < 1.2, `gem ${gem} junk ${junk}`);
});

test("lambda slider flips staples vs deep cuts", () => {
  const top = (lambda) => rankTheme(index, cmdr, theme, mergeConfig(DEFAULT_CONFIG, { popularity: { lambda } }))[0].name;
  assert.equal(top(-3), "Poison A");     // rank 500: the proven pick
  assert.equal(top(4), "Obscure Gem");   // rank 25000 but quality .75
});

test("quality floor excludes weak cards", () => {
  const cfg = mergeConfig(DEFAULT_CONFIG, { quality: { floor: 0.4 } });
  assert.ok(!rankTheme(index, cmdr, theme, cfg).some((r) => r.name === "Obscure Junk"));
});

test("sampling is deterministic per seed, varies across seeds, never repeats a card", () => {
  const ranked = rankTheme(index, cmdr, theme);
  const a = sampleRecs(ranked, DEFAULT_CONFIG, { seed: "x", k: 3 }).map((r) => r.name);
  const b = sampleRecs(ranked, DEFAULT_CONFIG, { seed: "x", k: 3 }).map((r) => r.name);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
  const variants = new Set();
  for (let i = 0; i < 30; i++) variants.add(sampleRecs(ranked, DEFAULT_CONFIG, { seed: "s" + i, k: 3 }).map((r) => r.name).join());
  assert.ok(variants.size > 3);
});

test("rerolls change results; exclude removes cards", () => {
  const r0 = recommend(index, cmdr, theme, DEFAULT_CONFIG, { deckSeed: "d", reroll: 0 }).picks.map((p) => p.name);
  const ex = new Set([findByName(index, r0[0]).card.oracle_id]);
  const r1 = recommend(index, cmdr, theme, DEFAULT_CONFIG, { deckSeed: "d", reroll: 1, exclude: ex }).picks.map((p) => p.name);
  assert.ok(!r1.includes(r0[0]));
});

test("viability ignores off-anchor filler", () => {
  assert.equal(viability(index, cmdr, theme, { minFit: 0.3 }), 5); // A, B, Combo, Junk, Gem — not Just Prolif
});

test("art direction boosts matching art and picks the matching printing", () => {
  const art = [
    { oracle_id: "Poison B", illustration_id: "b-old", set: "som", image: "old.jpg" },
    { oracle_id: "Poison B", illustration_id: "b-new", set: "one", image: "new.jpg" },
    { oracle_id: "Poison A", illustration_id: "a-1", set: "mbs", image: "a.jpg" },
  ];
  const artTags = [
    { illustration_id: "b-old", mood: ["serene"], setting: ["forest"], palette: ["green"], motifs: [] },
    { illustration_id: "b-new", mood: ["grim"], setting: ["swamp"], palette: ["sickly"], motifs: ["toxic sludge"] },
    { illustration_id: "a-1", mood: ["heroic"], setting: ["plains"], palette: ["gold"], motifs: [] },
  ];
  const idx = buildIndex(cards, tags, { rankCeiling: 32000, art, artTags });
  const c = findByName(idx, "Cmdr");
  const artTheme = { ...theme, art: { mood: ["grim"], palette: ["sickly"], motifs: ["sludge"] } };
  const b = rankTheme(idx, c, artTheme).find((r) => r.name === "Poison B");
  assert.equal(b.parts.illustration.illustration_id, "b-new");
  assert.ok(Math.abs(b.parts.artMult - (1 + DEFAULT_CONFIG.art.weight)) < 1e-9);
  const a = rankTheme(idx, c, artTheme).find((r) => r.name === "Poison A");
  assert.equal(a.parts.artMult, 1);                     // tagged art, no match: no bonus, no penalty
  const plain = rankTheme(idx, c, theme).find((r) => r.name === "Poison B");
  assert.equal(plain.parts.artMult, 1);                 // theme without art direction: neutral
  const untagged = rankTheme(index, cmdr, artTheme).find((r) => r.name === "Poison B");
  assert.equal(untagged.parts.artMult, 1);              // no art data yet: neutral
});

test("art motifs match whole words only", () => {
  assert.ok(motifMatches("oil", "phyrexian oil"));
  assert.ok(motifMatches("mutant", "super mutant"));
  assert.ok(motifMatches("fallout", "fallout (universe)"));
  assert.ok(!motifMatches("oil", "boilerbilges"));
  assert.ok(!motifMatches("gas", "gasp"));
});
