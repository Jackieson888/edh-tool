import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildIndex, type Card, type Index, type IndexEntry, type Theme } from "@edh-tool/engine";

// Bundles are produced by `python -m pipeline.export_web` (repo root).
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

export const listCommanders = () => readJson<CommanderListing[]>("commanders/index.json");

let vocabCache: Promise<Vocab> | null = null;
export const getVocab = () => (vocabCache ??= readJson<Vocab>("vocab.json"));

// Building an index means parsing a multi-MB bundle, so keep it per server instance.
const cache = new Map<string, Promise<CommanderData | null>>();

export function getCommander(slug: string): Promise<CommanderData | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return Promise.resolve(null);
  let p = cache.get(slug);
  if (!p) {
    p = load(slug);
    cache.set(slug, p);
  }
  return p;
}

async function load(slug: string): Promise<CommanderData | null> {
  let b;
  try {
    b = await readJson<{
      commander: Card; themes: Theme[]; rankCeiling?: number;
      cards: Card[]; tags: Parameters<typeof buildIndex>[1];
      art: NonNullable<Parameters<typeof buildIndex>[2]>["art"];
      artTags: NonNullable<Parameters<typeof buildIndex>[2]>["artTags"];
    }>(`commanders/${slug}.json`);
  } catch {
    return null;
  }
  const index = buildIndex(b.cards, b.tags, { rankCeiling: b.rankCeiling, art: b.art, artTags: b.artTags });
  const entry = index.get(b.commander.oracle_id);
  if (!entry) return null;
  return { slug, commander: b.commander, themes: b.themes, index, entry };
}
