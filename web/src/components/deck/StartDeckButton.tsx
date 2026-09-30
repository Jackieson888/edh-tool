"use client";
import { useRouter } from "next/navigation";
import { createDeck } from "@/lib/deckStore";

/** Creates a deck in localStorage seeded with a commander and/or a card, then opens it. */
export function StartDeckButton({ commander, card, name, label = "Start a deck", className = "" }: {
  commander?: string;
  card?: string;
  name?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button type="button" className={`rounded-lg bg-lime-400 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-lime-300 ${className}`}
      onClick={() => router.push(`/decks/${createDeck({
        name,
        commanders: commander ? [commander] : [],
        cards: card ? [{ oracle_id: card, qty: 1, board: "main" }] : [],
      })}`)}>
      {label}
    </button>
  );
}
