// Small helpers the builder shares: card grouping, warnings, counts.
import type { CardLite, Deck } from "@/lib/types";

export const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land", "Other"] as const;
export type TypeGroup = (typeof TYPE_ORDER)[number];

/** Moxfield-style grouping: the front face's most specific type ("Artifact Creature" → Creature). */
export function typeGroup(typeLine?: string): TypeGroup {
  const front = (typeLine ?? "").split(" // ")[0];
  for (const t of TYPE_ORDER) if (t !== "Other" && new RegExp(`\\b${t}\\b`).test(front)) return t;
  return "Other";
}

export const isBasic = (c?: CardLite) => !!c?.type_line && /\bBasic\b/.test(c.type_line) && /\bLand\b/.test(c.type_line);

export function commanderColors(deck: Deck, cards: Map<string, CardLite>): Set<string> | null {
  if (!deck.commanders.length) return null;
  return new Set(deck.commanders.flatMap((id) => cards.get(id)?.color_identity ?? []));
}

export interface CardWarnings {
  offColor: boolean;
  duplicate: boolean;
  notAnalyzed: boolean;
}

export function warningsFor(qty: number, card: CardLite | undefined, colors: Set<string> | null): CardWarnings {
  return {
    offColor: !!card && !!colors && !card.color_identity.every((c) => colors.has(c)),
    duplicate: qty > 1 && !!card && !isBasic(card) && !card.any_number,
    notAnalyzed: !!card && !card.tagged,
  };
}

export const mainCount = (deck: Deck) =>
  deck.commanders.length + deck.cards.filter((c) => c.board === "main").reduce((a, c) => a + c.qty, 0);
