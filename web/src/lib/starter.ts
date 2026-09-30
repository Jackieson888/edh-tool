import "server-only";
import { DEFAULT_CONFIG, rankTheme, sampleRecs } from "@edh-tool/engine";
import { pipsOf } from "@edh-tool/engine/analytics";
import { BASIC_NAME, basicWeights, splitBasics } from "@edh-tool/engine/starter";
import type { CommanderData } from "@/lib/data";
import { db } from "@/lib/db";
import type { DeckCard } from "@/lib/types";

const BIT: Record<string, number> = { W: 1, U: 2, B: 4, R: 8, G: 16 };
export const STARTER = { themeCards: 18, ramp: 3, draw: 2, removal: 2, lands: 20 };

export interface Starter {
  name: string;
  cards: DeckCard[];
  counts: { theme: number; foundation: number; lands: number };
}

/** A few proven, cheap staples for a role, legal in the commander's colors. */
async function foundation(tag: string, maxCmc: number, mask: number, n: number, exclude: string[]) {
  const r = await db().query(
    `SELECT c.oracle_id FROM cards c JOIN card_tags t ON t.oracle_id = c.oracle_id AND t.tag = $1
      WHERE t.strength >= 0.6 AND c.commander_legal AND (c.ci_mask & ~$2::int) = 0
        AND c.cmc <= $3 AND NOT ('Land' = ANY(c.types)) AND c.oracle_id <> ALL($4::uuid[])
      ORDER BY c.edhrec_rank NULLS LAST LIMIT $5`, [tag, mask, maxCmc, exclude, n]);
  return r.rows.map((x) => x.oracle_id as string);
}

/**
 * A starter list for one theme: ~18 cards that fit it, a handful of cheap ramp/draw/removal,
 * and 20 lands (popular on-color fixing plus basics weighted by the spells' mana symbols).
 * The player fills the remaining ~55 slots themselves.
 */
export async function buildStarter(data: CommanderData, themeId: string, seed: string): Promise<Starter | null> {
  const theme = data.themes.find((t) => t.id === themeId);
  if (!theme) return null;
  const identity = data.commander.color_identity;
  const mask = identity.reduce((m, c) => m | (BIT[c] ?? 0), 0);
  const commanderId = data.commander.oracle_id;

  // 1. cheap staples first, so the theme picks don't duplicate them
  const taken = [commanderId];
  const staples: string[] = [];
  for (const [tag, cmc, n] of [["ramp", 3, STARTER.ramp], ["card_draw", 4, STARTER.draw], ["spot_removal", 4, STARTER.removal]] as const) {
    const ids = await foundation(tag, cmc, mask, n, [...taken, ...staples]);
    staples.push(...ids);
  }

  // 2. cards that fit the theme (no lands: the land base is built below)
  const exclude = new Set([...taken, ...staples]);
  const ranked = rankTheme(data.index, data.entry, theme, DEFAULT_CONFIG, { exclude })
    .filter((r) => !(data.index.get(r.oracle_id)?.card.types ?? []).includes("Land"));
  const picks = sampleRecs(ranked, DEFAULT_CONFIG, { seed: `${seed}|${theme.id}|starter`, k: STARTER.themeCards });
  const themeIds = picks.map((p) => p.oracle_id);

  // 3. lands: popular on-color fixing (multicolor only), then basics by pip weight
  const spellIds = [...staples, ...themeIds];
  const spells = await db().query("SELECT mana_cost FROM cards WHERE oracle_id = ANY($1::uuid[])", [spellIds]);
  const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const row of spells.rows) for (const [k, v] of Object.entries(pipsOf(row.mana_cost ?? ""))) pips[k] += v as number;
  for (const [k, v] of Object.entries(pipsOf(data.commander.mana_cost ?? ""))) pips[k] += v as number;

  let fixers: string[] = [];
  if (identity.length >= 2) {
    const fx = await db().query(
      `SELECT c.oracle_id FROM cards c
        WHERE c.commander_legal AND 'Land' = ANY(c.types) AND NOT ('Basic' = ANY(c.supertypes))
          AND (c.ci_mask & ~$1::int) = 0
          AND (SELECT count(*) FROM unnest(c.produced_mana) p WHERE p = ANY($2::text[])) >= 2
        ORDER BY c.edhrec_rank NULLS LAST LIMIT $3`, [mask, identity, identity.length >= 3 ? 6 : 4]);
    fixers = fx.rows.map((x) => x.oracle_id);
  }
  const basicTotal = STARTER.lands - fixers.length;
  const split = identity.length ? splitBasics(basicTotal, basicWeights(identity, pips)) : { C: basicTotal };
  const names = Object.keys(split).map((k) => (k === "C" ? "Wastes" : BASIC_NAME[k]));
  const b = await db().query("SELECT oracle_id, name FROM cards WHERE name = ANY($1::text[]) AND 'Basic' = ANY(supertypes)", [names]);
  const basicId = new Map<string, string>(b.rows.map((x) => [x.name, x.oracle_id]));

  const cards: DeckCard[] = [
    ...[...staples, ...themeIds].map((oracle_id) => ({ oracle_id, qty: 1, board: "main" as const })),
    ...fixers.map((oracle_id) => ({ oracle_id, qty: 1, board: "main" as const })),
    ...Object.entries(split).flatMap(([k, qty]) => {
      const id = basicId.get(k === "C" ? "Wastes" : BASIC_NAME[k]);
      return id && qty > 0 ? [{ oracle_id: id, qty, board: "main" as const }] : [];
    }),
  ];
  return {
    name: `${data.commander.name}: ${theme.name}`,
    cards,
    counts: { theme: themeIds.length, foundation: staples.length, lands: cards.filter((c) => !spellIds.includes(c.oracle_id)).reduce((a, c) => a + c.qty, 0) },
  };
}
