import { normalizeName, parseDecklist, resolveEntries } from "@edh-tool/engine/decklist";
import { bad, readBody } from "@/lib/api";
import { cardsByIds, nameCandidates, similarNames } from "@/lib/data";

// POST { text } → the parsed list matched to cards, plus "did you mean" for lines that didn't match.
export async function POST(req: Request) {
  const body = await readBody<{ text?: unknown }>(req);
  if (!body || typeof body.text !== "string") return bad("expected { text }");
  const { entries, name } = parseDecklist(body.text);
  if (entries.length > 400) return bad("that list has more than 400 lines");

  // Look up only the names in the list (plus the front face of "A / B" lines), not the whole catalog.
  const keys = entries.flatMap((e) => [normalizeName(e.name), ...(e.name.includes("/") ? [normalizeName(e.name.split("/")[0])] : [])]);
  const { nameIndex, cards } = await nameCandidates(keys);
  const byId = new Map(cards.map((c) => [c.oracle_id, c]));
  const r = resolveEntries(entries, nameIndex);

  const unresolved = r.unresolved.slice(0, 40);        // suggestions are a nicety; cap the extra queries
  const suggestions = await Promise.all(unresolved.map((u) => similarNames(normalizeName(u.name), 3)));
  const ids = [...new Set([...r.commanders, ...r.cards.map((c) => c.oracle_id)])];
  return Response.json({
    name: name ?? null,
    commanders: r.commanders,
    cards: r.cards,
    unresolved: r.unresolved.map((u, i) => ({ ...u, suggestions: suggestions[i] ?? [] })),
    details: ids.map((id) => byId.get(id)).filter(Boolean),
  });
}
