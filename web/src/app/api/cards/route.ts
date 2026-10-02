import { bad, isId, readBody } from "@/lib/api";
import { cardsByIds } from "@/lib/data";

// POST { ids } → display data for those cards (the deck builder stores ids only).
export async function POST(req: Request) {
  const body = await readBody<{ ids?: unknown }>(req);
  if (!body || !Array.isArray(body.ids) || body.ids.length > 500 || !body.ids.every(isId)) {
    return bad("expected { ids: oracle_id[] } (max 500)");
  }
  return Response.json({ cards: await cardsByIds(body.ids) });
}
