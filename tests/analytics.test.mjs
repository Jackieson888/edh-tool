import test from "node:test";
import assert from "node:assert/strict";
import { analyzeDeck, pipsOf, hypergeom, typeGroup, isMassLandDenial, isExtraTurn, isTutor, estimateBracket } from "../engine/analytics.mjs";

const card = (o) => ({ oracle_id: o.name, cmc: 0, tags: [], produced_mana: [], ...o });
const land = (name, made = []) => ({ card: card({ name, type_line: "Land", produced_mana: made }), qty: 1 });
const spell = (name, cmc, cost, type = "Creature — Elf", extra = {}) => ({ card: card({ name, cmc, mana_cost: cost, type_line: type, ...extra }), qty: 1 });

test("pips: hybrid counts for both colors, generic ignored", () => {
  assert.deepEqual(pipsOf("{2}{W}{W}{U/B}"), { W: 2, U: 1, B: 1, R: 0, G: 0 });
  assert.deepEqual(pipsOf("{X}{G/P}"), { W: 0, U: 0, B: 0, R: 0, G: 1 });
  assert.deepEqual(pipsOf(""), { W: 0, U: 0, B: 0, R: 0, G: 0 });
});
test("hypergeometric sums to 1 and matches a known value", () => {
  let s = 0; for (let k = 0; k <= 7; k++) s += hypergeom(99, 37, 7, k);
  assert.ok(Math.abs(s - 1) < 1e-9);
  assert.ok(Math.abs(hypergeom(99, 37, 7, 0) - 0.0347) < 0.002);
});
test("type grouping picks the most specific front-face type", () => {
  assert.equal(typeGroup("Artifact Creature — Golem"), "Creature");
  assert.equal(typeGroup("Basic Land — Forest"), "Land");
  assert.equal(typeGroup("Instant // Sorcery"), "Instant");
});
test("mass land denial and extra turn detection", () => {
  assert.ok(isMassLandDenial({ name: "Armageddon", oracle_text: "Destroy all lands." }));
  assert.ok(!isMassLandDenial({ name: "Stone Rain", oracle_text: "Destroy target land." }));
  assert.ok(isExtraTurn({ oracle_text: "Take an extra turn after this one." }));
  assert.ok(!isExtraTurn({ oracle_text: "Draw a card. Extra turns are fun." }));
});
test("bracket rules", () => {
  const none = { gameChangers: [], extraTurns: [], massLandDenial: [], tutors: [] };
  assert.equal(estimateBracket(none).bracket, 1);
  assert.equal(estimateBracket({ ...none, gameChangers: ["a", "b"] }).bracket, 3);
  assert.equal(estimateBracket({ ...none, gameChangers: ["a", "b", "c", "d"] }).bracket, 4);
  assert.equal(estimateBracket({ ...none, massLandDenial: ["x"] }).bracket, 4);
  assert.equal(estimateBracket({ ...none, extraTurns: ["x"] }).bracket, 2);
});
test("analyzeDeck: curve, means, colors, types, roles, land odds", () => {
  const rows = [
    ...Array.from({ length: 36 }, (_, i) => land(`Forest${i}`, ["G"])),
    land("Command Tower", ["W", "U", "B", "R", "G"]),
    spell("Llanowar Elves", 1, "{G}", "Creature — Elf", { produced_mana: ["G"], tags: ["ramp"] }),
    spell("Sol Ring", 1, "{1}", "Artifact", { produced_mana: ["C"], tags: ["ramp"], game_changer: false }),
    spell("Rhystic Study", 3, "{2}{U}", "Enchantment", { tags: ["card_draw"], game_changer: true }),
    spell("Time Warp", 5, "{3}{U}{U}", "Sorcery", { oracle_text: "Take an extra turn after this one." }),
    spell("Big Guy", 9, "{7}{G}{G}"),
  ];
  const a = analyzeDeck(rows, [card({ name: "Cmdr", mana_cost: "{G}{U}", cmc: 2, type_line: "Legendary Creature" })]);
  assert.equal(a.total, 42);
  assert.equal(a.lands, 37);
  assert.equal(a.nonlands, 5);
  assert.equal(a.curve[1].count, 2);
  assert.equal(a.curve[7].count, 1);        // 9 folds into 7+
  assert.equal(a.mv.avgNonland, 3.8);
  assert.equal(a.mv.median, 3);
  const g = a.colors.find((c) => c.color === "G"), u = a.colors.find((c) => c.color === "U");
  assert.equal(g.pips, 3);                  // elves 1 + big guy 2 (commander not counted)
  assert.equal(u.pips, 3);
  assert.equal(g.sources, 38);
  assert.equal(g.landSources, 37);
  assert.equal(a.types.find((t) => t.type === "Land").count, 37);
  assert.equal(a.roles.find((r) => r.id === "ramp").count, 2);
  assert.equal(a.roles.find((r) => r.id === "ramp").status, "low");
  assert.deepEqual(a.bracket.gameChangers, ["Rhystic Study"]);
  assert.equal(a.bracket.bracket, 3);
  assert.equal(a.landOdds.lands, 37);
  assert.ok(Math.abs(a.landOdds.opening.reduce((x, y) => x + y, 0) - 1) < 1e-3);
  const real = analyzeDeck([...Array.from({ length: 37 }, (_, i) => land(`L${i}`, ["G"])),
    ...Array.from({ length: 62 }, (_, i) => spell(`S${i}`, 3, "{2}{G}"))]);
  assert.equal(real.total, 99);
  assert.ok(Math.abs(real.landOdds.nextDraw - 37 / 99) < 1e-4);
  assert.ok(real.landOdds.turns[3].onPlay < real.landOdds.turns[0].onPlay);
  assert.ok(real.landOdds.turns[3].onDraw >= real.landOdds.turns[3].onPlay);
  assert.ok(real.landOdds.keep > 0.8 && real.landOdds.keep < 0.95);
});
test("empty deck doesn't divide by zero", () => {
  const a = analyzeDeck([]);
  assert.equal(a.total, 0); assert.equal(a.landOdds.nextDraw, 0); assert.equal(a.mv.avgNonland, 0);
});
test("tutor tag doesn't count land fetch", () => {
  const t = (name, oracle_text) => ({ name, oracle_text, tags: ["tutor"] });
  assert.ok(isTutor(t("Demonic Tutor", "Search your library for a card, put that card into your hand, then shuffle.")));
  assert.ok(isTutor(t("Enlightened Tutor", "Search your library for an artifact or enchantment card, reveal it, then shuffle and put that card on top.")));
  assert.ok(!isTutor(t("Misty Rainforest", "{T}, Pay 1 life, Sacrifice: Search your library for a Forest or Island card, put it onto the battlefield, then shuffle.")));
  assert.ok(!isTutor(t("Kodama's Reach", "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.")));
  assert.ok(!isTutor({ name: "x", oracle_text: "Search your library for a card.", tags: [] }));
});
