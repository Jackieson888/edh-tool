// "Cards to cut": rank a deck's cards by how little they earn their slot, with structured
// reasons the UI turns into sentences. Pure functions on the same index the scorer uses.
//
// A card is a cut candidate when one or more of these hold:
//   illegal      it is outside the commander's color identity
//   off_theme    it barely touches the deck's active theme(s) and has little commander synergy
//   redundant    it is among the weakest cards of a role (ramp, draw, removal, wipes) the deck
//                already has too many of, or of any tag the deck already covers well
//   expensive    it costs 6+ and isn't pulling its weight in the theme
//   weak         the tagger rated it low on overall power
// Cards that fill a role the deck is short on (too little ramp, say) are protected.

import { DEFAULT_CONFIG, commanderSynergy, isLegalFor, themeFit } from "./score.mjs";
import { ROLE_TARGETS } from "./analytics.mjs";

export const CUT_CONFIG = {
  strongFit: 0.6,        // a card at this themeFit fully supports a theme
  tagSupport: 0.4,       // carries a tag "for real" at this strength (same bar as the deck profile)
  tagSaturation: 14,     // a non-role tag is "covered well" once this many deck cards carry it
  weakQuality: 0.4,      // tagger power rating below this counts as weak
  minScore: 0.3,
  impact: { none: 0.75, low: 0.5 },   // cut score at/above which losing the card is "none" / "low" impact, else "neutral"
  weights: { theme: 0.5, redundant: 0.4, weak: 0.2, expensive: 0.15 },
  synergyShield: 0.6,    // commander synergy cancels up to this share of the off-theme penalty
  protectedShare: 0.4,   // off-theme penalty kept for cards that fill a short role
};

const ROLES = ROLE_TARGETS.filter((r) => r.id !== "tutors");   // tutors: land fetch muddies the tag
/** How much the deck would miss the card: only weak cards are ever listed, so nothing above "neutral". */
export const impactOf = (score, cfg = CUT_CONFIG) => (score >= cfg.impact.none ? "none" : score >= cfg.impact.low ? "low" : "neutral");
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const cmcOf = (e) => Number(e.card.cmc ?? 0);
const isLandEntry = (e) => (e.card.types ?? []).includes("Land");

/**
 * @param rows       main-board cards [{ oracle_id, qty }] (commander excluded)
 * @param activeIds  ids of the themes the deck is going for
 * @param over       how many cards over the limit the deck is (0 = just show the weakest links)
 */
export function suggestCuts(index, commander, themes, rows, { activeIds = [], over = 0, cfg = CUT_CONFIG, scoreCfg = DEFAULT_CONFIG } = {}) {
  const active = themes.filter((t) => activeIds.includes(t.id));
  const deck = [];
  for (const r of rows) {
    const e = index.get(r.oracle_id);
    if (!e || r.oracle_id === commander.card.oracle_id || isLandEntry(e)) continue;
    deck.push({ e, qty: r.qty ?? 1 });
  }

  // role counts and which roles are short / overfull
  const roleOf = (e, role) => role.tags.some((t) => e.tags.has(t));
  const roles = ROLES.map((role) => {
    const members = deck.filter((d) => roleOf(d.e, role));
    const count = members.reduce((a, d) => a + d.qty, 0);
    return { ...role, count, members };
  });
  const roleValue = (e, role) => {
    const s = Math.max(...role.tags.map((t) => e.tags.get(t)?.strength ?? 0));
    return s - 0.04 * cmcOf(e) + 0.3 * ((e.quality ?? 0.5) - 0.5);
  };
  const weakInRole = new Map();           // oracle_id -> { role, count, max }
  const shortRoleCards = new Set();
  for (const role of roles) {
    if (role.count > role.max) {
      const cut = role.count - role.max;
      [...role.members].sort((a, b) => roleValue(a.e, role) - roleValue(b.e, role)).slice(0, cut)
        .forEach((d) => weakInRole.set(d.e.card.oracle_id, { role: role.id, label: role.label, count: role.count, max: role.max, min: role.min }));
    } else if (role.count < role.min) {
      role.members.forEach((d) => shortRoleCards.add(d.e.card.oracle_id));
    }
  }

  // well-covered non-role tags: flag the weakest third of each
  const roleTags = new Set(ROLES.flatMap((r) => r.tags));
  const tagMembers = new Map();
  for (const d of deck) for (const [tag, ct] of d.e.tags) {
    if (roleTags.has(tag) || ct.strength < cfg.tagSupport) continue;
    if (!tagMembers.has(tag)) tagMembers.set(tag, []);
    tagMembers.get(tag).push({ d, strength: ct.strength });
  }
  const weakInTag = new Map();            // oracle_id -> { tag, count }
  for (const [tag, list] of tagMembers) {
    const count = list.reduce((a, m) => a + m.d.qty, 0);
    if (count < cfg.tagSaturation) continue;
    list.sort((a, b) => a.strength - b.strength);
    for (const m of list.slice(0, Math.floor(list.length / 3))) {
      const id = m.d.e.card.oracle_id;
      if (m.strength < cfg.strongFit && !weakInTag.has(id)) weakInTag.set(id, { tag, count, strength: m.strength });
    }
  }

  const cuts = [];
  for (const { e, qty } of deck) {
    const id = e.card.oracle_id;
    const reasons = [];
    let score = 0;

    if (!isLegalFor(e, commander)) {
      cuts.push({ oracle_id: id, name: e.card.name, cmc: cmcOf(e), qty, score: 10, fit: 0, reasons: [{ kind: "illegal" }] });
      continue;
    }

    let bestFit = 0, bestTheme = null;
    for (const t of active) {
      const tf = themeFit(e, t, scoreCfg);
      const fit = tf.fit;
      if (fit > bestFit) { bestFit = fit; bestTheme = t; }
    }
    const syn = commanderSynergy(e, commander, scoreCfg).raw;

    if (active.length) {
      let term = clamp01(1 - bestFit / cfg.strongFit) * (1 - cfg.synergyShield * syn);
      if (shortRoleCards.has(id)) term *= cfg.protectedShare;
      if (term >= 0.35) {
        reasons.push({ kind: "off_theme", theme: (bestTheme ?? active[0]).name, fit: +bestFit.toFixed(2), tags: [...e.tags.keys()].slice(0, 3) });
        score += cfg.weights.theme * term;
      }
    }

    const role = weakInRole.get(id), tag = weakInTag.get(id);
    if (role) {
      reasons.push({ kind: "redundant_role", ...role });
      score += cfg.weights.redundant;
    } else if (tag && (!active.length || bestFit < cfg.strongFit)) {
      reasons.push({ kind: "redundant_tag", tag: tag.tag, count: tag.count });
      score += cfg.weights.redundant * 0.7;
    }

    const cmc = cmcOf(e);
    if (cmc >= 6 && bestFit < cfg.strongFit && !shortRoleCards.has(id)) {
      reasons.push({ kind: "expensive", cmc });
      score += cfg.weights.expensive;
    }
    const q = e.quality ?? 0.5;
    if (q < cfg.weakQuality) {
      reasons.push({ kind: "weak", quality: +q.toFixed(2) });
      score += cfg.weights.weak * clamp01((0.5 - q) / 0.5);
    }

    if (reasons.length && score >= cfg.minScore) {
      cuts.push({ oracle_id: id, name: e.card.name, cmc, qty, score: +score.toFixed(3), fit: +bestFit.toFixed(2), reasons });
    }
  }

  for (const c of cuts) c.impact = impactOf(c.score, cfg);
  cuts.sort((a, b) => b.score - a.score || b.cmc - a.cmc || a.name.localeCompare(b.name));
  const limit = over > 0 ? Math.min(20, Math.max(8, over + 4)) : 10;
  return {
    over,
    cuts: cuts.slice(0, limit),
    flagged: cuts.length,
    overfullRoles: roles.filter((r) => r.count > r.max).map((r) => ({ id: r.id, label: r.label, count: r.count, max: r.max })),
    shortRoles: roles.filter((r) => r.count < r.min).map((r) => ({ id: r.id, label: r.label, count: r.count, min: r.min })),
  };
}
