import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildIndex, type Card, type Index, type IndexEntry, type Theme } from "@edh-tool/engine";
import { buildNameIndex } from "@edh-tool/engine/decklist";
import type { CardLite } from "@/lib/types";

// Files written by `python -m pipeline.export_web` (repo root):
//   pool.json        tagged cards + tags + art (one scoring pool shared by every commander)
//   cards.json       every Commander-legal card, display fields only
//   commanders.json  commanders with themes
const DATA_DIR = path.join(process.cwd(), "data");

export interface CommanderListing {
  slug: string;
  name: string;
  oracle_id: string;
  color_identity: string[];
  art_crop?: string;
  image?: string;
  artist?: string;
  themes: { id: string; name: string; kind: "core" | "stretch" }[];
  pool: number;
}

export interface CommanderData {
  slug: string;
  commander: Card;
  themes: Theme[];
  index: Index;
  entry: IndexEntry;
}

export interface Vocab {
  version: string;
  categories: Record<string, string>;
  tags: Record<string, { category: string; definition: string }>;
}

const readJson = async <T,>(file: string): Promise<T> =>
  JSON.parse(await readFile(path.join(DATA_DIR, file), "utf8")) as T;

// Everything below is parsed once per server instance and kept in memory.
const once = <T,>(load: () => Promise<T>) => {
  let p: Promise<T> | null = null;
  return () => (p ??= load().catch((e) => { p = null; throw e; }));
};

export const getVocab = once(() => readJson<Vocab>("vocab.json"));

/** The scoring index over every tagged card. */
export const getPool = once(async () => {
  const b = await readJson<{
    rankCeiling?: number;
    cards: Card[];
    tags: Parameters<typeof buildIndex>[1];
    art: NonNullable<Parameters<typeof buildIndex>[2]>["art"];
    artTags: NonNullable<Parameters<typeof buildIndex>[2]>["artTags"];
  }>("pool.json");
  const index = buildIndex(b.cards, b.tags, { rankCeiling: b.rankCeiling, art: b.art, artTags: b.artTags });
  return { index };
});

/** Every Commander-legal card (tagged or not), for import, search and deck display. */
export const getAllCards = once(async () => {
  const [cards, { index }] = await Promise.all([readJson<CardLite[]>("cards.json"), getPool()]);
  for (const c of cards) if (index.has(c.oracle_id)) c.tagged = true;
  const byId = new Map(cards.map((c) => [c.oracle_id, c]));
  return { cards, byId, nameIndex: buildNameIndex(cards) };
});

type CommanderRow = { slug: string; commander: Card; themes: Theme[] };

export const getCommanderRows = once(async () => {
  const rows = await readJson<CommanderRow[]>("commanders.json");
  return { rows, bySlug: new Map(rows.map((r) => [r.slug, r])), byOracle: new Map(rows.map((r) => [r.commander.oracle_id, r])) };
});

/** Commanders ready for scoring: their index entry plus themes. */
export const getScorableCommanders = once(async () => {
  const [{ rows }, { index }] = await Promise.all([getCommanderRows(), getPool()]);
  return rows.flatMap((r) => {
    const entry = index.get(r.commander.oracle_id);
    return entry ? [{ slug: r.slug, entry, themes: r.themes }] : [];
  });
});

export async function listCommanders(): Promise<CommanderListing[]> {
  const [{ rows }, { index }] = await Promise.all([getCommanderRows(), getPool()]);
  const poolSize = new Map<string, number>();
  const sizeFor = (ci: string[]) => {
    const key = [...ci].sort().join("");
    if (!poolSize.has(key)) {
      const allowed = new Set(ci);
      let n = 0;
      for (const e of index.values()) if (e.card.color_identity.every((c) => allowed.has(c))) n++;
      poolSize.set(key, n);
    }
    return poolSize.get(key)!;
  };
  return rows.map(({ slug, commander: c, themes }) => ({
    slug, name: c.name, oracle_id: c.oracle_id, color_identity: c.color_identity,
    art_crop: c.art_crop ?? undefined, image: c.image ?? undefined, artist: c.artist ?? undefined,
    themes: themes.map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
    pool: sizeFor(c.color_identity),
  }));
}

export async function getCommander(slug: string): Promise<CommanderData | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const [{ bySlug }, { index }] = await Promise.all([getCommanderRows(), getPool()]);
  const row = bySlug.get(slug);
  const entry = row && index.get(row.commander.oracle_id);
  if (!row || !entry) return null;
  return { slug, commander: row.commander, themes: row.themes, index, entry };
}

export async function getCommanderByOracle(oracleId: string): Promise<CommanderData | null> {
  const { byOracle } = await getCommanderRows();
  const row = byOracle.get(oracleId);
  return row ? getCommander(row.slug) : null;
}
