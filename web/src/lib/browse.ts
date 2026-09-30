import "server-only";
import { db } from "./db";

export interface BrowseItem {
  slug: string;
  name: string;
  color_identity: string[];
  art_crop: string | null;
  themeCount: number;
}
export interface BrowseParams {
  colors: string;              // letters from WUBRG, "" = any
  mode: "within" | "exact";
  tag?: string;
  q?: string;
  themed?: boolean;
  after?: string;              // cursor: "<browse_key>:<oracle_id>"
  limit?: number;
}

const BIT: Record<string, number> = { W: 1, U: 2, B: 4, R: 8, G: 16 };
export const PAGE = 20;

export const parseColors = (s: string) => [...new Set(s.toUpperCase().split("").filter((c) => c in BIT))];
const maskOf = (cs: string[]) => cs.reduce((m, c) => m | BIT[c], 0);

/** Keyset-paginated commander list: stable order (browse_key, oracle_id), no OFFSET. */
export async function browse(p: BrowseParams): Promise<{ items: BrowseItem[]; next: string | null }> {
  const limit = Math.min(p.limit ?? PAGE, 50);
  const where: string[] = [];
  const args: unknown[] = [];
  const arg = (v: unknown) => (args.push(v), `$${args.length}`);

  const cs = parseColors(p.colors);
  if (cs.length || p.mode === "exact") {
    const m = arg(maskOf(cs));
    where.push(p.mode === "exact" ? `m.ci_mask = ${m}::int` : `(m.ci_mask & ~${m}::int) = 0`);
  }
  if (p.tag && /^[a-z0-9_:]+$/i.test(p.tag)) where.push(`m.tags @> ARRAY[${arg(p.tag)}]::text[]`);
  if (p.q?.trim()) where.push(`m.name ILIKE ${arg(`%${p.q.trim().replace(/[%_\\]/g, "\\$&")}%`)}`);
  if (p.themed) where.push("m.themes IS NOT NULL");
  const cur = /^(\d+):([0-9a-f-]{36})$/.exec(p.after ?? "");
  if (cur) where.push(`(m.browse_key, m.oracle_id) > (${arg(Number(cur[1]))}::int, ${arg(cur[2])}::uuid)`);

  const r = await db().query(
    `SELECT m.slug, m.name, m.oracle_id, m.browse_key, c.color_identity, c.art_crop,
            COALESCE(jsonb_array_length(m.themes), 0) AS theme_count
       FROM commanders m JOIN cards c USING (oracle_id)
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY m.browse_key, m.oracle_id LIMIT ${limit + 1}`,
    args,
  );
  const rows = r.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    items: rows.map((x) => ({ slug: x.slug, name: x.name, color_identity: x.color_identity, art_crop: x.art_crop, themeCount: x.theme_count })),
    next: r.rows.length > limit && last ? `${last.browse_key}:${last.oracle_id}` : null,
  };
}

export interface FeaturedItem extends BrowseItem {
  theme: { id: string; name: string; pitch: string; tags: string[] } | null;
}

/** Random themed commanders for the home page, each paired with one randomly chosen usable
 *  theme so the card shows an archetype rather than a theme count. Cached by the page's revalidate. */
export async function featured(n = 8): Promise<FeaturedItem[]> {
  const r = await db().query(
    `SELECT m.slug, m.name, c.color_identity, c.art_crop, m.themes
       FROM commanders m JOIN cards c USING (oracle_id)
      WHERE m.themes IS NOT NULL AND jsonb_array_length(m.themes) > 0
      ORDER BY random() LIMIT $1`, [n * 3]);
  const out: FeaturedItem[] = [];
  for (const x of r.rows) {
    const usable = (x.themes as { id: string; name: string; pitch?: string; status?: string; tags?: { tag: string }[] }[])
      .filter((t) => ["ok", "relaxed", "fallback"].includes(t.status ?? "ok"));
    if (!usable.length) continue;
    const t = usable[Math.floor(Math.random() * usable.length)];
    out.push({
      slug: x.slug, name: x.name, color_identity: x.color_identity, art_crop: x.art_crop, themeCount: usable.length,
      theme: { id: t.id, name: t.name, pitch: t.pitch ?? "", tags: (t.tags ?? []).map((g) => g.tag).slice(0, 3) },
    });
    if (out.length >= n) break;
  }
  return out;
}

/** Tags commanders can be filtered by, with how many commanders carry each. */
export async function tagCounts(): Promise<{ tag: string; count: number }[]> {
  const r = await db().query(
    `SELECT tag, count(*)::int AS count FROM commanders m, unnest(m.tags) AS tag GROUP BY tag HAVING count(*) >= 5 ORDER BY count DESC`);
  return r.rows;
}
