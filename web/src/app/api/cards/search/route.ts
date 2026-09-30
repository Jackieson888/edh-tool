import { normalizeName } from "@edh-tool/engine/decklist";
import { getAllCards } from "@/lib/data";

// GET ?q=drown[&limit=12] → cards whose name starts with (then contains) the query.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = normalizeName(url.searchParams.get("q") ?? "");
  const limit = Math.min(30, Math.max(1, Number(url.searchParams.get("limit")) || 12));
  if (q.length < 2) return Response.json({ cards: [] });
  const { cards } = await getAllCards();
  const starts = [], contains = [];
  for (const c of cards) {
    const n = normalizeName(c.name);
    if (n.startsWith(q)) starts.push(c);
    else if (contains.length < limit && n.includes(q)) contains.push(c);
  }
  starts.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
  return Response.json({ cards: [...starts, ...contains].slice(0, limit) });
}
