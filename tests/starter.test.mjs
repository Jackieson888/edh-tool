import test from "node:test";
import assert from "node:assert/strict";
import { basicWeights, splitBasics } from "../engine/starter.mjs";

test("splitBasics always sums to the total and follows the weights", () => {
  const r = splitBasics(16, { W: 1, U: 7, B: 4 });
  assert.equal(Object.values(r).reduce((a, b) => a + b, 0), 16);
  assert.ok(r.U > r.B && r.B > r.W);
  assert.deepEqual(splitBasics(10, { G: 3 }), { G: 10 });
  assert.deepEqual(splitBasics(0, { G: 3 }), {});
});

test("every identity color keeps a floor of one weight", () => {
  assert.deepEqual(basicWeights(["B", "G"], { B: 5 }), { B: 6, G: 1 });
  const r = splitBasics(14, basicWeights(["W", "U", "B", "R", "G"], {}));
  assert.ok(Object.values(r).every((n) => n >= 2));
});
