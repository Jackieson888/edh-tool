"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Skeleton";
import { createDeck, setTheme } from "@/lib/deckStore";

/** Builds a starter deck for this commander + theme on the server, saves it locally and opens it. */
export function StartThemeDeckButton({ slug, themeId, className = "" }: { slug: string; themeId: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/deck/starter", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, theme: themeId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't build the deck");
      const id = createDeck({ name: j.name, commanders: [j.commander], cards: j.cards });
      setTheme(id, { mode: "pinned", pinned: [j.themeId] });
      router.push(`/decks/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      <button type="button" onClick={start} disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg bg-lime-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-lime-300 disabled:opacity-70">
        {busy && <Spinner className="h-4 w-4 !text-zinc-900" />}
        {busy ? "Building your deck…" : "Start new deck with this theme"}
      </button>
      <p className="max-w-sm text-xs text-zinc-500">
        Sets your commander and theme, then adds about 25 cards that fit plus 20 lands. You fill in the rest.
      </p>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
