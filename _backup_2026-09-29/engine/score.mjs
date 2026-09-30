// Recommendation engine: scores cards against a commander theme and samples a
// varied handful of recommendations. Pure functions, no I/O, so the same file
// runs in Node (pipeline checks, API) and the browser (site, tuning playground).
//
//   score = fit^a  ×  commanderMult  ×  quality^b  ×  popularityMult  ×  artMult
//
//   fit            best weighted tag match + a share of the other matches (0..~1.6);
//                  cards that miss the theme's anchor tag and match only one tag are damped
//   commanderMult  ≥1 bonus when the card directly feeds / is fed by the commander
//   quality        the tagger's standalone power estimate (0..1), with a hard floor
//   popularityMult exp(λ·(obscurity − 0.5)); λ<0 favors staples, λ>0 hidden gems.
//                  obscurity = log(rank)/log(maxRank): popularity is a power law, so
//                  rank 400 vs 4,000 is a big gap and 15,000 vs 30,000 is not
//   artMult        ≥1 bonus when a theme has an art direction (mood, setting, palette...)
//                  and one of the card's printings matches it; 1.0 when either side
//                  has no art data, so it never punishes untagged cards

export const DEFAULT_CONFIG = {
  fit: {
    exponent: 1.0,            // a: >1 makes theme fit dominate everything else
    secondaryShare: 0.5,      // how much each match beyond the best one adds (the "coherence" bonus)
    offAnchorPenalty: 0.55,   // card matches ONLY a secondary tag (e.g. just proliferate) → damp it
    minStrength: 0.2,         // card tags weaker than this don't count toward fit
    roleMismatch: 0.5,        // multiplier when a theme wants payoffs and the card only enables (or vice versa)
  },
  commander: {
    weight: 0.5,              // max bonus from direct commander synergy (1.0 → up to 1.5x)
    complement: 1.0,          // commander enables X & card pays off X (or reverse)
    sameSide: 0.35,           // both enable X / both pay off X — related, weaker
    ignoreTags: ["evasion", "trample", "protection", "etb_value", "card_draw", "ramp"], // too generic to count as synergy
  },
  quality: {
    exponent: 1.5,            // b: >1 so a 0.7 card clearly beats a 0.45 card of similar fit
    floor: 0.35,              // below this a card is never recommended
    unknown: 0.5,
  },
  popularity: {
    lambda: 2.0,              // the "proven picks ↔ deep cuts" slider, roughly -2 .. +5
    unrankedObscurity: 1.0,   // cards EDHREC has no rank for
    scale: "log",             // "log" | "linear"
    gemGate: [0.35, 0.7],     // the deep-cut BOOST only fully applies to cards with quality >= 0.7,
                              // fading to nothing at 0.35 — obscure-because-bad cards don't get lifted
  },
  art: {
    weight: 0.35,             // full art match → up to ×1.35
    fields: { mood: 1, setting: 1, palette: 0.75, lighting: 0.5, subject: 0.5, motifs: 1 },
  },
  candidates: {
    minFit: 0.25,
    poolSize: 40,             // sample only from the top-N of a theme
  },
  sampling: {
    k: 5,
    temperature: 0.5,         // <1 sharpens toward the top of the pool, >1 flattens
    repeatPenalty: 0.45,      // weight multiplier per earlier pick with the same "signature"
                              // (matched tags + card type) — avoids 5 near-identical cards
    roleSlots: true,          // nudge pick 1 toward an enabler and pick 2 toward a payoff...
    slotBoost: 4,             // ...by this weight multiplier (soft, so a lone payoff isn't shown 100% of the time)
  },
};

// ---------------------------------------------------------------- utilities

export function mergeConfig(base, over = {}) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...out[k], ...v } : v;
  }
  return out;
}

function hashString(s) {
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return h1 >>> 0;
}

export function rng(seed) {
  let a = typeof seed === "number" ? seed >>> 0 : hashString(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sidesOf = (role) => (role === "both" ? ["enabler", "payoff"] : [role]);

// ---------------------------------------------------------------- index

/**
 * cards:     normalized card rows (pipeline/load_scryfall.py)
 * cardTags:  validated tag rows (pipeline/tagging.py)
 * rankCeiling: highest edhrec_rank in the FULL dataset, so obscurity is on the
 *              same scale whether you load 80 cards or 30,000.
 */
export function buildIndex(cards, cardTags, { rankCeiling, art = [], artTags = [] } = {}) {
  const tagsById = new Map(cardTags.map((t) => [t.oracle_id, t]));
  // art: rows from art.jsonl (every printing's illustration); artTags: vision tags by illustration_id
  const artTagById = new Map(artTags.map((t) => [t.illustration_id, t]));
  const artByCard = new Map();
  for (const a of art) {
    const t = artTagById.get(a.illustration_id);
    if (!t) continue;
    if (!artByCard.has(a.oracle_id)) artByCard.set(a.oracle_id, []);
    artByCard.get(a.oracle_id).push({ ...a, tags: t });
  }
  const ceiling = rankCeiling ?? Math.max(2, ...cards.map((c) => c.edhrec_rank ?? 0));
  const index = new Map();
  for (const card of cards) {
    const t = tagsById.get(card.oracle_id);
    if (!t) continue;
    index.set(card.oracle_id, {
      card,
      tags: new Map(t.tags.map((x) => [x.tag, x])),
      quality: t.quality,
      rank: card.edhrec_rank,
      rankCeiling: ceiling,
      art: artByCard.get(card.oracle_id) ?? [],
    });
  }
  return index;
}

export function findByName(index, name) {
  const n = name.toLowerCase();
  for (const e of index.values()) if (e.card.name.toLowerCase() === n) return e;
  return null;
}

export function isLegalFor(entry, commander) {
  const c = entry.card;
  if (!c.commander_legal || c.oracle_id === commander.card.oracle_id) return false;
  if (c.supertypes.includes("Basic") && c.types.includes("Land")) return false;
  const ci = new Set(commander.card.color_identity);
  return c.color_identity.every((x) => ci.has(x));
}

// ---------------------------------------------------------------- scoring parts

export function themeFit(entry, theme, cfg = DEFAULT_CONFIG) {
  const { minStrength, secondaryShare, offAnchorPenalty, roleMismatch } = cfg.fit;
  const anchorWeight = Math.max(...theme.tags.map((t) => t.weight));
  const matched = [];
  for (const tt of theme.tags) {
    const ct = entry.tags.get(tt.tag);
    if (!ct || ct.strength < minStrength) continue;
    const focus = tt.role_focus ?? "any";
    const roleOk = focus === "any" || sidesOf(ct.role).includes(focus);
    const contrib = tt.weight * ct.strength * (roleOk ? 1 : roleMismatch);
    matched.push({ tag: tt.tag, weight: tt.weight, strength: ct.strength, role: ct.role, roleOk,
                   anchor: tt.weight === anchorWeight, contrib });
  }
  if (!matched.length) return { fit: 0, matched, primary: null };
  matched.sort((a, b) => b.contrib - a.contrib);
  const best = matched[0].contrib;
  const rest = matched.slice(1).reduce((a, m) => a + m.contrib, 0);
  let fit = best + secondaryShare * rest;
  // Not matching the theme's anchor tag means the card only rides along on secondary
  // tags (e.g. a generic proliferate card in an oil-counter theme). Damp it; a bit less
  // if it hits two or more secondaries, since that's still a coherent fit.
  const offAnchor = !matched.some((m) => m.anchor);
  if (offAnchor) fit *= matched.length === 1 ? offAnchorPenalty : Math.sqrt(offAnchorPenalty);
  return { fit, matched, offAnchor, primary: matched[0].tag, primaryRole: matched[0].role };
}

export function commanderSynergy(entry, commander, cfg = DEFAULT_CONFIG) {
  const { weight, complement, sameSide, ignoreTags } = cfg.commander;
  const ignore = new Set(ignoreTags);
  let best = 0;
  let total = 0;
  const links = [];
  for (const [tag, ct] of commander.tags) {
    if (ignore.has(tag)) continue;
    const et = entry.tags.get(tag);
    if (!et) continue;
    const cs = sidesOf(ct.role), es = sidesOf(et.role);
    const comp = (cs.includes("enabler") && es.includes("payoff")) || (cs.includes("payoff") && es.includes("enabler"));
    const k = (comp ? complement : sameSide) * Math.min(ct.strength, et.strength);
    if (k <= 0) continue;
    links.push({ tag, kind: comp ? "complement" : "same-side", value: +k.toFixed(3) });
    total += k;
    best = Math.max(best, k);
  }
  // diminishing returns: the strongest link counts fully, the rest add a little
  const raw = Math.min(1, best + 0.25 * (total - best));
  return { mult: 1 + weight * raw, raw, links };
}

export function obscurity(entry, cfg = DEFAULT_CONFIG) {
  if (entry.rank == null) return cfg.popularity.unrankedObscurity;
  return cfg.popularity.scale === "linear"
    ? Math.min(1, entry.rank / entry.rankCeiling)
    : Math.min(1, Math.log(entry.rank) / Math.log(entry.rankCeiling));
}

export function popularityMult(entry, cfg = DEFAULT_CONFIG, quality = entry.quality ?? cfg.quality.unknown) {
  const ob = obscurity(entry, cfg);
  const { lambda, gemGate } = cfg.popularity;
  let x = lambda * (ob - 0.5);
  // gate only the upside: in "proven picks" mode obscure cards are still pushed down in full
  if (x > 0 && gemGate) {
    const [lo, hi] = gemGate;
    x *= Math.max(0, Math.min(1, (quality - lo) / (hi - lo)));
  }
  return { mult: Math.exp(x), obscurity: ob };
}

/** A theme motif matches an art label when it is the whole label or a whole word run in it:
 *  "oil" hits "phyrexian oil" but not "oil paint"-style noise words like "boil" or "koilos". */
export function motifMatches(motif, label) {
  if (motif === label) return true;
  const esc = motif.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s(])${esc}($|[\\s)])`).test(label);
}

/** How well one illustration's tags match a theme's art direction (0..1). */
export function artMatchOne(tags, pref, fields, hits = null) {
  let got = 0, total = 0;
  for (const [field, w] of Object.entries(fields)) {
    const want = pref[field];
    if (!want || !want.length) continue;
    total += w;
    const have = [].concat(tags[field] ?? []).map((x) => String(x).toLowerCase());
    const found = field === "motifs"
      ? want.filter((m) => have.some((h) => motifMatches(m.toLowerCase(), h)))
      : want.filter((x) => have.includes(x));
    if (found.length) {
      got += w;
      if (hits) hits.push(...found);
    }
  }
  return total ? got / total : 0;
}

/** Best-matching printing for the theme, so the site can show THAT art. */
export function artMatch(entry, theme, cfg = DEFAULT_CONFIG) {
  if (!theme.art || !entry.art?.length || !cfg.art?.weight) return { mult: 1, match: null, illustration: null };
  let best = null, bestScore = -1, bestHits = [];
  for (const a of entry.art) {
    const hits = [];
    const m = artMatchOne(a.tags, theme.art, cfg.art.fields, hits);
    if (m > bestScore) { bestScore = m; best = a; bestHits = hits; }
  }
  return { mult: 1 + cfg.art.weight * bestScore, match: bestScore, illustration: best, hits: bestHits };
}

export function scoreCard(entry, theme, commander, cfg = DEFAULT_CONFIG) {
  const tf = themeFit(entry, theme, cfg);
  if (tf.fit < cfg.candidates.minFit) return null;
  const q = entry.quality ?? cfg.quality.unknown;
  if (q < cfg.quality.floor) return null;
  const cs = commanderSynergy(entry, commander, cfg);
  const pm = popularityMult(entry, cfg, q);
  const am = artMatch(entry, theme, cfg);
  const score = Math.pow(tf.fit, cfg.fit.exponent) * cs.mult * Math.pow(q, cfg.quality.exponent) * pm.mult * am.mult;
  return {
    oracle_id: entry.card.oracle_id,
    name: entry.card.name,
    type_line: entry.card.type_line,
    score,
    parts: {
      fit: tf.fit, matched: tf.matched, offAnchor: tf.offAnchor, primary: tf.primary, primaryRole: tf.primaryRole,
      commanderMult: cs.mult, commanderLinks: cs.links,
      quality: q, obscurity: pm.obscurity, popularityMult: pm.mult,
      artMult: am.mult, artMatch: am.match, artHits: am.hits ?? [],
      illustration: am.illustration && { illustration_id: am.illustration.illustration_id, image: am.illustration.image,
                                        art_crop: am.illustration.art_crop, artist: am.illustration.artist, set: am.illustration.set },
      edhrec_rank: entry.card.edhrec_rank,
    },
  };
}

// ---------------------------------------------------------------- ranking & sampling

export function rankTheme(index, commander, theme, cfg = DEFAULT_CONFIG, { exclude = new Set() } = {}) {
  const out = [];
  for (const e of index.values()) {
    if (exclude.has(e.card.oracle_id) || !isLegalFor(e, commander)) continue;
    const s = scoreCard(e, theme, commander, cfg);
    if (s) out.push(s);
  }
  return out.sort((a, b) => b.score - a.score);
}

/** How many legal, playable cards genuinely belong to this theme. Cards that only
 *  match a secondary tag (a generic proliferate card in an oil-counter theme) don't
 *  count — otherwise a thin theme looks viable because of its filler. */
export function viability(index, commander, theme, { minFit = 0.35, minQuality = 0.35 } = {}) {
  let n = 0;
  for (const e of index.values()) {
    if (!isLegalFor(e, commander) || (e.quality ?? 0) < minQuality) continue;
    const tf = themeFit(e, theme);
    if (tf.fit >= minFit && !tf.offAnchor) n++;
  }
  return n;
}

/**
 * Pick k cards from the top of a ranked list, weighted by score, with:
 *  - a seed so results are stable per (deck, theme, reroll) but differ across users
 *  - role slots so a batch has something that enables AND something that pays off
 *  - a penalty for repeating the same primary tag, so 5 picks aren't 5 sac outlets
 */
export function sampleRecs(ranked, cfg = DEFAULT_CONFIG, { seed = "default", k } = {}) {
  const S = cfg.sampling;
  k = k ?? S.k;
  const pool = ranked.slice(0, cfg.candidates.poolSize);
  if (!pool.length) return [];
  const rand = rng(seed);
  const top = pool[0].score;
  const base = pool.map((r) => Math.pow(r.score / top, 1 / S.temperature));
  const picked = [];
  const used = new Set();
  const sigCount = new Map();
  const mainType = (r) => (r.type_line ?? "").split("—")[0].split(" ").filter((t) =>
    ["Creature", "Artifact", "Enchantment", "Instant", "Sorcery", "Planeswalker", "Land", "Battle"].includes(t)).join(" ");
  const sig = (r) => r.parts.matched.map((m) => m.tag).sort().join("+") + "|" + mainType(r);

  const slotWant = (i) => (!S.roleSlots ? null : i === 0 ? "enabler" : i === 1 ? "payoff" : null);

  for (let i = 0; i < Math.min(k, pool.length); i++) {
    const want = slotWant(i);
    const fits = (r) => want && sidesOf(r.parts.primaryRole).includes(want);
    // only nudge when there's a real choice among cards that fill the slot
    const nFit = want ? pool.filter((r, j) => !used.has(j) && fits(r)).length : 0;
    const boost = nFit >= 2 ? S.slotBoost : 1;
    const w = pool.map((r, j) => {
      if (used.has(j)) return 0;
      const rep = sigCount.get(sig(r)) ?? 0;
      return base[j] * Math.pow(S.repeatPenalty, rep) * (fits(r) ? boost : 1);
    });
    const sum = w.reduce((a, b) => a + b, 0);
    if (sum <= 0) break;
    let x = rand() * sum, j = 0;
    while (j < w.length - 1 && (x > w[j] || w[j] === 0)) { x -= w[j]; j++; }
    while (w[j] === 0) j--; // float round-off guard: step back to the last real candidate
    used.add(j);
    sigCount.set(sig(pool[j]), (sigCount.get(sig(pool[j])) ?? 0) + 1);
    picked.push({ ...pool[j], poolRank: j + 1 });
  }
  return picked;
}

/** One-call convenience used by the API / playground. */
export function recommend(index, commander, theme, cfg = DEFAULT_CONFIG, { deckSeed = "anon", reroll = 0, exclude } = {}) {
  const ranked = rankTheme(index, commander, theme, cfg, { exclude });
  const picks = sampleRecs(ranked, cfg, { seed: `${deckSeed}|${theme.id}|${reroll}` });
  return { picks, poolSize: Math.min(ranked.length, cfg.candidates.poolSize), eligible: ranked.length };
}
