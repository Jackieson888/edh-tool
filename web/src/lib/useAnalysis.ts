"use client";
import { useEffect, useState } from "react";
import type { AnalyzeResponse, Deck } from "@/lib/types";

/** Theme profile + recommendations for a deck from /api/deck/analyze, refetched (debounced)
 *  whenever the commander, the cards, the theme choice or the reroll changes. */
export function useAnalysis(deck: Deck | null, reroll: number) {
  const commander = deck?.commanders[0] ?? null;
  const key = deck && commander
    ? JSON.stringify({
        commander,
        cards: deck.cards.map((c) => [c.oracle_id, c.board]).sort(),
        theme: deck.theme,
        seed: deck.id,
        reroll,
      })
    : null;
  const [state, setState] = useState<{ key: string | null; data: AnalyzeResponse | null; error: string | null }>(
    { key: null, data: null, error: null });

  useEffect(() => {
    if (!key) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      const k = JSON.parse(key);
      try {
        const r = await fetch("/api/deck/analyze", {
          method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
          body: JSON.stringify({ ...k, cards: k.cards.map(([oracle_id, board]: [string, string]) => ({ oracle_id, board, qty: 1 })) }),
        });
        const j = await r.json();
        setState(r.ok ? { key, data: j, error: null } : { key, data: null, error: j.error ?? "Couldn't analyze the deck" });
      } catch (e) {
        if (!ctl.signal.aborted) setState({ key, data: null, error: String(e) });
      }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [key]);

  return {
    // keep showing the last result while a new one loads, so the page doesn't flicker
    data: key ? state.data : null,
    error: key && state.key === key ? state.error : null,
    loading: !!key && state.key !== key,
  };
}
