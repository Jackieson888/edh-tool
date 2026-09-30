"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CardPreview } from "@/components/CardPreview";
import { ManaCost } from "@/components/Mana";
import { moveCard, setQty } from "@/lib/deckStore";
import { TYPE_ORDER, typeGroup, warningsFor } from "@/lib/deckView";
import type { Board, CardLite, Deck } from "@/lib/types";

/** Per-row "…" menu: move between boards, or open the card's page. */
function RowMenu({
  name,
  oracleId,
  moveLabel,
  onMove,
}: {
  name: string;
  oracleId: string;
  moveLabel: string;
  onMove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const item =
    "block w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-white/10 hover:text-zinc-100";
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-6 items-center justify-center rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-100"
      >
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="3" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="13" cy="8" r="1.4" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded border border-white/10 bg-zinc-900 py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              onMove();
            }}
          >
            {moveLabel}
          </button>
          <Link
            role="menuitem"
            href={`/card/${oracleId}`}
            className={item}
            onClick={() => setOpen(false)}
          >
            Open card page
          </Link>
        </div>
      )}
    </div>
  );
}

/** One board (main or maybe) grouped by card type, with qty and move/remove controls. */
export function DeckCards({
  deck,
  board,
  cards,
  colors,
  themeOf,
}: {
  deck: Deck;
  board: Board;
  cards: Map<string, CardLite>;
  colors: Set<string> | null;
  themeOf?: Record<string, string>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const rows = deck.cards.filter((c) => c.board === board);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const g = typeGroup(cards.get(r.oracle_id)?.type_line);
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }
  const other: Board = board === "main" ? "maybe" : "main";
  if (!rows.length) {
    return (
      <p className="text-sm text-zinc-500">
        {board === "main" ? "No cards yet." : "Nothing in the maybeboard."}
      </p>
    );
  }
  const pc = preview ? cards.get(preview) : undefined;
  return (
    <>
      {pc && (
        <CardPreview
          card={pc}
          theme={themeOf?.[pc.oracle_id]}
          onClose={() => setPreview(null)}
          moveLabel={board === "main" ? "Move to maybeboard" : "Move to deck"}
          onMove={() => moveCard(deck.id, pc.oracle_id, other)}
        />
      )}
      <div className="columns-1 gap-6 md:columns-2">
        {TYPE_ORDER.filter((g) => groups.has(g)).map((g) => {
          const list = groups
            .get(g)!
            .sort(
              (a, b) =>
                (cards.get(a.oracle_id)?.cmc ?? 0) -
                  (cards.get(b.oracle_id)?.cmc ?? 0) ||
                (cards.get(a.oracle_id)?.name ?? "").localeCompare(
                  cards.get(b.oracle_id)?.name ?? "",
                ),
            );
          return (
            <section key={g} className="mb-4 break-inside-avoid">
              <h3 className="mb-1 border-b border-white/10 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {g}{" "}
                <span className="text-zinc-600">
                  ({list.reduce((a, r) => a + r.qty, 0)})
                </span>
              </h3>
              <ul>
                {list.map((r) => {
                  const card = cards.get(r.oracle_id);
                  const w = warningsFor(r.qty, card, colors);
                  const name = card?.name ?? "Loading…";
                  return (
                    <li
                      key={r.oracle_id}
                      className="group flex items-center gap-2 py-0.5 text-sm"
                    >
                      <span className="flex shrink-0 items-center">
                        <button
                          type="button"
                          aria-label={`Remove one ${name}`}
                          onClick={() =>
                            setQty(deck.id, r.oracle_id, board, r.qty - 1)
                          }
                          className="h-5 w-5 rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                        >
                          −
                        </button>
                        <span className="w-5 mx-[-.3em] text-center tabular-nums">
                          {r.qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`Add one ${name}`}
                          onClick={() =>
                            setQty(deck.id, r.oracle_id, board, r.qty + 1)
                          }
                          className="h-5 w-5 rounded text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                        >
                          +
                        </button>
                      </span>
                      <button
                        type="button"
                        onClick={() => card && setPreview(r.oracle_id)}
                        disabled={!card}
                        aria-haspopup="dialog"
                        title={
                          themeOf?.[r.oracle_id]
                            ? `${name} · ${themeOf[r.oracle_id]}`
                            : name
                        }
                        className={`min-w-0 flex-1 truncate text-left hover:text-lime-300 ${w.offColor ? "text-red-300" : ""}`}
                      >
                        {name}
                      </button>
                      {w.offColor && (
                        <span
                          className="text-[10px] uppercase text-red-300"
                          title="Outside the commander's color identity"
                        >
                          off-color
                        </span>
                      )}
                      {w.duplicate && (
                        <span
                          className="text-[10px] uppercase text-amber-300"
                          title="Commander decks are singleton"
                        >
                          dup
                        </span>
                      )}
                      {w.notAnalyzed && !w.offColor && (
                        <span
                          className="text-[10px] uppercase text-zinc-600"
                          title="Not tagged yet, so it doesn't count toward themes"
                        >
                          untagged
                        </span>
                      )}
                      <ManaCost cost={card?.mana_cost} />
                      <RowMenu
                        name={name}
                        oracleId={r.oracle_id}
                        moveLabel={
                          board === "main"
                            ? "Move to maybeboard"
                            : "Move to deck"
                        }
                        onMove={() => moveCard(deck.id, r.oracle_id, other)}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
