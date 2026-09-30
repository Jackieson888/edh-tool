"use client";
// Decks live in the browser's localStorage (no accounts yet). A tiny external store:
// components read it with useDecks(), change it with the actions below, and every open
// tab stays in sync through the `storage` event. Only ids, quantities and boards are
// stored; card details are fetched from /api/cards when needed.
import { useSyncExternalStore } from "react";
import type { Board, Deck, DeckCard, ThemeState } from "@/lib/types";

const KEY = "edh-tool:decks";
const SCHEMA = 1 as const;

export interface DeckStore {
  ready: boolean;              // false during server render / hydration
  decks: Record<string, Deck>;
  lastOpenedId: string | null;
}

const SERVER: DeckStore = { ready: false, decks: {}, lastOpenedId: null };
let state: DeckStore = SERVER;
const listeners = new Set<() => void>();

/** Bring any older saved shape up to the current schema. v1 is the first, so this only
 *  cleans up; add `if (v < 2) …` steps here when the Deck shape changes. */
export function migrate(raw: unknown): DeckStore {
  const r = (raw && typeof raw === "object" ? raw : {}) as { decks?: Record<string, Partial<Deck>>; lastOpenedId?: string };
  const decks: Record<string, Deck> = {};
  for (const [id, d] of Object.entries(r.decks ?? {})) {
    if (!d || typeof d !== "object") continue;
    decks[id] = {
      schemaVersion: SCHEMA,
      id,
      name: typeof d.name === "string" ? d.name : "Untitled deck",
      createdAt: Number(d.createdAt) || Date.now(),
      updatedAt: Number(d.updatedAt) || Date.now(),
      commanders: Array.isArray(d.commanders) ? d.commanders.filter((x) => typeof x === "string") : [],
      cards: Array.isArray(d.cards)
        ? d.cards.filter((c): c is DeckCard => !!c && typeof c.oracle_id === "string")
            .map((c) => ({ oracle_id: c.oracle_id, qty: Math.max(1, Number(c.qty) || 1),
              board: c.board === "maybe" ? "maybe" : "main", ...(c.printing ? { printing: String(c.printing) } : {}) }))
        : [],
      theme: d.theme && d.theme.mode === "pinned" && Array.isArray(d.theme.pinned)
        ? { mode: "pinned", pinned: d.theme.pinned.filter((x) => typeof x === "string") }
        : { mode: "auto", pinned: [] },
    };
  }
  const last = r.lastOpenedId && decks[r.lastOpenedId] ? r.lastOpenedId : null;
  return { ready: true, decks, lastOpenedId: last };
}

function read(): DeckStore {
  try {
    const raw = window.localStorage.getItem(KEY);
    return migrate(raw ? JSON.parse(raw) : {});
  } catch {
    return { ready: true, decks: {}, lastOpenedId: null };
  }
}

function emit() {
  for (const l of listeners) l();
}

function commit(next: DeckStore) {
  state = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ schemaVersion: SCHEMA, decks: next.decks, lastOpenedId: next.lastOpenedId }));
  } catch {
    // storage full or blocked: keep working in memory for this tab
  }
  emit();
}

function subscribe(cb: () => void) {
  if (!state.ready) state = read();
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      state = read();
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = () => {
  if (!state.ready && typeof window !== "undefined") state = read();
  return state;
};

export function useDecks(): DeckStore {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER);
}

export function useDeck(id: string): { ready: boolean; deck: Deck | null } {
  const s = useDecks();
  return { ready: s.ready, deck: s.decks[id] ?? null };
}

// ---------------------------------------------------------------- actions

function update(id: string, fn: (d: Deck) => Deck) {
  const cur = getSnapshot();
  const d = cur.decks[id];
  if (!d) return;
  commit({ ...cur, decks: { ...cur.decks, [id]: { ...fn(d), updatedAt: Date.now() } } });
}

export function createDeck(init: Partial<Pick<Deck, "name" | "commanders" | "cards">> = {}): string {
  const cur = getSnapshot();
  const id = crypto.randomUUID();
  const now = Date.now();
  const deck: Deck = {
    schemaVersion: SCHEMA, id, name: init.name?.trim() || "Untitled deck", createdAt: now, updatedAt: now,
    commanders: init.commanders ?? [], cards: init.cards ?? [], theme: { mode: "auto", pinned: [] },
  };
  commit({ ...cur, decks: { ...cur.decks, [id]: deck }, lastOpenedId: id });
  return id;
}

export function deleteDeck(id: string) {
  const cur = getSnapshot();
  const decks = { ...cur.decks };
  delete decks[id];
  commit({ ...cur, decks, lastOpenedId: cur.lastOpenedId === id ? null : cur.lastOpenedId });
}

export function openedDeck(id: string) {
  const cur = getSnapshot();
  if (cur.lastOpenedId !== id && cur.decks[id]) commit({ ...cur, lastOpenedId: id });
}

export const renameDeck = (id: string, name: string) => update(id, (d) => ({ ...d, name: name.trim() || d.name }));

export const setCommanders = (id: string, commanders: string[]) =>
  update(id, (d) => ({
    ...d,
    commanders,
    // a card that becomes the commander leaves the 99; a new commander resets pinned themes
    cards: d.cards.filter((c) => !commanders.includes(c.oracle_id)),
    theme: d.commanders.join() === commanders.join() ? d.theme : { mode: "auto", pinned: [] },
  }));

export function addCard(id: string, oracleId: string, board: Board, qty = 1) {
  update(id, (d) => {
    const hit = d.cards.find((c) => c.oracle_id === oracleId && c.board === board);
    // "Add to deck" on a maybeboard card promotes it instead of duplicating it
    const other = d.cards.find((c) => c.oracle_id === oracleId && c.board !== board);
    let cards = d.cards;
    if (other && board === "main") cards = cards.filter((c) => c !== other);
    cards = hit
      ? cards.map((c) => (c === hit ? { ...c, qty: c.qty + qty } : c))
      : [...cards, { oracle_id: oracleId, qty: other && board === "main" ? other.qty : qty, board, ...(other?.printing ? { printing: other.printing } : {}) }];
    return { ...d, cards };
  });
}

export const setQty = (id: string, oracleId: string, board: Board, qty: number) =>
  update(id, (d) => ({
    ...d,
    cards: qty <= 0
      ? d.cards.filter((c) => !(c.oracle_id === oracleId && c.board === board))
      : d.cards.map((c) => (c.oracle_id === oracleId && c.board === board ? { ...c, qty } : c)),
  }));

export function moveCard(id: string, oracleId: string, to: Board) {
  update(id, (d) => {
    const from = d.cards.find((c) => c.oracle_id === oracleId && c.board !== to);
    if (!from) return d;
    const there = d.cards.find((c) => c.oracle_id === oracleId && c.board === to);
    const rest = d.cards.filter((c) => c !== from && c !== there);
    return { ...d, cards: [...rest, { ...from, board: to, qty: from.qty + (there?.qty ?? 0) }] };
  });
}

export const setTheme = (id: string, theme: ThemeState) => update(id, (d) => ({ ...d, theme }));

// ---------------------------------------------------------------- backup

export function backupJson(): string {
  const cur = getSnapshot();
  return JSON.stringify({ app: "edh-tool", schemaVersion: SCHEMA, exportedAt: new Date().toISOString(), decks: cur.decks }, null, 1);
}

/** Merge decks from a backup file; decks with the same id are replaced. Returns how many. */
export function restoreBackup(text: string): number {
  const incoming = migrate(JSON.parse(text)).decks;
  const cur = getSnapshot();
  commit({ ...cur, decks: { ...cur.decks, ...incoming } });
  return Object.keys(incoming).length;
}
