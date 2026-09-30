import test from "node:test";
import assert from "node:assert/strict";
import { suggestCuts } from "../engine/cuts.mjs";

const card = (id, o = {}) => ({ oracle_id: id, name: id, cmc: 2, types: ["Creature"], supertypes: [], color_identity: ["G"], commander_legal: true, ...o });
const entry = (id, tags, o = {}) => ({ card: card(id, o.card), tags: new Map(Object.entries(tags).map(([t, s]) => [t, { tag: t, strength: s, role: "both" }])), quality: o.quality ?? 0.6, rankCeiling: 1000 });
const theme = { id: "t1", name: "Sac Fodder", kind: "core", tags: [{ tag: "sac_fodder", weight: 1 }, { tag: "death_trigger", weight: 0.7 }] };
const commander = entry("cmdr", { sac_fodder: 0.9 }, { card: { types: ["Creature"], color_identity: ["B", "G"] } });
const mk = (...es) => new Map(es.map((e) => [e.card.oracle_id, e]));
const rows = (...ids) => ids.map((oracle_id) => ({ oracle_id, qty: 1 }));

test("off-theme and illegal cards are flagged, theme staples are not", () => {
  const good = entry("good", { sac_fodder: 0.9 });
  const meh = entry("meh", { lifegain: 0.5 });
  const bad = entry("wrong-colors", { sac_fodder: 0.9 }, { card: { color_identity: ["R"] } });
  const r = suggestCuts(mk(commander, good, meh, bad), commander, [theme], rows("good", "meh", "wrong-colors"), { activeIds: ["t1"] });
  const names = r.cuts.map((c) => c.name);
  assert.ok(!names.includes("good"));
  assert.equal(r.cuts[0].name, "wrong-colors");
  assert.equal(r.cuts[0].reasons[0].kind, "illegal");
  const m = r.cuts.find((c) => c.name === "meh");
  assert.ok(m && m.reasons.some((x) => x.kind === "off_theme" && x.theme === "Sac Fodder"));
});

test("an overfull role flags only its weakest cards", () => {
  const ramps = Array.from({ length: 16 }, (_, i) => entry(`r${i}`, { ramp: 0.4 + i * 0.03, sac_fodder: 0.9 }, { card: { cmc: 2 } }));
  const r = suggestCuts(mk(commander, ...ramps), commander, [theme], rows(...ramps.map((e) => e.card.oracle_id)), { activeIds: ["t1"], over: 4 });
  const roleCuts = r.cuts.filter((c) => c.reasons.some((x) => x.kind === "redundant_role"));
  assert.equal(r.overfullRoles[0].label, "Ramp");
  assert.equal(roleCuts.length, 2);                              // 16 ramp vs max 14
  assert.deepEqual(roleCuts.map((c) => c.name).sort(), ["r0", "r1"]);
});

test("cards filling a short role are protected from off-theme cuts", () => {
  const solo = entry("only-ramp", { ramp: 0.8 });
  const r = suggestCuts(mk(commander, solo), commander, [theme], rows("only-ramp"), { activeIds: ["t1"] });
  assert.equal(r.shortRoles.find((x) => x.id === "ramp")?.count, 1);
  assert.equal(r.cuts.length, 0);
});

test("lands and the commander are never suggested", () => {
  const land = entry("forest", {}, { card: { types: ["Land"], supertypes: ["Basic"] } });
  const r = suggestCuts(mk(commander, land), commander, [theme], [{ oracle_id: "forest", qty: 30 }, { oracle_id: "cmdr", qty: 1 }], { activeIds: ["t1"] });
  assert.equal(r.cuts.length, 0);
});
