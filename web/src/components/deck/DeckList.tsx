"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ImportDeck } from "@/components/deck/ImportDeck";
import {
  backupJson,
  createDeck,
  deleteDeck,
  restoreBackup,
  useDecks,
} from "@/lib/deckStore";
import { useCards } from "@/lib/useCards";

export function DeckList() {
  const router = useRouter();
  const { ready, decks } = useDecks();
  const list = Object.values(decks).sort((a, b) => b.updatedAt - a.updatedAt);
  const names = useCards(list.flatMap((d) => d.commanders));
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const download = () => {
    const blob = new Blob([backupJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `edh-tool-decks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">My Decks</h1>
          <p className="text-sm text-zinc-500">
            Saved in this browser only. Back them up if you clear site data.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setImporting((v) => !v)}
            className="rounded-lg bg-lime-400 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-lime-300"
          >
            Import a decklist
          </button>
          <button
            type="button"
            onClick={() => router.push(`/decks/${createDeck()}`)}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:border-white/30"
          >
            New empty deck
          </button>
        </div>
      </div>

      {importing && <ImportDeck onCancel={() => setImporting(false)} />}

      {!ready ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : list.length === 0 ? (
        !importing && (
          <div className="rounded-xl border border-dashed border-white/15 p-8 text-center text-sm text-zinc-400">
            No decks yet. Paste a list you&apos;re brewing, or start from a
            commander&apos;s page.
          </div>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((d) => {
            const count =
              d.commanders.length +
              d.cards
                .filter((c) => c.board === "main")
                .reduce((a, c) => a + c.qty, 0);
            const cmd = d.commanders
              .map((id) => names.get(id)?.name)
              .filter(Boolean)
              .join(" + ");
            const hero = d.commanders
              .map((id) => names.get(id)?.art_crop)
              .find(Boolean);
            return (
              <li
                key={d.id}
                className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] transition hover:border-lime-400/50"
              >
                <Link href={`/decks/${d.id}`} className="block">
                  <div className="relative aspect-[16/7] w-full bg-gradient-to-br from-zinc-800 to-zinc-900">
                    {hero && (
                      <img
                        src={hero}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-zinc-950/20 to-transparent" />
                    <p className="absolute inset-x-3 bottom-2 truncate text-sm text-zinc-200">
                      {cmd || "No commander yet"}
                    </p>
                  </div>
                  <div className="space-y-0.5 p-3">
                    <p className="truncate font-medium group-hover:text-lime-300">
                      {d.name}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {count} / 100 cards · edited{" "}
                      {new Date(d.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                </Link>
                <button
                  type="button"
                  aria-label={`Delete ${d.name}`}
                  onClick={() => {
                    if (confirm(`Delete "${d.name}"? This can't be undone.`))
                      deleteDeck(d.id);
                  }}
                  className="absolute right-2 top-2 rounded-md bg-zinc-950/70 px-2 py-1 text-xs text-zinc-300 backdrop-blur hover:bg-red-500/30 hover:text-red-200"
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <section className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-6 text-sm">
        <span className="text-zinc-500">Backup:</span>
        <button
          type="button"
          onClick={download}
          disabled={!list.length}
          className="rounded-lg border border-white/15 px-3 py-1.5 hover:border-white/30 disabled:opacity-40"
        >
          Download all decks (.json)
        </button>
        <button
          type="button"
          onClick={() => file.current?.click()}
          className="rounded-lg border border-white/15 px-3 py-1.5 hover:border-white/30"
        >
          Restore from backup
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              setNote(`Restored ${restoreBackup(await f.text())} deck(s).`);
            } catch {
              setNote("That file isn't an edh-tool backup.");
            }
          }}
        />
        {note && <span className="text-zinc-400">{note}</span>}
      </section>
    </div>
  );
}
