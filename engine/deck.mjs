// Deck-aware scoring: what an in-progress decklist is already about, what to add next,
// and which commanders fit a card or a pile of cards. Pure functions built on score.mjs,
// so the site, the pipeline and tests all share them.
//
//   deckThemeProfile   rank a commander's themes by how many deck cards genuinely fit each
//   activeThemeIds     auto (inferred top theme) or the user's pinned themes
//   deckRecommendations  rankTheme minus cards already in the deck, nudged toward cards
//                        that share tags with the deck, then the usual seeded sample
//   suggestCommanders  one card or a pile → commanders whose colors cover it and whose
//                        themes it fits (the "Drown in Ichor → Frank Horrigan" lookup)

import { DEFAULT_CONFIG, commanderSynergy, isLegalFor, rankTheme, sampleRecs, themeFit } from "./score.mjs";

export const DECK_CONFIG = {
  memberFit: 0.35,        // a deck card "belongs" to a theme at this themeFit (same bar as viability)...
  supportStrength: 0.4,   // ...and "supports" a tag when it carries it at this strength
  deckWeight: 0.35,       // cards sharing tags with the deck get up to ×1.35
  deckSaturation: 8,      // ...reached when 8+ deck cards carry the shared tag
  recK: 8,                // recommendations shown per theme in the builder
  synergyWeight: 0.35,    // suggestCommanders: how much direct commander synergy adds to theme fit
};

const usableThemes = (themes) => themes.filter((t) => (t.status ?? "ok") === "ok");

/**
 * How much of the deck each theme already covers. Only tagged cards that are legal for the
 * commander count; off-color and untagged cards come back in `notAnalyzed` / `offColor`.
 */
export function deckThemeProfile(index, commander, themes, deckIds, dcfg = DECK_CONFIG) {
  const analyzed = [], notAnalyzed = [], offColor = [];
  for (const id of new Set(deckIds)) {
    if (id === commander.card.oracle_id) continue;
    const e = index.get(id);
    if (!e) notAnalyzed.push(id);
    else if (!isLegalFor(e, commander)) offColor.push(id);
    else analyzed.push(e);
  }
  const themeRows = usableThemes(themes).map((theme) => {
    const cards = [];
    for (const e of analyzed) {
      const tf = themeFit(e, theme);
      if (tf.fit >= dcfg.memberFit && !tf.offAnchor) cards.push({ oracle_id: e.card.oracle_id, fit: tf.fit });
    }
    cards.sort((a, b) => b.fit - a.fit);
    const fitSum = cards.reduce((a, c) => a + c.fit, 0);
    return { themeId: theme.id, count: cards.length, fitSum, share: analyzed.length ? cards.length / analyzed.length : 0, cards };
  });
  themeRows.sort((a, b) => b.fitSum - a.fitSum || b.count - a.count);
  return { themes: themeRows, analyzed: analyzed.length, notAnalyzed, offColor };
}

/** Themes that drive recommendations: the user's pinned ones, or the inferred leader
 *  (falling back to the first core theme for an empty deck). */
export function activeThemeIds(profile, themes, state = { mode: "auto", pinned: [] }) {
  const ok = new Set(usableThemes(themes).map((t) => t.id));
  if (state.mode === "pinned") {
    const pinned = (state.pinned ?? []).filter((id) => ok.has(id));
    if (pinned.length) return pinned;
  }
  const top = profile.themes.find((t) => t.count > 0);
  if (top) return [top.themeId];
  const core = usableThemes(themes).find((t) => t.kind === "core") ?? usableThemes(themes)[0];
  return core ? [core.id] : [];
}

/**
 * Cards to add for one theme. Cards already in the main deck are excluded; maybeboard
 * cards stay eligible and are flagged so the UI can badge them. Each pick carries
 * `deck.shared`: the theme tags it has in common with the deck and how many deck cards
 * carry each, for a "why this card" line.
 */
export function deckRecommendations(index, commander, theme, deckIds, cfg = DEFAULT_CONFIG,
                                    { seed = "deck", k = DECK_CONFIG.recK, maybeIds = [], dcfg = DECK_CONFIG } = {}) {
  const exclude = new Set([...deckIds, commander.card.oracle_id]);
  const maybe = new Set(maybeIds);
  const support = new Map(theme.tags.map((t) => [t.tag, 0]));
  for (const id of new Set(deckIds)) {
    const e = index.get(id);
    if (!e || id === commander.card.oracle_id) continue;
    for (const tag of support.keys()) {
      const ct = e.tags.get(tag);
      if (ct && ct.strength >= dcfg.supportStrength) support.set(tag, support.get(tag) + 1);
    }
  }
  const ranked = rankTheme(index, commander, theme, cfg, { exclude }).map((r) => {
    const shared = r.parts.matched
      .filter((m) => m.contrib > 0 && support.get(m.tag) > 0)
      .map((m) => ({ tag: m.tag, deckCards: support.get(m.tag) }));
    const overlap = Math.max(0, ...shared.map((s) => s.deckCards));
    const mult = 1 + dcfg.deckWeight * Math.min(1, overlap / dcfg.deckSaturation);
    return { ...r, score: r.score * mult, deck: { mult, shared, inMaybe: maybe.has(r.oracle_id) } };
  }).sort((a, b) => b.score - a.score);
  const picks = sampleRecs(ranked, cfg, { seed: `${seed}|${theme.id}`, k });
  return { picks, eligible: ranked.length, support: Object.fromEntries(support) };
}

/**
 * Commanders for a card or a pile of cards.
 *   commanders: [{ slug, entry, themes }]   (entry = the commander's index entry)
 *   input:      [{ oracle_id, color_identity }]  every card, tagged or not (untagged cards
 *               still constrain colors; only tagged ones are scored)
 * A commander qualifies when its color identity covers the whole input. Its score is its
 * best theme's summed fit over the input, plus a share of direct commander synergy.
 */
export function suggestCommanders(index, commanders, input, { limit = 12, dcfg = DECK_CONFIG } = {}) {
  const colors = new Set(input.flatMap((c) => c.color_identity ?? []));
  const out = [];
  for (const cmd of commanders) {
    const ci = new Set(cmd.entry.card.color_identity);
    if (![...colors].every((c) => ci.has(c))) continue;
    const members = input
      .filter((c) => c.oracle_id !== cmd.entry.card.oracle_id)
      .map((c) => index.get(c.oracle_id))
      .filter(Boolean);
    if (!members.length) continue;
    let best = null;
    for (const theme of usableThemes(cmd.themes)) {
      let fitSum = 0, count = 0;
      const tags = new Map();
      for (const e of members) {
        const tf = themeFit(e, theme);
        if (tf.fit < dcfg.memberFit || tf.offAnchor) continue;
        fitSum += tf.fit;
        count++;
        for (const m of tf.matched) if (m.contrib > 0) tags.set(m.tag, (tags.get(m.tag) ?? 0) + 1);
      }
      if (!best || fitSum > best.fitSum) best = { theme, fitSum, count, tags };
    }
    let synergy = 0;
    const linkTags = new Map();
    for (const e of members) {
      const cs = commanderSynergy(e, cmd.entry);
      synergy += cs.raw;
      for (const l of cs.links) linkTags.set(l.tag, (linkTags.get(l.tag) ?? 0) + 1);
    }
    const score = (best?.fitSum ?? 0) + dcfg.synergyWeight * synergy;
    if (score <= 0) continue;
    out.push({
      slug: cmd.slug,
      oracle_id: cmd.entry.card.oracle_id,
      name: cmd.entry.card.name,
      score,
      theme: best && best.count ? { id: best.theme.id, name: best.theme.name, count: best.count,
        tags: [...best.tags.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag) } : null,
      synergyTags: [...linkTags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tag]) => tag),
      scored: members.length,
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
