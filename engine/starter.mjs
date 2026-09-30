// Starter-deck helpers: how a fresh deck's land slots split across colors. Pure, so the
// site and tests share them. Card picking lives in web/src/lib/starter.ts (it needs the DB).

export const BASIC_NAME = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };

/** Split `total` slots across keys in proportion to `weights` (largest-remainder rounding). */
export function splitBasics(total, weights) {
  const keys = Object.keys(weights).filter((k) => weights[k] > 0);
  const sum = keys.reduce((a, k) => a + weights[k], 0);
  if (!keys.length || total <= 0) return {};
  const raw = keys.map((k) => ({ k, exact: (total * weights[k]) / sum }));
  const out = Object.fromEntries(raw.map((r) => [r.k, Math.floor(r.exact)]));
  let left = total - Object.values(out).reduce((a, b) => a + b, 0);
  for (const r of [...raw].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || weights[b.k] - weights[a.k])) {
    if (left-- <= 0) break;
    out[r.k]++;
  }
  return out;
}

/** Basic-land weights: every color in the identity gets a floor of 1, plus its mana-cost pips. */
export function basicWeights(identity, pips = {}) {
  return Object.fromEntries(identity.map((c) => [c, 1 + (pips[c] ?? 0)]));
}
