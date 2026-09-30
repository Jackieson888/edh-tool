"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ColorPips } from "@/components/ColorPips";
import { ManaSymbol } from "@/components/Mana";
import { COLOR_NAMES, tagLabel } from "@/lib/labels";

interface Item {
  slug: string;
  name: string;
  color_identity: string[];
  art_crop: string | null;
  themeCount: number;
}
// "C" = colorless only; it can't be combined with the real colors.
const COLORS = ["W", "U", "B", "R", "G", "C"];

export function CommanderBrowser({
  tags,
}: {
  tags: { tag: string; count: number }[];
}) {
  const [colors, setColors] = useState<string[]>([]);
  const [mode, setMode] = useState<"within" | "exact">("within");
  const [tag, setTag] = useState("");
  const [q] = useState("");
  const [themed, setThemed] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const gen = useRef(0); // ignores responses from an older filter set

  const query = useCallback(
    (after: string | null) => {
      const p = new URLSearchParams({ colors: colors.join(""), mode });
      if (tag) p.set("tag", tag);
      if (q.trim()) p.set("q", q.trim());
      if (themed) p.set("themed", "1");
      if (after) p.set("after", after);
      return `/api/commanders?${p}`;
    },
    [colors, mode, tag, q, themed],
  );

  // filters changed: start over
  useEffect(() => {
    const id = ++gen.current;
    const t = setTimeout(
      async () => {
        setLoading(true);
        try {
          const r = await (await fetch(query(null))).json();
          if (id !== gen.current) return;
          setItems(r.items);
          setNext(r.next);
          setDone(!r.next);
        } finally {
          if (id === gen.current) setLoading(false);
        }
      },
      q ? 250 : 0,
    ); // debounce typing only
    return () => clearTimeout(t);
  }, [query, q]);

  const more = useCallback(async () => {
    if (!next || loading) return;
    const id = gen.current;
    setLoading(true);
    try {
      const r = await (await fetch(query(next))).json();
      if (id !== gen.current) return;
      setItems((cur) => [...cur, ...r.items]);
      setNext(r.next);
      setDone(!r.next);
    } finally {
      if (id === gen.current) setLoading(false);
    }
  }, [next, loading, query]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && more(), {
      rootMargin: "600px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [more]);

  const toggle = (c: string) =>
    setColors((cur) =>
      cur.includes(c)
        ? cur.filter((x) => x !== c)
        : c === "C"
          ? ["C"]
          : [...cur.filter((x) => x !== "C"), c],
    );
  const colorless = colors.includes("C");

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5" role="group" aria-label="Color Identity">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => toggle(c)}
              aria-pressed={colors.includes(c)}
              title={COLOR_NAMES[c] ?? "Colorless"}
              aria-label={COLOR_NAMES[c] ?? "Colorless"}
              className={`rounded-full text-2xl leading-none transition ${colors.includes(c) ? "ring-2 ring-lime-400 ring-offset-2 ring-offset-zinc-950" : "opacity-40 hover:opacity-70"}`}
            >
              <ManaSymbol symbol={c} decorative />
            </button>
          ))}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "within" | "exact")}
            disabled={colorless}
            title={
              colorless
                ? "Colorless commanders have no colors to match"
                : undefined
            }
            className="rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 ml-2 text-sm disabled:opacity-40"
          >
            <option value="within">At Most</option>
            <option value="exact">Exactly</option>
          </select>
        </div>
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="rounded-lg border border-white/10 bg-zinc-900 px-2 py-1.5 text-sm"
        >
          <option value="">All Tags</option>
          {tags.map((t) => (
            <option key={t.tag} value={t.tag}>
              {tagLabel(t.tag)} ({t.count})
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={themed}
            onChange={(e) => setThemed(e.target.checked)}
          />{" "}
          Has themes
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((c) => (
          <Link
            key={c.slug}
            href={`/commander/${c.slug}`}
            className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] transition hover:border-lime-400/50"
          >
            {c.art_crop && (
              <img
                src={c.art_crop}
                alt=""
                loading="lazy"
                className="aspect-[4/3] w-full object-cover opacity-90 transition group-hover:opacity-100"
              />
            )}
            <div className="space-y-1 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium leading-tight">{c.name}</h3>
                <ColorPips colors={c.color_identity} />
              </div>
              <p className="text-xs text-zinc-500">
                {c.themeCount ? `${c.themeCount} themes` : "Themes coming soon"}
              </p>
            </div>
          </Link>
        ))}
      </div>
      <div ref={sentinel} className="py-6 text-center text-sm text-zinc-500">
        {loading
          ? "Loading…"
          : done
            ? items.length
              ? "That's everyone."
              : "No commanders match those filters."
            : ""}
      </div>
    </section>
  );
}
