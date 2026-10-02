import "server-only";
import { suggestCommanders } from "@edh-tool/engine/deck";
import { cardsByIds, getSuggestionInputs } from "@/lib/data";
import type { CommanderSuggestionLite } from "@/lib/types";

/** Commanders for a card or a pile of cards (used by the card page and the builder). */
export async function commandersFor(ids: string[], limit = 12): Promise<CommanderSuggestionLite[]> {
  const [cards, { index, commanders }] = await Promise.all([cardsByIds(ids), getSuggestionInputs(ids)]);
  const input = cards.map((c) => ({ oracle_id: c.oracle_id, color_identity: c.color_identity }));
  if (!input.length) return [];
  const found = suggestCommanders(index, commanders, input, { limit });
  const shown = new Map((await cardsByIds(found.map((s) => s.oracle_id))).map((c) => [c.oracle_id, c]));
  return found.map((s) => {
    const card = shown.get(s.oracle_id);
    return { ...s, color_identity: card?.color_identity ?? [], image: card?.image };
  });
}
