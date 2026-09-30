"use client";
// Card display data for a set of oracle ids, fetched once per id and shared by every component.
import { useEffect, useSyncExternalStore } from "react";
import type { CardLite } from "@/lib/types";

const cache = new Map<string, CardLite>();
const requested = new Set<string>();   // in flight or already asked for (unknown ids aren't retried)
const subs = new Set<() => void>();
let version = 0;

const notify = () => {
  version++;
  for (const s of subs) s();
};
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};

export function rememberCards(cards: CardLite[]) {
  for (const c of cards) {
    cache.set(c.oracle_id, c);
    requested.add(c.oracle_id);
  }
  notify();
}

async function fetchCards(ids: string[]) {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    try {
      const r = await fetch("/api/cards", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: chunk }),
      });
      if (r.ok) for (const c of (await r.json()).cards as CardLite[]) cache.set(c.oracle_id, c);
      else for (const id of chunk) requested.delete(id);   // server error: allow a retry later
    } catch {
      for (const id of chunk) requested.delete(id);
    }
  }
  notify();
}

export function useCards(ids: string[]): Map<string, CardLite> {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const key = [...new Set(ids)].sort().join(",");
  useEffect(() => {
    const missing = key ? key.split(",").filter((id) => !requested.has(id)) : [];
    if (!missing.length) return;
    for (const id of missing) requested.add(id);
    void fetchCards(missing);
  }, [key]);
  const out = new Map<string, CardLite>();
  for (const id of ids) {
    const c = cache.get(id);
    if (c) out.set(id, c);
  }
  return out;
}
