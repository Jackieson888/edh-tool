// Deck analytics: pure functions over resolved card rows. No I/O, so the site and tests share them.
//
// A row is { card, qty }, where card has: oracle_id, name, mana_cost, cmc, type_line, oracle_text,
// produced_mana (["W","U",…]), game_changer, price_usd and tags (tag ids). `commanders` are passed
// separately: they count toward color needs and the bracket but not the 99-card library.

export const COLORS = ["W", "U", "B", "R", "G"];
export const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other"];

export function typeGroup(typeLine = "") {
  const front = typeLine.split(" // ")[0];
  for (const t of TYPE_ORDER) if (t !== "Other" && new RegExp(`\\b${t}\\b`).test(front)) return t;
  return "Other";
}
export const isLand = (c) => typeGroup(c.type_line) === "Land";

const sum = (a) => a.reduce((x, y) => x + y, 0);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Colored pips in a mana cost. Hybrid symbols count once toward each color they name. */
export function pipsOf(cost = "") {
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const [, sym] of cost.matchAll(/\{([^}]+)\}/g)) {
    for (const part of sym.split("/")) if (part in out) out[part]++;
  }
  return out;
}

// ---------------------------------------------------------------- land odds

function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  let r = 0;
  for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i);
  return r;
}
/** P(exactly k successes) drawing `draws` from `pop` cards holding `succ` successes. */
export function hypergeom(pop, succ, draws, k) {
  if (draws > pop) draws = pop;
  const lp = logChoose(succ, k) + logChoose(pop - succ, draws - k) - logChoose(pop, draws);
  return Number.isFinite(lp) ? Math.exp(lp) : 0;
}
const atLeast = (pop, succ, draws, k) => {
  let p = 0;
  for (let i = k; i <= Math.min(succ, draws); i++) p += hypergeom(pop, succ, draws, i);
  return Math.min(1, p);
};

export function landOdds(library, lands, { maxTurn = 8 } = {}) {
  const opening = Array.from({ length: 8 }, (_, k) => round(hypergeom(library, lands, 7, k), 4));
  const keep = round(opening.slice(2, 6).reduce((a, b) => a + b, 0), 4);   // 2–5 lands in 7
  const turns = [];
  for (let t = 1; t <= maxTurn; t++) {
    const play = 7 + t - 1, draw = 7 + t;
    turns.push({
      turn: t,
      // chance of having made every land drop through turn t
      onPlay: round(atLeast(library, lands, play, t), 4),
      onDraw: round(atLeast(library, lands, draw, t), 4),
      expectedLandsPlay: round((lands / library) * play, 2),
    });
  }
  return { library, lands, nextDraw: library ? round(lands / library, 4) : 0, opening, keep, turns };
}

// ---------------------------------------------------------------- roles & bracket

/** Rough Commander norms for a 99-card list; a guide, not a rule. */
export const ROLE_TARGETS = [
  { id: "ramp", label: "Ramp", tags: ["ramp"], min: 8, max: 14 },
  { id: "card_draw", label: "Card draw", tags: ["card_draw"], min: 8, max: 14 },
  { id: "removal", label: "Spot removal", tags: ["spot_removal"], min: 5, max: 10 },
  { id: "wipes", label: "Board wipes", tags: ["board_wipe"], min: 1, max: 4 },
  { id: "tutors", label: "Tutors", tags: ["tutor"], min: 0, max: 5 },
];

const EXTRA_TURN = /\b(?:take|takes) (?:an|one|two|three|\d+) extra turns?\b|\bextra turn after this one\b/i;
const MASS_LAND_DENIAL = new RegExp([
  "destroy all (?:[a-z, ]*and )?lands",
  "destroy all lands",
  "sacrifices? all lands",
  "each player sacrifices? (?:all|\\w+) lands?",
  "return all lands",
  "each player sacrifices? a land for each",
  "lands you control (?:don't|do not) untap.*opponents",   // stax-style; kept conservative
].join("|"), "i");
const MLD_NAMES = new Set(["Armageddon", "Ravages of War", "Catastrophe", "Jokulhaups", "Obliterate", "Decree of Annihilation",
  "Devastation", "Ruination", "Impending Disaster", "Sunder", "Boom // Bust", "Apocalypse", "Balance", "Wildfire", "Worldpurge"]);
// Balance and Wildfire are not strictly land-only, so keep the list to genuine mass land denial.
MLD_NAMES.delete("Balance"); MLD_NAMES.delete("Wildfire"); MLD_NAMES.delete("Worldpurge"); MLD_NAMES.delete("Apocalypse");

/** The AI `tutor` tag also covers land fetch (fetchlands, Kodama's Reach). For roles and the bracket,
 *  a tutor has to be able to find something other than lands. */
const LAND_WORDS = /\b(?:lands?|plains|islands?|swamps?|mountains?|forests?)\b/i, NONLAND_WORDS = /creature|artifact|enchantment|instant|sorcery|planeswalker|equipment|aura/i;
export function isTutor(c) {
  if (!(c.tags ?? []).includes("tutor")) return false;
  const targets = [...(c.oracle_text ?? "").matchAll(/search your library for ([^.]*?)(?:,| and put| then|\.|$)/gi)].map((m) => m[1]);
  return !targets.length || targets.some((t) => !LAND_WORDS.test(t) || NONLAND_WORDS.test(t));
}

export const isExtraTurn = (c) => EXTRA_TURN.test(c.oracle_text ?? "");
export const isMassLandDenial = (c) => MLD_NAMES.has(c.name) || MASS_LAND_DENIAL.test(c.oracle_text ?? "");

const BRACKET_NAMES = { 1: "Exhibition", 2: "Core", 3: "Upgraded", 4: "Optimized", 5: "cEDH" };

/** Estimate from the four signals the official beta brackets name. Combos and speed are NOT
 *  detected, so treat the result as a floor. */
export function estimateBracket({ gameChangers, extraTurns, massLandDenial, tutors }) {
  const reasons = [];
  let b = 1;
  const raise = (to, why) => { if (to > b) b = to; reasons.push(why); };
  const n = (a) => a.length;
  if (n(massLandDenial)) raise(4, `${n(massLandDenial)} mass land denial card${n(massLandDenial) > 1 ? "s" : ""} (not allowed below Bracket 4)`);
  if (n(gameChangers) >= 4) raise(4, `${n(gameChangers)} Game Changers (Bracket 3 allows up to 3)`);
  else if (n(gameChangers) >= 1) raise(3, `${n(gameChangers)} Game Changer${n(gameChangers) > 1 ? "s" : ""}`);
  if (n(extraTurns) >= 3) raise(4, `${n(extraTurns)} extra-turn cards (chaining them is a Bracket 4 pattern)`);
  else if (n(extraTurns) >= 1) raise(2, `${n(extraTurns)} extra-turn card${n(extraTurns) > 1 ? "s" : ""}`);
  if (n(tutors) >= 6) raise(3, `${n(tutors)} tutors`);
  else if (n(tutors) >= 3) raise(2, `${n(tutors)} tutors`);
  if (!reasons.length) reasons.push("No Game Changers, extra turns, mass land denial or tutors");
  return { bracket: b, name: BRACKET_NAMES[b], reasons };
}

// ---------------------------------------------------------------- main entry

export function analyzeDeck(rows, commanders = [], { maxTurn = 8 } = {}) {
  const flat = rows.filter((r) => r.qty > 0);
  const cards = flat.map((r) => ({ ...r.card, qty: r.qty }));
  const n = sum(cards.map((c) => c.qty));
  const lands = cards.filter(isLand);
  const spells = cards.filter((c) => !isLand(c));
  const landN = sum(lands.map((c) => c.qty)), spellN = sum(spells.map((c) => c.qty));

  // mana curve (non-land cards)
  const curve = Array.from({ length: 8 }, (_, i) => ({ mv: i, label: i === 7 ? "7+" : String(i), count: 0 }));
  for (const c of spells) curve[Math.min(7, Math.floor(c.cmc ?? 0))].count += c.qty;
  const mvs = spells.flatMap((c) => Array(c.qty).fill(c.cmc ?? 0)).sort((a, b) => a - b);
  const mv = {
    avgNonland: spellN ? round(sum(mvs) / spellN) : 0,
    median: spellN ? (mvs[Math.floor((spellN - 1) / 2)] + mvs[Math.floor(spellN / 2)]) / 2 : 0,
    avgAll: n ? round(sum(cards.map((c) => (c.cmc ?? 0) * c.qty)) / n) : 0,
    totalNonland: sum(mvs),
  };

  // color pips (costs) vs mana sources (what actually makes each color)
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of [...spells, ...commanders.map((x) => ({ ...x, qty: 0 }))].filter((c) => c.qty > 0))
    for (const [k, v] of Object.entries(pipsOf(c.mana_cost))) pips[k] += v * c.qty;
  const sources = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, landSources = { ...sources };
  for (const c of cards) {
    const made = new Set(c.produced_mana ?? []);
    if (!made.size) continue;
    for (const k of made) if (k in sources) { sources[k] += c.qty; if (isLand(c)) landSources[k] += c.qty; }
  }
  const pipTotal = sum(Object.values(pips));
  const colors = COLORS.map((k) => ({
    color: k, pips: pips[k], pipShare: pipTotal ? round(pips[k] / pipTotal, 3) : 0,
    sources: sources[k], landSources: landSources[k],
  })).filter((x) => x.pips || x.sources);

  // types
  const typeCount = Object.fromEntries(TYPE_ORDER.map((t) => [t, 0]));
  for (const c of cards) typeCount[typeGroup(c.type_line)] += c.qty;
  const types = TYPE_ORDER.map((t) => ({ type: t, count: typeCount[t] })).filter((x) => x.count);

  // roles from tags
  const share = (pred) => sum(cards.filter(pred).map((c) => c.qty));
  const roles = ROLE_TARGETS.map((r) => {
    // roles count spells only: the mana base has its own charts, and fetchlands would swamp ramp
    const count = share((c) => !isLand(c) && (r.id === "tutors" ? isTutor(c) : (c.tags ?? []).some((t) => r.tags.includes(t))));
    return { ...r, count, status: count < r.min ? "low" : count > r.max ? "high" : "ok" };
  });
  const tagCount = new Map();
  for (const c of cards) for (const t of new Set(c.tags ?? [])) tagCount.set(t, (tagCount.get(t) ?? 0) + c.qty);
  const tagged = share((c) => (c.tags ?? []).length > 0);
  const tags = [...tagCount].map(([tag, count]) => ({ tag, count, share: n ? round(count / n, 3) : 0 }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

  // bracket
  const all = [...cards, ...commanders.map((c) => ({ ...c, qty: 1 }))];
  const pick = (pred) => all.filter(pred).map((c) => c.name);
  const bracketInputs = {
    gameChangers: pick((c) => c.game_changer),
    extraTurns: pick(isExtraTurn),
    massLandDenial: pick(isMassLandDenial),
    tutors: pick(isTutor),
  };
  const bracket = { ...estimateBracket(bracketInputs), ...bracketInputs, estimate: true };

  const price = round(sum(cards.map((c) => Number(c.price_usd ?? 0) * c.qty)), 2);
  return {
    total: n, lands: landN, nonlands: spellN, curve, mv, colors, types, roles, tags,
    tagCoverage: n ? round(tagged / n, 3) : 0, landOdds: landOdds(n, landN, { maxTurn }), bracket, priceUsd: price,
  };
}
