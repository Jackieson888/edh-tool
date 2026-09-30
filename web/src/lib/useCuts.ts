"use client";
import { useEffect, useState } from "react";
import type { CutsResponse, Deck } from "@/lib/types";

/** Cut suggestions from /api/deck/cuts, refetched (debounced) when the main board, commander or
 *  theme choice changes. The last result stays visible while a new one loads. */
export function useCuts(deck: Deck | null) {
  const commander = deck?.commanders[0] ?? null;
  const key = deck && commander
    ? JSON.stringify({
        commander,
        cards: deck.cards.filter((c) => c.board === "main").map((c) => [c.oracle_id, c.qty]).sort(),
        theme: deck.theme,
      })
    : null;
  const [state, setState] = useState<{ key: string | null; data: CutsResponse | null; error: string | null }>(
    { key: null, data: null, error: null });

  useEffect(() => {
    if (!key) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      const k = JSON.parse(key);
      try {
        const r = await fetch("/api/deck/cuts", {
          method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
          body: JSON.stringify({
            commander: k.commander, theme: k.theme,
            cards: k.cards.map(([oracle_id, qty]: [string, number]) => ({ oracle_id, qty, board: "main" })),
          }),
        });
        const j = await r.json();
        setState(r.ok ? { key, data: j, error: null } : { key, data: null, error: j.error ?? "Couldn't find cuts" });
      } catch (e) {
        if (!ctl.signal.aborted) setState({ key, data: null, error: String(e) });
      }
    }, 400);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [key]);

  return { data: key ? state.data : null, error: key && state.key === key ? state.error : null, loading: !!key && state.key !== key };
}
