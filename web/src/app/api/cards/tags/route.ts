import { bad, isId } from "@/lib/api";
import { getVocab } from "@/lib/data";
import { db } from "@/lib/db";

// GET ?id=<oracle_id> → the card's tags (strongest first), oracle text and P/T for the preview modal.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!isId(id)) return bad("expected ?id=<oracle_id>");
  const [c, t, vocab] = await Promise.all([
    db().query("SELECT oracle_text, power, toughness FROM cards WHERE oracle_id = $1", [id]),
    db().query("SELECT tag, role, strength FROM card_tags WHERE oracle_id = $1 ORDER BY strength DESC, tag", [id]),
    getVocab(),
  ]);
  if (!c.rowCount) return bad("unknown card", 404);
  return Response.json(
    {
      oracle_text: c.rows[0].oracle_text ?? "",
      power: c.rows[0].power, toughness: c.rows[0].toughness,
      tags: t.rows.map((x) => ({ tag: x.tag, role: x.role, strength: Number(x.strength), definition: vocab.tags[x.tag]?.definition })),
    },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
