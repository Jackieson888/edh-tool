import { normalizeName } from "@edh-tool/engine/decklist";
import { searchCards } from "@/lib/data";

// GET ?q=drown[&limit=12] → cards whose name starts with (then contains) the query.
// Results only change when the catalog is reloaded, so the CDN can answer repeats without waking the database.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = normalizeName(url.searchParams.get("q") ?? "");
  const limit = Math.min(30, Math.max(1, Number(url.searchParams.get("limit")) || 12));
  if (q.length < 2) return Response.json({ cards: [] });
  return Response.json({ cards: await searchCards(q, limit) },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
