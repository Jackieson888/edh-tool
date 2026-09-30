"use client";
import { TagChip } from "@/components/TagChip";
import type { AnalyzeResponse, ThemeState } from "@/lib/types";

/** What the deck is already about, and which theme(s) drive the recommendations.
 *  Auto follows the deck; pinning a theme holds it even as cards change. */
export function ThemePanel({
  data,
  state,
  onChange,
}: {
  data: AnalyzeResponse;
  state: ThemeState;
  onChange: (s: ThemeState) => void;
}) {
  const max = Math.max(1, ...data.themes.map((t) => t.count));
  const pinned = state.mode === "pinned" ? state.pinned : [];
  const toggle = (id: string) => {
    if (state.mode === "auto")
      return onChange({ mode: "pinned", pinned: [id] });
    const next = pinned.includes(id)
      ? pinned.filter((x) => x !== id)
      : [...pinned, id];
    onChange(
      next.length
        ? { mode: "pinned", pinned: next }
        : { mode: "auto", pinned: [] },
    );
  };
  const inferredName = data.themes.find((t) => t.id === data.inferred)?.name;
  const drift =
    state.mode === "pinned" &&
    data.inferred &&
    !pinned.includes(data.inferred) &&
    (data.themes.find((t) => t.id === data.inferred)?.count ?? 0) > 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Deck Themes</h2>
        {state.mode === "auto" ? (
          <span className="text-xs text-zinc-500">
            Auto: recommendations follow your deck. Pin a theme to steer.
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onChange({ mode: "auto", pinned: [] })}
            className="text-xs text-lime-300 hover:text-lime-200"
          >
            Back to auto
          </button>
        )}
      </div>
      {drift && inferredName && (
        <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-400/30">
          You pinned a different direction, but your deck reads mostly as{" "}
          <b>{inferredName}</b>.
        </p>
      )}
      <ul className="space-y-2">
        {data.themes.map((t) => {
          const active = data.active.includes(t.id);
          const isPinned = pinned.includes(t.id);
          return (
            <li
              key={t.id}
              className={`rounded-lg border p-3 ${active ? "border-lime-400/50 bg-lime-400/[0.06]" : "border-white/10"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                      {t.kind}
                    </span>
                    {active && (
                      <span className="text-[10px] uppercase tracking-wide text-lime-300">
                        {isPinned ? "pinned" : "following"}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-400">{t.pitch}</p>
                </div>
                <button
                  type="button"
                  aria-pressed={isPinned}
                  onClick={() => toggle(t.id)}
                  className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs ${isPinned ? "border-lime-400/60 text-lime-300" : "border-white/15 text-zinc-400 hover:border-white/30"}`}
                >
                  {isPinned ? "Unpin" : "Pin"}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full bg-lime-400/70"
                    style={{ width: `${(t.count / max) * 100}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-xs text-zinc-400">
                  {t.count} card{t.count === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {t.tags.map((tag, i) => (
                  <TagChip key={tag} tag={tag} strong={i === 0} />
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {(data.notAnalyzed.length > 0 || data.offColor.length > 0) && (
        <p className="text-xs text-zinc-500">
          {data.analyzed} card{data.analyzed === 1 ? "" : "s"} analyzed
          {data.notAnalyzed.length > 0 &&
            `; ${data.notAnalyzed.length} not analyzed yet (only black, green and colorless cards are tagged so far)`}
          {data.offColor.length > 0 &&
            `; ${data.offColor.length} outside the commander's colors`}
          .
        </p>
      )}
    </section>
  );
}
