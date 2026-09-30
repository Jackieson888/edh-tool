"use client";
import { ManaCost } from "@/components/Mana";
import { moveCard, setQty } from "@/lib/deckStore";
import { TYPE_ORDER, typeGroup, warningsFor } from "@/lib/deckView";
import type { Board, CardLite, Deck } from "@/lib/types";

/** One board (main or maybe) grouped by card type, with qty and move/remove controls. */
export function DeckCards({ deck, board, cards, colors, themeOf }: {
  deck: Deck;
  board: Board;
  cards: Map<string, CardLite>;
  colors: Set<string> | null;
  themeOf?: Record<string, string>;
}) {
  const rows = deck.cards.filter((c) => c.board === board);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const g = typeGroup(cards.get(r.oracle_id)?.type_line);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const other: Board = board === "main" ? "maybe" : "main";
  if (!rows.length) {
    return <p className="text-sm text-zinc-500">{board === "main" ? "No cards yet." : "Nothing in the maybeboard."}</p>;
  }
  return (
    <div className="columns-1 gap-6 md:columns-2">
      {TYPE_ORDER.filter((g) => groups.has(g)).map((g) => {
        const list = groups.get(g)!.sort((a, b) =>
          (cards.get(a.oracle_id)?.cmc ?? 0) - (cards.get(b.oracle_id)?.cmc ?? 0) ||
          (cards.get(a.oracle_id)?.name ?? "").localeCompare(cards.get(b.oracle_id)?.name ?? ""));
        return (
          <section key={g} className="mb-4 break-inside-avoid">
            <h3 className="mb-1 border-b border-white/10 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {g} <span className="text-zinc-600">({list.reduce((a, r) => a + r.qty, 0)})</span>
            </h3>
            <ul>
              {list.map((r) => {
                const card = cards.get(r.oracle_id);
                const w = warningsFor(r.qty, card, colors);
                const name = card?.name ?? "Loading…";
                return (
                  <li key={r.oracle_id} className="group flex items-center gap-2 py-0.5 text-sm">
                    <span className="flex shrink-0 items-center">
                      <button type="button" aria-label={`Remove one ${name}`} onClick={() => setQty(deck.id, r.oracle_id, board, r.qty - 1)}
                        className="h-5 w-5 rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-200">−</button>
                      <span className="w-5 text-center tabular-nums">{r.qty}</span>
                      <button type="button" aria-label={`Add one ${name}`} onClick={() => setQty(deck.id, r.oracle_id, board, r.qty + 1)}
                        className="h-5 w-5 rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-200">+</button>
                    </span>
                    <a href={`/card/${r.oracle_id}`} className={`min-w-0 flex-1 truncate hover:text-lime-300 ${w.offColor ? "text-red-300" : ""}`} title={themeOf?.[r.oracle_id]}>
                      {name}
                    </a>
                    {w.offColor && <span className="text-[10px] uppercase text-red-300" title="Outside the commander's color identity">off-color</span>}
                    {w.duplicate && <span className="text-[10px] uppercase text-amber-300" title="Commander decks are singleton">dup</span>}
                    {w.notAnalyzed && !w.offColor && <span className="text-[10px] uppercase text-zinc-600" title="Not tagged yet, so it doesn't count toward themes">untagged</span>}
                    <ManaCost cost={card?.mana_cost} />
                    <button type="button" onClick={() => moveCard(deck.id, r.oracle_id, other)}
                      className="shrink-0 rounded px-1.5 text-xs text-zinc-500 opacity-0 hover:bg-white/10 hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100">
                      {board === "main" ? "→ maybe" : "→ deck"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
