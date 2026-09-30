import { analyzeDeck } from "@edh-tool/engine/analytics";
import type { AnalyticsCard, AnalyticsRow } from "@edh-tool/engine/analytics";
import { bad, isId, readBody } from "@/lib/api";
import { db } from "@/lib/db";

interface StatsRequest { commanders: string[]; cards: { oracle_id: string; qty: number }[] }

// POST { commanders, cards } (main board only) → deck analytics: curve, colors, types, land odds,
// role and tag shares, bracket estimate.
export async function POST(req: Request) {
  const body = await readBody<StatsRequest>(req);
  if (!body || !Array.isArray(body.commanders) || !Array.isArray(body.cards) || body.cards.length > 400
    || !body.commanders.every(isId) || !body.cards.every((c) => isId(c?.oracle_id) && Number.isInteger(c.qty) && c.qty > 0 && c.qty < 500)) {
    return bad("expected { commanders: oracle_id[], cards: { oracle_id, qty }[] }");
  }
  const ids = [...new Set([...body.commanders, ...body.cards.map((c) => c.oracle_id)])];
  if (!ids.length) return Response.json(analyzeDeck([], []));
  const r = await db().query(
    `SELECT c.oracle_id, c.name, c.mana_cost, c.cmc, c.type_line, c.oracle_text, c.produced_mana, c.game_changer, c.price_usd,
            COALESCE((SELECT array_agg(t.tag) FROM card_tags t WHERE t.oracle_id = c.oracle_id), '{}') AS tags
       FROM cards c WHERE c.oracle_id = ANY($1::uuid[])`, [ids]);
  const byId = new Map<string, AnalyticsCard>(r.rows.map((x) => [x.oracle_id, {
    ...x, cmc: Number(x.cmc ?? 0), price_usd: x.price_usd == null ? null : Number(x.price_usd), produced_mana: x.produced_mana ?? [],
  }]));
  const rows: AnalyticsRow[] = [];
  for (const c of body.cards) { const card = byId.get(c.oracle_id); if (card) rows.push({ card, qty: c.qty }); }
  const commanders = body.commanders.map((id) => byId.get(id)).filter((c): c is AnalyticsCard => !!c);
  return Response.json(analyzeDeck(rows, commanders));
}
