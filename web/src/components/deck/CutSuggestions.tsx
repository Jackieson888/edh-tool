/* eslint-disable @next/next/no-img-element */
"use client";
import { useState } from "react";
import { CardPreview } from "@/components/CardPreview";
import { tagLabel } from "@/lib/labels";
import type { CutsResponse, CardLite } from "@/lib/types";

type Reason = CutsResponse["cuts"][number]["reasons"][number];

const IMPACT = {
  none: { text: "No Impact", cls: "text-lime-300" },
  low: { text: "Low Impact", cls: "text-lime-200/80" },
  neutral: { text: "Neutral", cls: "text-zinc-400" },
} as const;

function sentence(r: Reason, commander: string): string {
  switch (r.kind) {
    case "illegal":
      return `Outside ${commander}'s color identity, so it can't be played in this deck.`;
    case "off_theme":
      return (r.fit ?? 0) === 0
        ? `No tags related with ${r.theme}.`
        : `Weak support for ${r.theme} (fit ${(r.fit ?? 0).toFixed(2)}).`;
    case "redundant_role":
      return `${r.label} is already at ${r.count} (usually ${r.min}–${r.max}), and this is one of the weakest of them.`;
    case "redundant_tag":
      return `You already have ${r.count} cards with ${tagLabel(r.tag ?? "")}; this is one of the weakest of them.`;
    case "expensive":
      return `Costs ${r.cmc} mana without moving your theme forward.`;
    case "weak":
      return "Rated low on overall power compared with similar cards.";
  }
}

export function CutSuggestions({
  data,
  loading,
  commanderName,
  cards,
  onMaybe,
  onRemove,
}: {
  data: CutsResponse;
  loading: boolean;
  commanderName: string;
  cards: Map<string, CardLite>;
  onMaybe: (oracleId: string) => void;
  onRemove: (oracleId: string) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const pc = preview ? cards.get(preview) : undefined;
  const themes = data.themes.join(" + ");
  return (
    <section className="space-y-4" aria-busy={loading}>
      {pc && (
        <CardPreview
          card={pc}
          theme={themes || undefined}
          moveLabel="Move to maybeboard"
          onMove={() => {
            onMaybe(pc.oracle_id);
            setPreview(null);
          }}
          onClose={() => setPreview(null)}
        />
      )}
      <div>
        <h2 className="text-lg font-semibold">Recommended Cards to Cut</h2>
        <p className="text-sm text-zinc-500">
          {data.over > 0
            ? `You're ${data.over} over ${data.limit}. These are the weakest fits${themes ? ` for ${themes}` : ""}, most cuttable first.`
            : `${data.total} / ${data.limit} cards. The weakest links${themes ? ` for ${themes}` : ""}, if you want to tighten up.`}
          {loading && " Updating…"}
        </p>
      </div>
      {data.cuts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 p-5 text-sm text-zinc-400">
          Nothing stands out as a clear cut. Every card is either on theme or
          filling a role you need.
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.cuts.map((c) => (
            <li
              key={c.oracle_id}
              className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
            >
              <button
                type="button"
                onClick={() => setPreview(c.oracle_id)}
                aria-label={`Preview ${c.name}`}
                className="w-20 shrink-0 self-start"
              >
                {c.image ? (
                  <img
                    src={c.image}
                    alt=""
                    loading="lazy"
                    className="w-full rounded-[4.75%]"
                  />
                ) : (
                  <div className="grid aspect-[488/680] place-items-center rounded bg-zinc-800 p-1 text-center text-[10px]">
                    {c.name}
                  </div>
                )}
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setPreview(c.oracle_id)}
                    className="truncate text-left font-medium hover:text-lime-300"
                  >
                    {c.name}
                  </button>
                  <span
                    className={`shrink-0 text-xs ${IMPACT[c.impact].cls}`}
                    title="How much the deck would miss this card if you cut it"
                  >
                    {IMPACT[c.impact].text}
                  </span>
                </div>
                <ul className="flex-1 space-y-1 text-xs text-zinc-400">
                  {c.reasons.map((r, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span aria-hidden="true" className="text-zinc-600">
                        •
                      </span>
                      {sentence(r, commanderName)}
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onMaybe(c.oracle_id)}
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-xs hover:border-white/30"
                  >
                    Move to maybeboard
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(c.oracle_id)}
                    className="rounded-lg px-2.5 py-1 text-xs text-zinc-400 hover:bg-red-500/15 hover:text-red-200"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {(data.overfullRoles.length > 0 || data.shortRoles.length > 0) && (
        <p className="text-xs text-zinc-500">
          {data.overfullRoles.length > 0 && (
            <>
              Heavy on{" "}
              {data.overfullRoles
                .map((r) => `${r.label.toLowerCase()} (${r.count})`)
                .join(", ")}
              .{" "}
            </>
          )}
          {data.shortRoles.length > 0 && (
            <>
              Light on{" "}
              {data.shortRoles
                .map((r) => `${r.label.toLowerCase()} (${r.count})`)
                .join(", ")}
              , so cards filling those roles are kept out of the cut list.
            </>
          )}
        </p>
      )}
    </section>
  );
}
