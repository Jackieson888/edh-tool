import { ROLE_TARGETS } from "@edh-tool/engine/analytics";
import { bad, isId, readBody } from "@/lib/api";
import { getAllCards } from "@/lib/data";
import { db } from "@/lib/db";

interface Req { commanders: string[]; exclude: string[]; role: string }

// POST { commanders, exclude, role } → up to 8 cards that fill a role (ramp, draw, removal, wipes)
// inside the commander's colors, best-tagged first. `exclude` is what's already in the deck.
export async function POST(req: Request) {
  const body = await readBody<Req>(req);
  const role = ROLE_TARGETS.find((r) => r.id === body?.role);
  if (!body || !role || role.id === "tutors" || !Array.isArray(body.commanders) || !body.commanders.length
    || !body.commanders.every(isId) || !Array.isArray(body.exclude) || body.exclude.length > 500 || !body.exclude.every(isId)) {
    return bad("expected { commanders: oracle_id[], exclude: oracle_id[], role: ramp | card_draw | removal | wipes }");
  }
  const r = await db().query(
    `WITH m AS (SELECT COALESCE(bit_or(ci_mask), 0) AS mask FROM cards WHERE oracle_id = ANY($1::uuid[]))
     SELECT c.oracle_id
       FROM cards c CROSS JOIN m
      WHERE c.commander_legal AND (c.ci_mask & ~m.mask) = 0
        AND c.type_line NOT LIKE '%Land%'
        AND NOT (c.oracle_id = ANY($3::uuid[]))
        AND EXISTS (SELECT 1 FROM card_tags t WHERE t.oracle_id = c.oracle_id AND t.tag = ANY($2::text[]))
      ORDER BY (SELECT max(t.strength) FROM card_tags t WHERE t.oracle_id = c.oracle_id AND t.tag = ANY($2::text[])) DESC,
               c.quality DESC NULLS LAST, c.edhrec_rank ASC NULLS LAST
      LIMIT 8`,
    [body.commanders, role.tags, [...body.exclude, ...body.commanders]]);
  const { byId } = await getAllCards();
  return Response.json({ cards: r.rows.map((x) => byId.get(x.oracle_id)).filter(Boolean) });
}
