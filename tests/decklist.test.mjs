// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNameIndex, exportDecklist, lookupName, normalizeName, parseDecklist, parseLine, resolveEntries, suggestNames,
} from "../engine/decklist.mjs";

test("line formats from the common exporters", () => {
  assert.deepEqual(parseLine("1 Sol Ring"), { qty: 1, name: "Sol Ring" });
  assert.deepEqual(parseLine("1x Sol Ring"), { qty: 1, name: "Sol Ring" });
  assert.deepEqual(parseLine("Sol Ring"), { qty: 1, name: "Sol Ring" });
  assert.deepEqual(parseLine("12 Swamp"), { qty: 12, name: "Swamp" });
  assert.deepEqual(parseLine("1 Sol Ring (C21) 263"), { qty: 1, name: "Sol Ring", printing: "(C21) 263" });
  assert.deepEqual(parseLine("1 Sol Ring (c21) 263 *F*"), { qty: 1, name: "Sol Ring", printing: "(C21) 263", foil: "F" });
  assert.deepEqual(parseLine("1x Drown in Ichor (one) 88 [Removal,Proliferate] ^Have,#37d67a^"),
    { qty: 1, name: "Drown in Ichor", printing: "(ONE) 88", categories: ["Removal", "Proliferate"] });
  assert.deepEqual(parseLine("1 Fire // Ice (MH2) 290"), { qty: 1, name: "Fire // Ice", printing: "(MH2) 290" });
  assert.deepEqual(parseLine("1 Mox Amber (PLST) DOM-224"), { qty: 1, name: "Mox Amber", printing: "(PLST) DOM-224" });
  assert.equal(parseLine("SB: 1 Tormod's Crypt").section, "side");
  assert.equal(parseLine(""), null);
  assert.equal(parseLine("// comment"), null);
});

test("sections: Arena headers, Moxfield SIDEBOARD:, Archidekt categories", () => {
  const { entries, name } = parseDecklist(`About
Name Horrigan Brew

Commander
1 Agent Frank Horrigan (PIP) 1

Deck
1 Drown in Ichor
1x Tekuthal, Inquiry Dominus [Proliferate]

SIDEBOARD:
1 Tainted Strike
Maybeboard (1)
1 Ichor Rats
1x Grim Tutor [Maybeboard{noDeck}{noPrice}]
`);
  assert.equal(name, "Horrigan Brew");
  assert.deepEqual(entries.map((e) => [e.name, e.section]), [
    ["Agent Frank Horrigan", "commander"], ["Drown in Ichor", "main"], ["Tekuthal, Inquiry Dominus", "main"],
    ["Tainted Strike", "side"], ["Ichor Rats", "maybe"], ["Grim Tutor", "maybe"],
  ]);
  const arch = parseDecklist("1x Agent Frank Horrigan (pip) 1 [Commander{top}]\n1x Sol Ring [Ramp]");
  assert.deepEqual(arch.entries.map((e) => e.section), ["commander", "main"]);
});

const pool = [
  { oracle_id: "sol", name: "Sol Ring" },
  { oracle_id: "fire", name: "Fire // Ice" },
  { oracle_id: "dul", name: "Lim-Dûl's Vault" },
  { oracle_id: "ice", name: "Ice" },                      // a real card named like a face
  { oracle_id: "drown", name: "Drown in Ichor" },
];
const nidx = buildNameIndex(pool);

test("name matching: case, accents, apostrophes, faces, Alchemy prefix", () => {
  assert.equal(normalizeName("Lim-Dûl’s Vault"), "limdulsvault");
  assert.equal(lookupName(nidx, "lim-dul's vault"), "dul");
  assert.equal(lookupName(nidx, "SOL RING"), "sol");
  assert.equal(lookupName(nidx, "Fire"), "fire");
  assert.equal(lookupName(nidx, "Ice"), "ice");            // exact card beats a face
  assert.equal(lookupName(nidx, "Fire/Ice"), "fire");
  assert.equal(lookupName(nidx, "A-Drown in Ichor"), "drown");
  assert.equal(lookupName(nidx, "Drwon in Ichor"), null);
  assert.equal(suggestNames(pool, "Drwon in Ichor")[0].name, "Drown in Ichor");
});

test("resolve merges duplicates, keeps printings, routes boards", () => {
  const { entries } = parseDecklist("Commander\n1 Drown in Ichor\nDeck\n1 Sol Ring (C21) 263\n1 sol ring\nSideboard\n1 Ice\n1 Nonexistent Card");
  const r = resolveEntries(entries, nidx);
  assert.deepEqual(r.commanders, ["drown"]);
  assert.deepEqual(r.cards, [
    { oracle_id: "sol", qty: 2, board: "main", printing: "(C21) 263" },
    { oracle_id: "ice", qty: 1, board: "maybe" },
  ]);
  assert.deepEqual(r.unresolved.map((u) => u.name), ["Nonexistent Card"]);
});

test("export → re-import round trip gives the same deck", () => {
  const deck = { commanders: ["drown"], cards: [
    { oracle_id: "sol", qty: 1, board: "main", printing: "(C21) 263" },
    { oracle_id: "fire", qty: 1, board: "main" },
    { oracle_id: "ice", qty: 1, board: "maybe" },
  ] };
  const names = Object.fromEntries(pool.map((c) => [c.oracle_id, c.name]));
  for (const format of ["text", "moxfield", "archidekt"]) {
    const txt = exportDecklist(deck, names, { format, categories: { sol: "Ramp" } });
    const back = resolveEntries(parseDecklist(txt).entries, nidx);
    assert.deepEqual(back.commanders, deck.commanders, format);
    assert.deepEqual(back.cards.sort((a, b) => a.oracle_id.localeCompare(b.oracle_id)),
      [...deck.cards].sort((a, b) => a.oracle_id.localeCompare(b.oracle_id)), format);
  }
  const arch = exportDecklist(deck, names, { format: "archidekt", categories: { sol: "Ramp" } });
  assert.match(arch, /^1x Drown in Ichor \[Commander\{top\}\]$/m);
  assert.match(arch, /^1x Sol Ring \(C21\) 263 \[Ramp\]$/m);
  assert.match(arch, /^1x Ice \[Maybeboard\{noDeck\}\{noPrice\}\]$/m);
  assert.doesNotMatch(exportDecklist(deck, names, { printings: false }), /C21/);
  assert.doesNotMatch(exportDecklist(deck, names, { maybeboard: false }), /Ice\n?$/);
});
