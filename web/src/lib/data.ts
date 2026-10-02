import "server-only";
import { buildIndex, type Card, type CardTag, type Index, type IndexEntry, type Theme } from "@edh-tool/engine";
import { buildNameIndex } from "@edh-tool/engine/decklist";
import { cache } from "react";
import type { CardLite } from "@/lib/types";
import { db } from "./db";
import { ttlMap } from "./ttlMap";

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
// The scoring pool only needs what scoring uses. Images and links are ~40% of a row, so they are
// left out and fetched with hydrate() for the handful of cards a page actually shows.
const POOL_COLS = `c.oracle_id, c.name, c.mana_cost, c.cmc, c.type_line, c.types, c.supertypes, c.color_identity,
  c.commander_legal, c.edhrec_rank, c.game_changer, c.price_usd, c.quality`;

const clean = <T extends object>(row: T): T =>
  Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== "")) as T;

// ---------------------------------------------------------------- vocab

export const getVocab = cached(async (): Promise<Vocab> => {
  const r = await db().query("SELECT tag, category, definition FROM tag_vocab");
  return { tags: Object.fromEntries(r.rows.map((x) => [x.tag, { category: x.category, definition: x.definition }])) };
}, () => "vocab");

// ---------------------------------------------------------------- cards on demand (search, import, display)
// Never "load every card": that was ~9 MB per cold server instance. Each lookup asks Postgres for
// just the rows it needs, and recent rows are kept per instance.

const LITE_COLS = `c.oracle_id, c.name, c.mana_cost, c.cmc, c.type_line, c.color_identity, c.image, c.art_crop,
  c.commander_eligible, c.game_changer,
  (c.oracle_text ILIKE '%a deck can have any number of cards named%') AS any_number,
  (c.quality IS NOT NULL OR EXISTS (SELECT 1 FROM card_tags t WHERE t.oracle_id = c.oracle_id)) AS tagged`;
// engine normalizeName() in SQL: lower-case, accents gone, letters and digits only (indexed, see schema.sql)
const NAME_KEY = `regexp_replace(c.name_norm, '[^a-z0-9]', '', 'g')`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lite = ({ any_number, tagged, ...row }: Record<string, any>): CardLite => ({
  ...clean(row), cmc: row.cmc ?? 0,
  ...(any_number ? { any_number: true } : {}), ...(tagged ? { tagged: true } : {}),
}) as CardLite;

const LITE_TTL_MS = 30 * 60_000, LITE_MAX = 4000;
const liteCache = new Map<string, { at: number; card: CardLite }>();
const remember = (c: CardLite) => {
  liteCache.delete(c.oracle_id);
  liteCache.set(c.oracle_id, { at: Date.now(), card: c });
  while (liteCache.size > LITE_MAX) liteCache.delete(liteCache.keys().next().value!);
};

/** Display data for these cards, in the order asked (unknown / illegal ids are dropped). */
export async function cardsByIds(ids: string[]): Promise<CardLite[]> {
  const uniq = [...new Set(ids)];
  const now = Date.now();
  const missing = uniq.filter((id) => { const h = liteCache.get(id); return !h || now - h.at >= LITE_TTL_MS; });
  if (missing.length) {
    const r = await db().query(`SELECT ${LITE_COLS} FROM cards c WHERE c.commander_legal AND c.oracle_id = ANY($1::uuid[])`, [missing]);
    for (const row of r.rows) remember(lite(row));
  }
  return ids.flatMap((id) => { const h = liteCache.get(id); return h ? [h.card] : []; });
}

// React cache(): generateMetadata and the page ask for the same card in one render; query once.
export const getCard = cache(async (id: string): Promise<CardLite | null> => {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return (await cardsByIds([id]))[0] ?? null;
});

/** Card image and Scryfall link for the few cards a page shows (the pool leaves them out). */
type Hydrated = { image?: string; scryfall_uri?: string };
const hydrated = ttlMap<Hydrated>(4000);

export async function hydrate(ids: string[]): Promise<Map<string, Hydrated>> {
  const out = new Map<string, Hydrated>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const h = hydrated.get(id);
    if (h) out.set(id, h); else missing.push(id);
  }
  if (missing.length) {
    const r = await db().query("SELECT oracle_id, image, scryfall_uri FROM cards WHERE oracle_id = ANY($1::uuid[])", [missing]);
    for (const x of r.rows) {
      const v = clean({ image: x.image, scryfall_uri: x.scryfall_uri });
      hydrated.set(x.oracle_id, v);
      out.set(x.oracle_id, v);
    }
  }
  return out;
}

/** Name search: cards whose name starts with the query first (shortest first), then ones containing it. */
export async function searchCards(q: string, limit: number): Promise<CardLite[]> {
  if (!/^[a-z0-9]{2,}$/.test(q)) return [];
  const r = await db().query(
    `SELECT ${LITE_COLS} FROM cards c
      WHERE c.commander_legal AND ${NAME_KEY} LIKE $1
      ORDER BY (${NAME_KEY} LIKE $2) DESC, length(c.name), c.name LIMIT $3`,
    [`%${q}%`, `${q}%`, limit]);
  return r.rows.map((row) => { const c = lite(row); remember(c); return c; });
}

/**
 * Cards matching these already-normalized names (full names and each face of "A // B" cards),
 * as the same name index the importer has always used, built from just the candidates.
 */
// Face keys of every two-faced card (~2k rows). Matching a face needs them all, and doing it in SQL
// meant scanning the whole cards table on every import; here it is one small query per instance.
const multiFace = cached(async () => {
  const r = await db().query("SELECT oracle_id, name_norm FROM cards c WHERE c.commander_legal AND c.name_norm LIKE '% // %'");
  return r.rows.map((x) => ({
    id: x.oracle_id as string,
    faces: (x.name_norm as string).split(" // ").map((f) => f.replace(/[^a-z0-9]/g, "")),
  }));
}, () => "faces");

export async function nameCandidates(keys: string[]) {
  const uniq = [...new Set(keys.filter(Boolean))];
  if (!uniq.length) return { nameIndex: new Map<string, string>(), cards: [] as CardLite[] };
  const want = new Set(uniq);
  const faceIds = (await multiFace()).filter((m) => m.faces.some((f) => want.has(f))).map((m) => m.id);
  const r = await db().query(
    `SELECT ${LITE_COLS} FROM cards c
      WHERE c.commander_legal AND (${NAME_KEY} = ANY($1::text[]) OR c.oracle_id = ANY($2::uuid[]))`, [uniq, faceIds]);
  const cards = r.rows.map((row) => { const c = lite(row); remember(c); return c; });
  return { nameIndex: buildNameIndex(cards), cards };
}

/** "Did you mean" for names that matched nothing: nearest card names by trigram similarity, one
 *  query for the whole batch. Result i belongs to keys[i] (keys under 3 characters get none). */
export async function similarNames(keys: string[], limit = 3): Promise<{ oracle_id: string; name: string; score: number }[][]> {
  const out = keys.map(() => [] as { oracle_id: string; name: string; score: number }[]);
  const at = keys.flatMap((k, i) => (k.length >= 3 ? [i] : []));
  if (!at.length) return out;
  const r = await db().query(
    `SELECT k.i, s.oracle_id, s.name, s.score
       FROM unnest($1::text[]) WITH ORDINALITY AS k(key, i)
       CROSS JOIN LATERAL (
         SELECT c.oracle_id, c.name, similarity(${NAME_KEY}, k.key) AS score FROM cards c
          WHERE c.commander_legal AND ${NAME_KEY} % k.key ORDER BY score DESC, c.name LIMIT $2) s
      ORDER BY k.i, s.score DESC, s.name`, [at.map((i) => keys[i]), limit]);
  for (const x of r.rows)
    out[at[Number(x.i) - 1]].push({ oracle_id: x.oracle_id, name: x.name, score: +Number(x.score).toFixed(2) });
  return out;
}

// ---------------------------------------------------------------- one commander

interface Head { card: Card; themes: Theme[]; rankCeiling: number | null; mask: number; tags: CardTag[] }

async function head(slug: string): Promise<Head | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const r = await db().query(
    `SELECT ${CARD_COLS}, m.themes, m.rank_ceiling, m.ci_mask,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('tag', t.tag, 'role', t.role, 'strength', t.strength)
                                       ORDER BY t.strength DESC), '[]'::jsonb)
               FROM card_tags t WHERE t.oracle_id = c.oracle_id) AS own_tags
       FROM commanders m JOIN cards c USING (oracle_id) WHERE m.slug = $1`,
    [slug]);
  if (!r.rowCount) return null;
  const { themes, rank_ceiling, ci_mask, own_tags, ...card } = r.rows[0];
  return { card: clean(card) as Card, themes: (themes ?? []) as Theme[], rankCeiling: rank_ceiling, mask: ci_mask, tags: own_tags as CardTag[] };
}

/** Commander card, themes and own tags only: enough for the theme picker page. */
export const getCommanderSummary = cache(async (slug: string): Promise<CommanderSummary | null> => {
  const h = await head(slug);
  return h && { slug, commander: h.card, themes: h.themes, tags: h.tags };
});

// oracle id -> slug only changes when the catalog is reloaded, and every deck request needs it.
const slugs = ttlMap<string | null>(2000);
async function slugOf(oracleId: string): Promise<string | null> {
  const hit = slugs.get(oracleId);
  if (hit !== undefined) return hit;
  const r = await db().query("SELECT slug FROM commanders WHERE oracle_id = $1", [oracleId]);
  const slug = (r.rows[0]?.slug as string | undefined) ?? null;
  slugs.set(oracleId, slug);
  return slug;
}

/** Themes for a commander looked up by card id (the card page); null when it isn't a commander. */
export async function getCommanderSummaryByOracle(oracleId: string): Promise<CommanderSummary | null> {
  const slug = await slugOf(oracleId);
  return slug ? getCommanderSummary(slug) : null;
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
  const slug = await slugOf(oracleId);
  return slug ? getCommander(slug) : null;
}

// A deck's cards are re-analyzed on every edit, so keep each one's rows (null card = not tagged or not legal).
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const taggedCache = ttlMap<{ card: Row | null; tags: Row[] }>(3000);

/** The tagged cards among `ids`, as index rows (any legal card, whether or not it is in a commander's pool). */
async function taggedRows(ids: string[]) {
  const want = [...new Set(ids)];
  const missing = want.filter((id) => taggedCache.get(id) === undefined);
  if (missing.length) {
    const [c, t] = await Promise.all([
      db().query(`SELECT ${POOL_COLS} FROM cards c WHERE c.oracle_id = ANY($1::uuid[]) AND c.commander_legal
                    AND (c.quality IS NOT NULL OR EXISTS (SELECT 1 FROM card_tags x WHERE x.oracle_id = c.oracle_id))`, [missing]),
      db().query("SELECT oracle_id, tag, role, strength FROM card_tags WHERE oracle_id = ANY($1::uuid[])", [missing]),
    ]);
    const cardOf = new Map<string, Row>(c.rows.map((x) => [x.oracle_id as string, x]));
    const tagsOf = new Map<string, Row[]>();
    for (const x of t.rows) (tagsOf.get(x.oracle_id) ?? tagsOf.set(x.oracle_id, []).get(x.oracle_id)!).push(x);
    for (const id of missing) taggedCache.set(id, { card: cardOf.get(id) ?? null, tags: tagsOf.get(id) ?? [] });
  }
  const cardRows: Row[] = [], tagRows: Row[] = [];
  for (const id of want) {
    const h = taggedCache.get(id);
    if (h?.card) { cardRows.push(h.card); tagRows.push(...h.tags); }
  }
  return assemble(cardRows, tagRows);
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
    `SELECT m.slug, m.rank_ceiling, ${POOL_COLS},
            (SELECT jsonb_agg(t - 'pitch' - 'art') FROM jsonb_array_elements(m.themes) t) AS themes  -- scoring doesn't use pitch/art
       FROM commanders m JOIN cards c USING (oracle_id)
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
