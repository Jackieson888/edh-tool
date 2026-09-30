import { parseDecklist, resolveEntries, suggestNames } from "@edh-tool/engine/decklist";
import { bad, readBody } from "@/lib/api";
import { getAllCards } from "@/lib/data";

// POST { text } → the parsed list matched to cards, plus "did you mean" for lines that didn't match.
export async function POST(req: Request) {
  const body = await readBody<{ text?: unknown }>(req);
  if (!body || typeof body.text !== "string") return bad("expected { text }");
  const { cards, byId, nameIndex } = await getAllCards();
  const { entries, name } = parseDecklist(body.text);
  if (entries.length > 400) return bad("that list has more than 400 lines");
  const r = resolveEntries(entries, nameIndex);
  const ids = new Set([...r.commanders, ...r.cards.map((c) => c.oracle_id)]);
  return Response.json({
    name: name ?? null,
    commanders: r.commanders,
    cards: r.cards,
    unresolved: r.unresolved.map((u) => ({ ...u, suggestions: suggestNames(cards, u.name, 3) })),
    details: [...ids].map((id) => byId.get(id)).filter(Boolean),
  });
}
