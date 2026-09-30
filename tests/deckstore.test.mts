import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../web/src/lib/deckStore.ts";

const id = "11111111-1111-1111-1111-111111111111";
test("migrate: garbage in gives an empty store", () => {
  for (const raw of [null, undefined, 5, "x", [], {}, { decks: 7 }]) {
    const s = migrate(raw);
    assert.deepEqual(s.decks, {});
    assert.equal(s.lastOpenedId, null);
  }
});
test("migrate: fills defaults and cleans bad cards", () => {
  const s = migrate({ lastOpenedId: id, decks: { [id]: {
    name: 42, commanders: ["a", 3, null],
    cards: [{ oracle_id: "x", qty: 0 }, { oracle_id: "y", qty: "3", board: "maybe", printing: "(MOM) 1" }, { qty: 2 }, null, { oracle_id: "z", board: "side" }],
    theme: { mode: "pinned", pinned: ["t", 9] },
  }, bad: null } });
  const d = s.decks[id];
  assert.equal(Object.keys(s.decks).length, 1);
  assert.equal(d.schemaVersion, 1);
  assert.equal(d.name, "Untitled deck");
  assert.deepEqual(d.commanders, ["a"]);
  assert.deepEqual(d.cards.map((c) => [c.oracle_id, c.qty, c.board]), [["x", 1, "main"], ["y", 3, "maybe"], ["z", 1, "main"]]);
  assert.equal(d.cards[1].printing, "(MOM) 1");
  assert.deepEqual(d.theme, { mode: "pinned", pinned: ["t"] });
  assert.equal(s.lastOpenedId, id);
});
test("migrate: unknown lastOpenedId is dropped, bad theme falls back to auto", () => {
  const s = migrate({ lastOpenedId: "nope", decks: { [id]: { theme: { mode: "pinned" } } } });
  assert.equal(s.lastOpenedId, null);
  assert.deepEqual(s.decks[id].theme, { mode: "auto", pinned: [] });
});
