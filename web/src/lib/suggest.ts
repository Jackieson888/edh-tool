import "server-only";
import { suggestCommanders } from "@edh-tool/engine/deck";
import { getAllCards, getPool, getScorableCommanders } from "@/lib/data";
import type { CommanderSuggestionLite } from "@/lib/types";

/** Commanders for a card or a pile of cards (used by the card page and the builder). */
export async function commandersFor(ids: string[], limit = 12): Promise<CommanderSuggestionLite[]> {
  const [{ byId }, { index }, commanders] = await Promise.all([getAllCards(), getPool(), getScorableCommanders()]);
  const input = ids.map((id) => byId.get(id)).filter((c) => c != null)
    .map((c) => ({ oracle_id: c.oracle_id, color_identity: c.color_identity }));
  if (!input.length) return [];
  return suggestCommanders(index, commanders, input, { limit }).map((s) => {
    const card = byId.get(s.oracle_id);
    return { ...s, color_identity: card?.color_identity ?? [], image: card?.image };
  });
}
