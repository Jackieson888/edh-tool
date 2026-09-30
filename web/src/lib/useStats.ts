"use client";
import { useEffect, useState } from "react";
import type { DeckAnalytics } from "@edh-tool/engine/analytics";
import type { Deck } from "@/lib/types";

/** Analytics for the main board from /api/deck/stats, refetched (debounced) when the cards change.
 *  Works without a commander too, so an imported list shows numbers before one is chosen. */
export function useStats(deck: Deck | null) {
  const key = deck
    ? JSON.stringify({
        commanders: deck.commanders,
        cards: deck.cards.filter((c) => c.board === "main").map((c) => [c.oracle_id, c.qty]).sort(),
      })
    : null;
  const [state, setState] = useState<{ key: string | null; data: DeckAnalytics | null; error: string | null }>(
    { key: null, data: null, error: null });

  useEffect(() => {
    if (!key) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      const k = JSON.parse(key);
      try {
        const r = await fetch("/api/deck/stats", {
          method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
          body: JSON.stringify({ commanders: k.commanders, cards: k.cards.map(([oracle_id, qty]: [string, number]) => ({ oracle_id, qty })) }),
        });
        const j = await r.json();
        setState(r.ok ? { key, data: j, error: null } : { key, data: null, error: j.error ?? "Couldn't compute stats" });
      } catch (e) {
        if (!ctl.signal.aborted) setState({ key, data: null, error: String(e) });
      }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [key]);

  return { data: key ? state.data : null, error: key && state.key === key ? state.error : null };
}
