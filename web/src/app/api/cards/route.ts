import { bad, isId, readBody } from "@/lib/api";
import { getAllCards } from "@/lib/data";

// POST { ids } → display data for those cards (the deck builder stores ids only).
export async function POST(req: Request) {
  const body = await readBody<{ ids?: unknown }>(req);
  if (!body || !Array.isArray(body.ids) || body.ids.length > 500 || !body.ids.every(isId)) {
    return bad("expected { ids: oracle_id[] } (max 500)");
  }
  const { byId } = await getAllCards();
  return Response.json({ cards: body.ids.map((id) => byId.get(id)).filter(Boolean) });
}
