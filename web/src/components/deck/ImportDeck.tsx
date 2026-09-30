"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CardSearch } from "@/components/CardSearch";
import { CommanderSuggestions } from "@/components/deck/CommanderSuggestions";
import { createDeck } from "@/lib/deckStore";
import { rememberCards, useCards } from "@/lib/useCards";
import type { CardLite, DeckCard } from "@/lib/types";

interface Unresolved {
  line: string;
  name: string;
  qty: number;
  section: "commander" | "main" | "side" | "maybe";
  suggestions: { oracle_id: string; name: string; score: number }[];
}
interface Resolved {
  name: string | null;
  commanders: string[];
  cards: DeckCard[];
  unresolved: Unresolved[];
  details: CardLite[];
}

const isCommander = (c: CardLite) => !!c.commander_eligible;

/** Paste or upload a list → fix unmatched lines → pick a commander (or later) → new deck. */
export function ImportDeck({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [deckName, setDeckName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Resolved | null>(null);
  const [commanders, setCommanders] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const names = useCards(commanders);

  const read = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/decklist/resolve", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't read that list");
      rememberCards(j.details);
      setRes(j);
      setCommanders(j.commanders);
      if (j.name && !deckName) setDeckName(j.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const accept = (u: Unresolved, id: string) => {
    if (!res) return;
    if (u.section === "commander") setCommanders((c) => (c.includes(id) ? c : [...c, id]));
    const board = u.section === "main" ? "main" : "maybe";
    const cards = u.section === "commander" ? res.cards
      : res.cards.some((c) => c.oracle_id === id && c.board === board)
        ? res.cards.map((c) => (c.oracle_id === id && c.board === board ? { ...c, qty: c.qty + u.qty } : c))
        : [...res.cards, { oracle_id: id, qty: u.qty, board: board as DeckCard["board"] }];
    setRes({ ...res, cards, unresolved: res.unresolved.filter((x) => x !== u) });
  };
  const skip = (u: Unresolved) => res && setRes({ ...res, unresolved: res.unresolved.filter((x) => x !== u) });

  const create = () => {
    if (!res) return;
    const id = createDeck({
      name: deckName || (commanders.length ? names.get(commanders[0])?.name : undefined) || "Imported deck",
      commanders,
      cards: res.cards.filter((c) => !commanders.includes(c.oracle_id)),
    });
    router.push(`/decks/${id}`);
  };

  const mainIds = res ? res.cards.filter((c) => c.board === "main").map((c) => c.oracle_id) : [];
  const mainCount = res ? res.cards.filter((c) => c.board === "main").reduce((a, c) => a + c.qty, 0) : 0;
  const maybeCount = res ? res.cards.filter((c) => c.board === "maybe").reduce((a, c) => a + c.qty, 0) : 0;

  return (
    <section className="space-y-5 rounded-xl border border-white/10 bg-white/[0.03] p-5">
      {!res ? (
        <>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Import a decklist</h2>
            <p className="text-sm text-zinc-400">
              Paste an export from Moxfield, Archidekt, MTGO or Arena, or upload a .txt. A partial pile is fine:
              you can pick the commander after.
            </p>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} spellCheck={false}
            placeholder={"1 Agent Frank Horrigan\n1 Drown in Ichor\n1x Tekuthal, Inquiry Dominus (MOM) 115\n…"}
            className="w-full rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-sm placeholder:text-zinc-600 focus:border-lime-400/60 focus:outline-none" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={read} disabled={busy || !text.trim()}
              className="rounded-lg bg-lime-400 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-lime-300 disabled:opacity-40">
              {busy ? "Reading…" : "Read list"}
            </button>
            <button type="button" onClick={() => file.current?.click()}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:border-white/30">
              Upload .txt
            </button>
            <input ref={file} type="file" accept=".txt,.dec,.dek,.csv,text/plain" className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) setText(await f.text());
              }} />
            <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
            {error && <span className="text-sm text-red-300">{error}</span>}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Review import</h2>
              <p className="text-sm text-zinc-400">
                {mainCount} cards in the deck{maybeCount ? `, ${maybeCount} in the maybeboard` : ""}
                {res.unresolved.length ? `, ${res.unresolved.length} line(s) to check` : ""}.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-zinc-400">Deck name</span>
              <input value={deckName} onChange={(e) => setDeckName(e.target.value)} placeholder="Untitled deck"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm focus:border-lime-400/60 focus:outline-none" />
            </label>
          </div>

          {res.unresolved.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-zinc-300">Didn&apos;t recognize these</h3>
              <p className="text-xs text-zinc-500">Typos, or cards that aren&apos;t legal in Commander.</p>
              <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
                {res.unresolved.map((u) => (
                  <li key={u.line} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <code className="mr-2 text-zinc-300">{u.line}</code>
                    {u.suggestions.map((s) => (
                      <button key={s.oracle_id} type="button"
                        onClick={() => accept(u, s.oracle_id)}
                        className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs hover:border-lime-400/60">
                        {s.name}?
                      </button>
                    ))}
                    <button type="button" onClick={() => skip(u)} className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">Skip</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-zinc-300">Commander</h3>
            {commanders.length ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {commanders.map((id) => (
                  <span key={id} className="rounded-full bg-lime-400/15 px-3 py-1 text-lime-200 ring-1 ring-lime-400/40">
                    {names.get(id)?.name ?? "…"}
                  </span>
                ))}
                <button type="button" onClick={() => setCommanders([])} className="text-xs text-zinc-500 hover:text-zinc-300">Change</button>
              </div>
            ) : (
              <>
                <p className="text-sm text-zinc-400">No commander in the list. These fit the cards you have:</p>
                <CommanderSuggestions ids={mainIds} onChoose={(s) => setCommanders([s.oracle_id])} />
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-zinc-500">Or pick any commander:</span>
                  <CardSearch placeholder="Search commanders…" filter={isCommander} className="w-72"
                    onPick={(c) => { rememberCards([c]); setCommanders([c.oracle_id]); }} />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
            <button type="button" onClick={create}
              className="rounded-lg bg-lime-400 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-lime-300">
              {commanders.length ? "Create deck" : "Create deck, pick commander later"}
            </button>
            <button type="button" onClick={() => setRes(null)} className="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Back</button>
          </div>
        </>
      )}
    </section>
  );
}
