"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { ColorIndicator } from "@/components/Mana";
import { TagChip } from "@/components/TagChip";
import type { CommanderSuggestionLite } from "@/lib/types";

/** Commanders that fit a pile of cards, with a "Choose" button on each. */
export function CommanderSuggestions({ ids, onChoose, limit = 6, exclude = [] }: {
  ids: string[];
  onChoose: (s: CommanderSuggestionLite) => void;
  limit?: number;
  exclude?: string[];
}) {
  const [state, setState] = useState<{ key: string; list: CommanderSuggestionLite[] | null; error?: boolean }>({ key: "", list: null });
  const key = [...ids].sort().join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    fetch("/api/commanders/suggest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: key.split(",").slice(0, 300), limit: limit + exclude.length }),
    })
      .then((r) => r.json())
      .then((j) => alive && setState({ key, list: j.commanders ?? [] }))
      .catch(() => alive && setState({ key, list: [], error: true }));
    return () => { alive = false; };
  }, [key, limit, exclude.length]);

  if (!key) return <p className="text-sm text-zinc-500">Add some cards and commanders that fit them show up here.</p>;
  if (state.key !== key || !state.list) return <p className="text-sm text-zinc-500">Finding commanders…</p>;
  const list = state.list.filter((s) => !exclude.includes(s.oracle_id)).slice(0, limit);
  if (!list.length) {
    return <p className="text-sm text-zinc-500">
      {state.error ? "Couldn't load suggestions." : "No commander with themes fits these cards yet (only black, green and colorless commanders have themes so far)."}
    </p>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((s) => (
        <li key={s.oracle_id} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          {s.image && <img src={s.image} alt="" loading="lazy" className="h-24 w-auto shrink-0 rounded-[5%]" />}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="flex items-center gap-2 font-medium">
              <span className="truncate">{s.name}</span>
              <ColorIndicator colors={s.color_identity} className="shrink-0 text-sm" />
            </p>
            {s.theme ? (
              <p className="text-xs text-zinc-400">
                Fits <span className="text-zinc-200">{s.theme.name}</span>
                {ids.length > 1 && ` (${s.theme.count} of your cards)`}
              </p>
            ) : s.synergyTags.length ? (
              <p className="text-xs text-zinc-400">Synergy with the commander itself</p>
            ) : null}
            <div className="flex flex-wrap gap-1">
              {(s.theme?.tags ?? s.synergyTags).slice(0, 3).map((t) => <TagChip key={t} tag={t} />)}
            </div>
            <button type="button" onClick={() => onChoose(s)}
              className="mt-auto self-start rounded-lg border border-lime-400/50 px-3 py-1 text-xs text-lime-300 hover:bg-lime-400/10">
              Choose
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
