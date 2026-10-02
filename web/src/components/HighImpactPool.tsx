"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CardImage, type CardHighlight } from "@/components/CardImage";
import { ManaSymbol } from "@/components/Mana";
import { TagChip } from "@/components/TagChip";

export type PoolRow = {
  id: string;
  name: string;
  image?: string;
  href?: string;
  types: string[];
  colors: string[]; // color identity, empty = colorless
  price: number | null;
  rank: number | null;
  artist?: string;
  gem: boolean;
  picked: boolean;
  score: number;
  fit: number;
  commander: number;
  quality: number;
  popularity: number;
  art: number;
  tags: { tag: string; anchor: boolean; detail?: string }[];
};

type SortKey =
  | "score"
  | "fit"
  | "commander"
  | "quality"
  | "popularity"
  | "art"
  | "price"
  | "name";

const SORTS: { key: SortKey; label: string; hint: string }[] = [
  { key: "score", label: "Score", hint: "Overall recommendation strength" },
  { key: "fit", label: "Fit", hint: "How well it matches the theme's tags" },
  { key: "commander", label: "Commander", hint: "Synergy with this commander" },
  { key: "quality", label: "Quality", hint: "Raw card power, theme aside" },
  {
    key: "popularity",
    label: "Popularity",
    hint: "Boost for lesser-played cards",
  },
  { key: "art", label: "Art", hint: "Match to the theme's art direction" },
  { key: "price", label: "Price", hint: "Current USD price" },
  { key: "name", label: "Name", hint: "Alphabetical" },
];
const sortDefaultDir = (k: SortKey): 1 | -1 =>
  k === "name" || k === "price" ? 1 : -1;

const COLOR_ORDER = ["W", "U", "B", "R", "G", "C"];
const COLOR_NAMES: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

const chip = (on: boolean) =>
  `rounded-full px-2.5 py-1 text-xs ring-1 transition ${
    on
      ? "bg-lime-400 text-zinc-950 ring-lime-400"
      : "bg-white/5 text-zinc-300 ring-white/10 hover:bg-white/10"
  }`;

const highlightOf = (r: PoolRow): CardHighlight | undefined =>
  r.picked && r.gem ? "both" : r.picked ? "pick" : r.gem ? "gem" : undefined;

function Stat({
  label,
  value,
  big,
}: {
  label: string;
  value: number;
  big?: boolean;
}) {
  return (
    <div className="leading-tight">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div
        className={`font-mono ${big ? "text-xs text-lime-400" : "text-[10px] text-zinc-200"}`}
      >
        {value.toFixed(2)}
      </div>
    </div>
  );
}

function Meta({
  icon,
  children,
}: {
  icon?: "edhrec-logo" | "brush";
  children: React.ReactNode;
}) {
  const url = icon && `url(/imgs/${icon}.svg)`;
  // the icons are plain shapes, so mask them to take the text color
  return (
    <span className="inline-flex items-center gap-1.5">
      {url && (
        <span
          aria-hidden
          className="inline-block size-3.5 shrink-0 bg-current"
          style={{
            maskImage: url,
            WebkitMaskImage: url,
            maskSize: "contain",
            WebkitMaskSize: "contain",
            maskRepeat: "no-repeat",
            WebkitMaskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskPosition: "center",
          }}
        />
      )}
      {children}
    </span>
  );
}

function toggle<T>(set: Set<T>, v: T) {
  const next = new Set(set);
  if (!next.delete(v)) next.add(v);
  return next;
}

/** A listbox instead of a native <select>, since native options can't carry a caption. */
function SortMenu({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (k: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = SORTS.find((s) => s.key === value)!;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Sort by"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-36 items-center justify-between gap-3 rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-sm hover:bg-white/10"
      >
        {current.label}
        <span aria-hidden className="text-xs text-zinc-500">
          ▾
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 z-20 mt-1 w-72 overflow-hidden rounded-lg border border-white/10 bg-zinc-900 py-1 shadow-xl"
        >
          {SORTS.map((o) => (
            <li
              key={o.key}
              role="option"
              aria-selected={o.key === value}
              tabIndex={0}
              onClick={() => {
                onChange(o.key);
                setOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange(o.key);
                  setOpen(false);
                }
              }}
              className={`cursor-pointer px-4 py-2.5 hover:bg-white/10 focus:bg-white/10 focus:outline-none ${o.key === value ? "bg-white/5" : ""}`}
            >
              <div
                className={`text-sm ${o.key === value ? "text-lime-300" : "text-zinc-100"}`}
              >
                {o.label}
              </div>
              <div className="text-xs text-zinc-500">{o.hint}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HighImpactPool({
  rows,
  header,
}: {
  rows: PoolRow[];
  header?: React.ReactNode; // shown at the top of the filter panel
}) {
  const [sort, setSort] = useState<SortKey>("score");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [colors, setColors] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"within" | "exact">("exact");

  const typeOptions = useMemo(
    () => [...new Set(rows.flatMap((r) => r.types))].sort(),
    [rows],
  );

  // only the colors that actually appear in the pool (colorless cards count as "C")
  const colorOptions = useMemo(() => {
    const have = new Set(
      rows.flatMap((r) => (r.colors.length ? r.colors : ["C"])),
    );
    return COLOR_ORDER.filter((c) => have.has(c));
  }, [rows]);

  // nothing to filter on when every card has the same color identity
  const showColors = useMemo(
    () => new Set(rows.map((r) => [...r.colors].sort().join(""))).size > 1,
    [rows],
  );

  const shown = useMemo(() => {
    const out = rows.filter((r) => {
      if (types.size && !r.types.some((t) => types.has(t))) return false;
      if (colors.size) {
        // colorless is its own choice: it matches only cards with no color identity
        const want = colors.has("C") ? [] : [...colors];
        const hasAll = want.every((c) => r.colors.includes(c));
        const noneOutside = r.colors.every((c) => want.includes(c));
        if (mode === "exact" ? !(hasAll && noneOutside) : !noneOutside)
          return false;
      }
      return true;
    });
    const val = (r: PoolRow) => (sort === "name" ? r.name : r[sort]);
    return out.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      // unpriced cards sink to the bottom whichever way price is sorted
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      const c =
        typeof x === "string"
          ? x.localeCompare(y as string)
          : x - (y as number);
      return c * dir;
    });
  }, [rows, types, colors, mode, sort, dir]);

  const filtered = types.size > 0 || colors.size > 0;

  const colorless = colors.has("C");
  // C is exclusive: picking it clears the colors, picking a color clears it
  const pickColor = (c: string) =>
    setColors((cur) => {
      if (c === "C") return cur.has("C") ? new Set() : new Set(["C"]);
      const next = toggle(cur, c);
      next.delete("C");
      return next;
    });

  return (
    <section className="space-y-5">
      <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-4">
        {header && (
          <div className="border-b border-white/10 pb-3">{header}</div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 w-16 text-xs tracking-wide text-zinc-500">
            Sort by
          </span>
          <SortMenu
            value={sort}
            onChange={(k) => {
              setSort(k);
              setDir(sortDefaultDir(k));
            }}
          />
          <button
            type="button"
            onClick={() => setDir((d) => (d === 1 ? -1 : 1))}
            aria-label={dir === 1 ? "Ascending" : "Descending"}
            title={dir === 1 ? "Ascending" : "Descending"}
            className="rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-sm hover:bg-white/10"
          >
            {dir === 1 ? "↑ Asc" : "↓ Desc"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 w-16 text-xs tracking-wide text-zinc-500">
            Card Type
          </span>
          {typeOptions.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypes((s) => toggle(s, t))}
              className={chip(types.has(t))}
            >
              {t}
            </button>
          ))}
        </div>
        {showColors && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 w-16 text-xs tracking-wide text-zinc-500">
              Colors
            </span>
            {colorOptions.map((c) => (
              <button
                key={c}
                type="button"
                title={COLOR_NAMES[c]}
                aria-label={COLOR_NAMES[c]}
                aria-pressed={colors.has(c)}
                onClick={() => pickColor(c)}
                className={`rounded-full text-2xl leading-none transition ${colors.has(c) ? "ring-2 ring-lime-400 ring-offset-2 ring-offset-zinc-950" : "opacity-40 hover:opacity-70"}`}
              >
                <ManaSymbol symbol={c} decorative />
              </button>
            ))}
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "within" | "exact")}
              disabled={colorless}
              title={colorless ? "Colorless has no colors to match" : undefined}
              className="rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 ml-2 text-sm disabled:opacity-40"
            >
              <option value="exact">Exactly</option>
              <option value="within">At Most</option>
            </select>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setTypes(new Set());
                setColors(new Set());
              }}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Clear filters
            </button>
          )}
          <span className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm ring-2 ring-amber-400/40" />
              Top pick
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm ring-2 ring-sky-400/40" />
              Hidden gem
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm ring-2 ring-lime-400/40" />
              Both
            </span>
          </span>
          <span className="ml-auto text-xs text-zinc-500">
            {shown.length} of {rows.length} cards
          </span>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">No cards match these filters.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-5">
          {shown.map((r) => (
            <li key={r.id} className="min-w-0 space-y-2">
              <a
                href={r.href}
                target="_blank"
                rel="noreferrer"
                title={[r.picked && "Top pick", r.gem && "Hidden gem"]
                  .filter(Boolean)
                  .join(" · ")}
                className="block"
              >
                <CardImage
                  src={r.image}
                  alt={r.name}
                  highlight={highlightOf(r)}
                />
              </a>
              <div className="mt-2 flex flex-wrap gap-1">
                {r.tags.map((m) => (
                  <TagChip
                    key={m.tag}
                    tag={m.tag}
                    strong={m.anchor}
                    detail={m.detail}
                  />
                ))}
              </div>
              <div className="space-y-2 border-t border-white/10 pt-2">
                <div className="flex flex-wrap items-end gap-x-1.5 gap-y-1">
                  <Stat label="score" value={r.score} big />
                  <Stat label="fit" value={r.fit} />
                  <Stat label="cmdr" value={r.commander} />
                  <Stat label="qual" value={r.quality} />
                  <Stat label="pop" value={r.popularity} />
                  <Stat label="art" value={r.art} />
                </div>
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-zinc-500">
                  <Meta icon="edhrec-logo">
                    {r.rank ? `#${r.rank.toLocaleString()}` : "Unranked"}
                  </Meta>
                  {r.price != null && <Meta>${r.price.toFixed(2)}</Meta>}
                  {r.artist && <Meta icon="brush">{r.artist}</Meta>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
