// Decklist text in and out: parse what Moxfield, Archidekt, MTGO and Arena export, match
// names to cards, and write lists those sites import. Pure functions (no I/O).

// ---------------------------------------------------------------- parsing

const SECTION_ALIASES = {
  commander: "commander", commanders: "commander",
  deck: "main", main: "main", mainboard: "main", maindeck: "main", "main deck": "main",
  sideboard: "side", side: "side",
  maybeboard: "maybe", maybe: "maybe", considering: "maybe",
  companion: "side",
};

/** "Commander", "// Sideboard", "SIDEBOARD:", "Maybeboard (12)" → section name, else null. */
export function sectionHeader(line) {
  const m = line.replace(/^\/\/\s*/, "").replace(/\s*\(\d+\)\s*$/, "").replace(/:$/, "").trim().toLowerCase();
  return SECTION_ALIASES[m] ?? null;
}

const CATEGORY_SECTION = { commander: "commander", maybeboard: "maybe", sideboard: "side", considering: "maybe" };

/**
 * One card line → { qty, name, printing?, foil?, categories? } or null when it isn't a card line.
 *   "1 Sol Ring", "1x Sol Ring", "Sol Ring", "1 Sol Ring (C21) 263", "1 Sol Ring (C21) 263 *F*",
 *   "1x Sol Ring (c21) 263 [Ramp,Artifact] ^Have,#37d67a^", "SB: 1 Tormod's Crypt"
 */
export function parseLine(raw) {
  let s = raw.trim();
  if (!s || s.startsWith("#") || s.startsWith("//")) return null;
  let sideboard = false;
  if (/^SB:\s*/i.test(s)) { sideboard = true; s = s.replace(/^SB:\s*/i, ""); }
  const out = {};
  // Archidekt label ^Have,#37d67a^ and categories [Ramp,Commander{top}]
  s = s.replace(/\s*\^[^^]*\^\s*$/, "");
  const cat = s.match(/\s*\[([^\]]*)\]\s*$/);
  if (cat) {
    out.categories = cat[1].split(",").map((c) => c.replace(/\{[^}]*\}/g, "").trim()).filter(Boolean);
    s = s.slice(0, cat.index);
  }
  // foil / etched markers
  const foil = s.match(/\s*\*([A-Za-z]+)\*\s*$/);
  if (foil) { out.foil = foil[1].toUpperCase(); s = s.slice(0, foil.index); }
  // printing: (SET) 123 — collector numbers can have letters, ★ or a dash (e.g. "123a", "PLST-1")
  const pr = s.match(/\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★\-]+))?\s*$/);
  if (pr) { out.printing = `(${pr[1].toUpperCase()})${pr[2] ? ` ${pr[2]}` : ""}`; s = s.slice(0, pr.index); }
  const q = s.match(/^(\d+)\s*[xX]?\s+(.+)$/);
  out.qty = q ? Math.max(1, Math.min(250, Number(q[1]))) : 1;
  out.name = (q ? q[2] : s).trim();
  if (!out.name || /^\d+$/.test(out.name)) return null;
  if (sideboard) out.section = "side";
  return out;
}

/**
 * Parse a whole list. Section headers switch the current board; Archidekt categories
 * named Commander / Maybeboard / Sideboard override it per line. Arena's "About / Name …"
 * block is skipped. Returns { entries, name? }.
 */
export function parseDecklist(text) {
  const entries = [];
  let section = "main", name, inAbout = false;
  for (const raw of String(text ?? "").replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { inAbout = false; continue; }
    if (/^about$/i.test(line)) { inAbout = true; continue; }
    if (inAbout) { const m = line.match(/^name\s+(.+)$/i); if (m) name = m[1].trim(); continue; }
    const header = sectionHeader(line);
    if (header) { section = header; continue; }
    const p = parseLine(line);
    if (!p) continue;
    let sec = p.section ?? section;
    for (const c of p.categories ?? []) {
      const s = CATEGORY_SECTION[c.toLowerCase()];
      if (s) { sec = s; break; }
    }
    entries.push({ line: raw.trim(), qty: p.qty, name: p.name, section: sec,
      ...(p.printing && { printing: p.printing }), ...(p.categories && { categories: p.categories }) });
  }
  return { entries, ...(name && { name }) };
}

// ---------------------------------------------------------------- name matching

/** Lowercase, no accents, straight apostrophes, only letters/digits: "Lim-Dûl's Vault" → "limdulsvault". */
export function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/^a-(?=\S)/, "")        // Alchemy rebalanced "A-" prefix
    .replace(/[^a-z0-9]/g, "");
}

/** Map normalized name (full name AND each face of split/double-faced cards) → oracle_id. */
export function buildNameIndex(cards) {
  const idx = new Map();
  for (const c of cards) {
    idx.set(normalizeName(c.name), c.oracle_id);
  }
  for (const c of cards) {           // faces never shadow a real card with that exact name
    if (!c.name.includes(" // ")) continue;
    for (const face of c.name.split(" // ")) {
      const k = normalizeName(face);
      if (!idx.has(k)) idx.set(k, c.oracle_id);
    }
  }
  return idx;
}

export function lookupName(nameIndex, name) {
  const direct = nameIndex.get(normalizeName(name));
  if (direct) return direct;
  if (name.includes("/")) {          // "Fire/Ice", "Fire // Ice" with odd spacing: try the front face
    return nameIndex.get(normalizeName(name.split("/")[0])) ?? null;
  }
  return null;
}

const bigrams = (s) => {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
  return out;
};

/** Closest card names by bigram (Dice) similarity, for "did you mean" on unmatched lines. */
export function suggestNames(cards, name, limit = 3) {
  const q = normalizeName(name);
  if (q.length < 3) return [];
  const qb = bigrams(q);
  const qn = q.length - 1;
  const scored = [];
  for (const c of cards) {
    const k = normalizeName(c.name);
    if (Math.abs(k.length - q.length) > Math.max(6, q.length)) continue;
    let hit = 0;
    const kb = bigrams(k);
    for (const [g, n] of qb) hit += Math.min(n, kb.get(g) ?? 0);
    const dice = (2 * hit) / (qn + Math.max(1, k.length - 1));
    if (dice >= 0.5) scored.push([dice, c]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([score, c]) => ({ oracle_id: c.oracle_id, name: c.name, score: +score.toFixed(2) }));
}

/**
 * Resolve parsed entries. Same card + board is merged (quantities add up, the first
 * printing wins). Returns { cards: [{oracle_id, qty, board, printing?}], commanders: [ids],
 * unresolved: [{line, name, qty, section}] }. Sideboard lines go to the maybeboard.
 */
export function resolveEntries(entries, nameIndex) {
  const merged = new Map(), commanders = [], unresolved = [];
  for (const e of entries) {
    const id = lookupName(nameIndex, e.name);
    if (!id) { unresolved.push({ line: e.line, name: e.name, qty: e.qty, section: e.section }); continue; }
    if (e.section === "commander") { if (!commanders.includes(id)) commanders.push(id); continue; }
    const board = e.section === "main" ? "main" : "maybe";
    const key = `${id}|${board}`;
    const prev = merged.get(key);
    if (prev) prev.qty += e.qty;
    else merged.set(key, { oracle_id: id, qty: e.qty, board, ...(e.printing && { printing: e.printing }) });
  }
  return { cards: [...merged.values()], commanders, unresolved };
}

// ---------------------------------------------------------------- export

/**
 * deck:  { commanders: [ids], cards: [{oracle_id, qty, board, printing?}] }
 * names: Map/obj oracle_id → card name
 * opts:  format "text" | "moxfield" | "archidekt", printings (default true),
 *        maybeboard (default true), categories: Map/obj oracle_id → category (Archidekt only)
 */
export function exportDecklist(deck, names, { format = "text", printings = true, maybeboard = true, categories } = {}) {
  const nameOf = (id) => (names instanceof Map ? names.get(id) : names[id]) ?? id;
  const catOf = (id) => (categories instanceof Map ? categories.get(id) : categories?.[id]);
  const byName = (a, b) => nameOf(a.oracle_id).localeCompare(nameOf(b.oracle_id));
  const main = deck.cards.filter((c) => c.board === "main").sort(byName);
  const maybe = deck.cards.filter((c) => c.board === "maybe").sort(byName);
  const pr = (c) => (printings && c.printing ? ` ${c.printing}` : "");

  if (format === "archidekt") {
    // Archidekt's importer reads [Category] tags; {top} pins the commander, {noDeck}{noPrice}
    // keeps the maybeboard out of the deck count and price.
    const line = (c, cats) => `${c.qty}x ${nameOf(c.oracle_id)}${pr(c)}${cats.length ? ` [${cats.join(",")}]` : ""}`;
    const rows = [
      ...deck.commanders.map((id) => line({ oracle_id: id, qty: 1 }, ["Commander{top}"])),
      ...main.map((c) => line(c, catOf(c.oracle_id) ? [catOf(c.oracle_id)] : [])),
      ...(maybeboard ? maybe.map((c) => line(c, ["Maybeboard{noDeck}{noPrice}"])) : []),
    ];
    return rows.join("\n") + "\n";
  }
  // "text" and "moxfield": Arena-style sections, which both sites' importers understand
  const line = (c) => `${c.qty} ${nameOf(c.oracle_id)}${pr(c)}`;
  const blocks = [];
  if (deck.commanders.length) blocks.push(["Commander", ...deck.commanders.map((id) => line({ oracle_id: id, qty: 1 }))]);
  blocks.push(["Deck", ...main.map(line)]);
  if (maybeboard && maybe.length) blocks.push(["Maybeboard", ...maybe.map(line)]);
  return blocks.map((b) => b.join("\n")).join("\n\n") + "\n";
}
