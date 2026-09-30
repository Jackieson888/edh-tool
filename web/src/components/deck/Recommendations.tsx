"use client";
import { CardImage } from "@/components/CardImage";
import { TagChip } from "@/components/TagChip";
import { tagLabel } from "@/lib/labels";
import type { AnalyzeResponse, Board } from "@/lib/types";

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function Recommendations({ data, loading, onAdd, onReroll }: {
  data: AnalyzeResponse;
  loading: boolean;
  onAdd: (oracleId: string, board: Board) => void;
  onReroll: () => void;
}) {
  return (
    <section className="space-y-6">
      {data.recs.map((r) => {
        const theme = data.themes.find((t) => t.id === r.themeId);
        return (
          <div key={r.themeId} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Cards for {theme?.name}</h2>
                <p className="text-xs text-zinc-500">{r.picks.length} picks from {r.eligible} cards that fit and aren&apos;t in your deck</p>
              </div>
              <button type="button" onClick={onReroll} disabled={loading}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:border-white/30 disabled:opacity-50">
                {loading ? "Loading…" : "Reroll"}
              </button>
            </div>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
              {r.picks.map((p) => {
                const top = [...p.shared].sort((a, b) => b.deckCards - a.deckCards);
                return (
                  <li key={p.oracle_id} className="flex flex-col gap-2">
                    <a href={`/card/${p.oracle_id}`}><CardImage src={p.image} alt={p.name} /></a>
                    <div className="flex flex-wrap gap-1">
                      {p.gem && <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs text-amber-300 ring-1 ring-amber-400/40">Hidden gem</span>}
                      {p.inMaybe && <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-xs text-sky-300 ring-1 ring-sky-400/40">In maybeboard</span>}
                    </div>
                    {top.length ? (
                      <p className="text-xs text-zinc-400">
                        Shares {list(top.map((s) => tagLabel(s.tag)))} with {top[0].deckCards} card{top[0].deckCards === 1 ? "" : "s"} in your deck
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {p.matched.map((m) => <TagChip key={m.tag} tag={m.tag} strong={m.anchor} />)}
                      </div>
                    )}
                    <div className="mt-auto flex gap-1.5">
                      <button type="button" onClick={() => onAdd(p.oracle_id, "main")}
                        className="flex-1 rounded-lg bg-lime-400 px-2 py-1.5 text-xs font-medium text-zinc-950 hover:bg-lime-300">
                        {p.inMaybe ? "Move to deck" : "Add to deck"}
                      </button>
                      {!p.inMaybe && (
                        <button type="button" onClick={() => onAdd(p.oracle_id, "maybe")}
                          className="flex-1 rounded-lg border border-white/15 px-2 py-1.5 text-xs hover:border-white/30">
                          Maybeboard
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
