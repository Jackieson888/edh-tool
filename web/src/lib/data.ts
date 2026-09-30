import "server-only";
import { buildIndex, type Card, type CardTag, type Index, type IndexEntry, type Theme } from "@edh-tool/engine";
import { buildNameIndex } from "@edh-tool/engine/decklist";
import type { CardLite } from "@/lib/types";
import { db } from "./db";

// Everything comes from Postgres (DATABASE_URL); `python -m pipeline.load_db` fills it.
// Nothing here loads "the whole pool": a commander's scoring pool is fetched on demand
// (legal cards in its colors that carry one of its theme tags: the only cards that can score),
// cached per server instance, and deck-specific extras are layered on top per request.

export interface CommanderData {
  slug: string;
  commander: Card;
  themes: Theme[];
  tags: CardTag[];     // the commander's own tags
  index: Index;
  entry: IndexEntry;
}
export type CommanderSummary = Omit<CommanderData, "index" | "entry">;

export interface Vocab {
  tags: Record<string, { category: string; definition: string }>;
}

const TTL_MS = 30 * 60_000;

/** Parse-once-per-instance loader with a TTL and no caching of failures. */
const cached = <A extends unknown[], T>(load: (...a: A) => Promise<T>, key: (...a: A) => string, max = 1) => {
  const m = new Map<string, { at: number; p: Promise<T> }>();
  return (...a: A): Promise<T> => {
    const k = key(...a), hit = m.get(k);
    if (hit && Date.now() - hit.at < TTL_MS) { m.delete(k); m.set(k, hit); return hit.p; }
    const p = load(...a);
    p.catch(() => m.delete(k));
    m.set(k, { at: Date.now(), p });
    while (m.size > max) m.delete(m.keys().next().value!);
    return p;
  };
};

const CARD_COLS = `c.oracle_id, c.name, c.mana_cost, c.cmc, c.type_line, c.types, c.supertypes, c.subtypes,
  c.oracle_text, c.power, c.toughness, c.color_identity, c.commander_legal, c.commander_eligible,
  c.edhrec_rank, c.game_changer, c.price_usd, c.image, c.image_small, c.art_crop, c.artist, c.scryfall_uri`;
// the scoring pool only needs what scoring and the pick tiles use
const POOL_COLS = `c.oracle_id, c.name, c.mana_cost, c.type_line, c.types, c.supertypes, c.color_identity,
  c.commander_legal, c.edhrec_rank, c.game_changer, c.price_usd, c.image, c.scryfall_uri, c.quality`;

const clean = <T extends object>(row: T): T =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== "")) as T;

// ---------------------------------------------------------------- vocab

export const getVocab = cached(async (): Promise<Vocab> => {
  const r = await db().query("SELECT tag, category, definition FROM tag_vocab");
  return { tags: Object.fromEntries(r.rows.map((x) => [x.tag, { category: x.category, definition: x.definition }])) };
}, () => "vocab");

// ---------------------------------------------------------------- every legal card (search, import, display)

export const getAllCards = cached(async () => {
  const r = await db().query(
    `SELECT c.oracle_id, c.name, c.mana_cost, c.cmc, c.type_line, c.color_identity, c.image, c.art_crop,
            c.commander_eligible, c.game_changer,
            (c.oracle_text ILIKE '%a deck can have any number of cards named%') AS any_number,
            (c.quality IS NOT NULL OR EXISTS (SELECT 1 FROM card_tags t WHERE t.oracle_id = c.oracle_id)) AS tagged
       FROM cards c WHERE c.commander_legal ORDER BY c.name`);
  const cards: CardLite[] = r.rows.map(({ any_number, tagged, ...row }) => ({
    ...clean(row), cmc: row.cmc ?? 0,
    ...(any_number ? { any_number: true } : {}), ...(tagged ? { tagged: true } : {}),
  }));
  return { cards, byId: new Map(cards.map((c) => [c.oracle_id, c])), nameIndex: buildNameIndex(cards) };
}, () => "all");

// ---------------------------------------------------------------- one commander

interface Head { card: Card; themes: Theme[]; rankCeiling: number | null; mask: number; tags: CardTag[] }

async function head(slug: string): Promise<Head | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const r = await db().query(
    `SELECT ${CARD_COLS}, m.themes, m.rank_ceiling, m.ci_mask FROM commanders m JOIN cards c USING (oracle_id) WHERE m.slug = $1`,
    [slug]);
  if (!r.rowCount) return null;
  const { themes, rank_ceiling, ci_mask, ...card } = r.rows[0];
  const t = await db().query("SELECT tag, role, strength FROM card_tags WHERE oracle_id = $1 ORDER BY strength DESC", [card.oracle_id]);
  return { card: clean(card) as Card, themes: (themes ?? []) as Theme[], rankCeiling: rank_ceiling, mask: ci_mask, tags: t.rows };
}

/** Commander card, themes and own tags only: enough for the theme picker page. */
export async function getCommanderSummary(slug: string): Promise<CommanderSummary | null> {
  const h = await head(slug);
  return h && { slug, commander: h.card, themes: h.themes, tags: h.tags };
}

/** Themes for a commander looked up by card id (the card page); null when it isn't a commander. */
export async function getCommanderSummaryByOracle(oracleId: string): Promise<CommanderSummary | null> {
  const r = await db().query("SELECT slug FROM commanders WHERE oracle_id = $1", [oracleId]);
  return r.rowCount ? getCommanderSummary(r.rows[0].slug) : null;
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type ArtRows = NonNullable<Parameters<typeof buildIndex>[2]>;

async function loadCommander(slug: string): Promise<CommanderData | null> {
  const h = await head(slug);
  if (!h || !h.themes.length) return null;
  const themeTags = [...new Set(h.themes.flatMap((t) => t.tags.map((x) => x.tag)))];
  const keepTags = [...new Set([...themeTags, ...h.tags.map((t) => t.tag)])];

  const POOL = `c.commander_legal AND (c.ci_mask & ~$1::int) = 0 AND (c.oracle_id = $3 OR EXISTS
      (SELECT 1 FROM card_tags t WHERE t.oracle_id = c.oracle_id AND t.tag = ANY($2::text[])))`;
  const [cardsR, tagsR] = await Promise.all([
    db().query(`SELECT ${POOL_COLS} FROM cards c WHERE ${POOL}`, [h.mask, themeTags, h.card.oracle_id]),
    db().query(
      `SELECT t.oracle_id, t.tag, t.role, t.strength FROM card_tags t JOIN cards c USING (oracle_id)
        WHERE t.tag = ANY($4::text[]) AND ${POOL}`,
      [h.mask, themeTags, h.card.oracle_id, keepTags]),
  ]);
  const { cards, cardTags } = assemble(cardsR.rows, tagsR.rows);

  // Art only matters through the themes' art directions, so fetch just the printings that match one.
  const want: Record<string, Set<string>> = {};
  for (const t of h.themes)
    for (const [f, vals] of Object.entries(t.art ?? {}))
      for (const v of vals as string[]) (want[f] ??= new Set()).add(String(v).toLowerCase());
  const conds: string[] = [];
  const args: unknown[] = [h.mask, themeTags, h.card.oracle_id];
  for (const f of ["mood", "setting", "palette", "lighting", "subject"]) {
    if (want[f]?.size) { args.push([...want[f]]); conds.push(`at.${f} && $${args.length}::text[]`); }
  }
  if (want.motifs?.size) {
    args.push(`(^|[\\s(])(${[...want.motifs].map(escRe).join("|")})($|[\\s)])`);
    conds.push(`EXISTS (SELECT 1 FROM unnest(at.motifs) m WHERE m ~* $${args.length})`);
  }
  let art: ArtRows["art"] = [], artTags: ArtRows["artTags"] = [];
  if (conds.length) {
    const r = await db().query(
      `SELECT a.illustration_id, a.oracle_id, a.face, a.artist, a.set_code AS set, a.image,
              at.mood, at.setting, at.palette, at.lighting, at.subject, at.motifs
         FROM art a JOIN art_tags at USING (illustration_id) JOIN cards c ON c.oracle_id = a.oracle_id
        WHERE ${POOL} AND (${conds.join(" OR ")}) ORDER BY a.seq`, args);
    art = r.rows.map(({ illustration_id, oracle_id, face, artist, set, image }) =>
      clean({ illustration_id, oracle_id, face, artist, set, image }));
    artTags = r.rows.map(({ illustration_id, mood, setting, palette, lighting, subject, motifs }) => ({
      illustration_id, mood, setting, palette, lighting, subject, motifs }));
  }

  const index = buildIndex(cards, cardTags, { rankCeiling: h.rankCeiling ?? undefined, art, artTags });
  const entry = index.get(h.card.oracle_id);
  return entry ? { slug, commander: h.card, themes: h.themes, tags: h.tags, index, entry } : null;
}

function assemble(cardRows: Record<string, any>[], tagRows: Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const cards: Card[] = [];
  const quality = new Map<string, number | null>();
  for (const { quality: q, ...row } of cardRows) { cards.push(clean(row) as Card); quality.set(row.oracle_id, q); }
  const byCard = new Map<string, CardTag[]>();
  for (const { oracle_id, ...t } of tagRows) {
    if (!quality.has(oracle_id)) continue;
    (byCard.get(oracle_id) ?? byCard.set(oracle_id, []).get(oracle_id)!).push(t as CardTag);
  }
  return {
    cards,
    cardTags: cards.map((c) => ({ oracle_id: c.oracle_id, name: c.name, quality: quality.get(c.oracle_id) ?? null, tags: byCard.get(c.oracle_id) ?? [] })),
  };
}

// Building a pool takes a few queries, so keep the last few commanders per server instance.
export const getCommander = cached((slug: string) => loadCommander(slug), (slug) => slug, 4);

export async function getCommanderByOracle(oracleId: string): Promise<CommanderData | null> {
  if (!/^[0-9a-f-]{36}$/.test(oracleId)) return null;
  const r = await db().query("SELECT slug FROM commanders WHERE oracle_id = $1", [oracleId]);
  return r.rowCount ? getCommander(r.rows[0].slug) : null;
}

/** The tagged cards among `ids`, as index rows (any legal card, whether or not it is in a commander's pool). */
async function taggedRows(ids: string[]) {
  if (!ids.length) return { cards: [] as Card[], cardTags: [] as ReturnType<typeof assemble>["cardTags"] };
  const [c, t] = await Promise.all([
    db().query(`SELECT ${POOL_COLS} FROM cards c WHERE c.oracle_id = ANY($1::uuid[]) AND c.commander_legal
                  AND (c.quality IS NOT NULL OR EXISTS (SELECT 1 FROM card_tags x WHERE x.oracle_id = c.oracle_id))`, [ids]),
    db().query("SELECT oracle_id, tag, role, strength FROM card_tags WHERE oracle_id = ANY($1::uuid[])", [ids]),
  ]);
  return assemble(c.rows, t.rows);
}

/**
 * A commander's index plus the given deck cards. Deck cards outside the slim pool (no theme tag)
 * still count as analyzed, exactly as they did when one index held every tagged card.
 */
export async function withDeckCards(data: CommanderData, ids: string[]): Promise<CommanderData> {
  const extra = [...new Set(ids)].filter((id) => !data.index.has(id));
  if (!extra.length) return data;
  const { cards, cardTags } = await taggedRows(extra);
  const rankCeiling = data.index.get(data.commander.oracle_id)?.rankCeiling;
  const more = buildIndex(cards, cardTags, { rankCeiling });
  return { ...data, index: new Map([...data.index, ...more]) };
}

// ---------------------------------------------------------------- commanders for a card or a pile (suggest.ts)

/** Commanders with themes, with their own index entries: small (hundreds of rows), kept per instance. */
const themedCommanders = cached(async () => {
  const r = await db().query(
    `SELECT m.slug, m.themes, m.rank_ceiling, ${POOL_COLS} FROM commanders m JOIN cards c USING (oracle_id)
      WHERE m.themes IS NOT NULL AND c.commander_legal`);
  const ids = r.rows.map((x) => x.oracle_id);
  const t = await db().query("SELECT oracle_id, tag, role, strength FROM card_tags WHERE oracle_id = ANY($1::uuid[])", [ids]);
  const { cards, cardTags } = assemble(r.rows.map(({ slug, themes, rank_ceiling, ...c }) => { void slug; void themes; void rank_ceiling; return c; }), t.rows);
  const index = buildIndex(cards, cardTags, { rankCeiling: r.rows[0]?.rank_ceiling ?? undefined });
  const commanders = r.rows.flatMap((x) => {
    const entry = index.get(x.oracle_id);
    return entry ? [{ slug: x.slug as string, entry, themes: x.themes as Theme[] }] : [];
  });
  return { index, commanders };
}, () => "themed");

/** Index over the cards in `ids` plus every themed commander, and the commanders to score. */
export async function getSuggestionInputs(ids: string[]) {
  const [base, { cards, cardTags }] = await Promise.all([themedCommanders(), taggedRows([...new Set(ids)])]);
  const own = buildIndex(cards, cardTags, { rankCeiling: base.commanders[0]?.entry.rankCeiling });
  return { index: new Map([...base.index, ...own]) as Index, commanders: base.commanders };
}
