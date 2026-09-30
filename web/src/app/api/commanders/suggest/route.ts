import { bad, isId, readBody } from "@/lib/api";
import { commandersFor } from "@/lib/suggest";

// POST { ids, limit? } → commanders whose colors cover the cards and whose themes they fit.
export async function POST(req: Request) {
  const body = await readBody<{ ids?: unknown; limit?: unknown }>(req);
  if (!body || !Array.isArray(body.ids) || body.ids.length > 300 || !body.ids.every(isId)) {
    return bad("expected { ids: oracle_id[] } (max 300)");
  }
  const limit = Math.min(30, Math.max(1, Number(body.limit) || 12));
  return Response.json({ commanders: await commandersFor(body.ids, limit) });
}
