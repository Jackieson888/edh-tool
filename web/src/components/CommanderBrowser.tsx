"use client";
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useMemo, useState } from "react";
import { ColorPips } from "@/components/ColorPips";
import type { CommanderListing } from "@/lib/data";

const COLORS = [["B", "Black"], ["G", "Green"], ["C", "Colorless"]] as const;
const PAGE = 48;

/** Filterable commander grid: name search plus exact color identity. */
export function CommanderBrowser({ commanders }: { commanders: CommanderListing[] }) {
  const [q, setQ] = useState("");
  const [colors, setColors] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    const want = colors.filter((c) => c !== "C").sort().join("");
    return commanders.filter((c) =>
      (!n || c.name.toLowerCase().includes(n)) &&
      (!colors.length || [...c.color_identity].sort().join("") === want));
  }, [commanders, q, colors]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
          placeholder={`Search ${commanders.length} commanders…`}
          className="w-full max-w-sm rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:text-zinc-500 focus:border-lime-400/60 focus:outline-none" />
        <div className="flex gap-1.5" role="group" aria-label="Color identity">
          {COLORS.map(([c, label]) => {
            const on = colors.includes(c);
            return (
              <button key={c} type="button" aria-pressed={on} title={label}
                onClick={() => { setShown(PAGE); setColors((cur) => c === "C" ? (on ? [] : ["C"])
                  : on ? cur.filter((x) => x !== c) : [...cur.filter((x) => x !== "C"), c]); }}
                className={`rounded-lg border px-2.5 py-1.5 text-sm transition ${on ? "border-lime-400/60 bg-lime-400/10" : "border-white/10 bg-white/5 hover:border-white/25"}`}>
                <ColorPips colors={c === "C" ? [] : [c]} />
              </button>
            );
          })}
        </div>
        <span className="text-sm text-zinc-500">{list.length} shown</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.slice(0, shown).map((c) => (
          <Link key={c.slug} href={`/commander/${c.slug}`}
            className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] transition hover:border-lime-400/50">
            {c.art_crop && (
              <img src={c.art_crop} alt="" loading="lazy"
                className="aspect-[4/3] w-full object-cover opacity-90 transition group-hover:opacity-100" />
            )}
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-medium">{c.name}</h2>
                <ColorPips colors={c.color_identity} />
              </div>
              <p className="text-sm text-zinc-400">
                {c.themes.length} themes · {c.pool.toLocaleString()} tagged cards
              </p>
            </div>
          </Link>
        ))}
      </div>
      {shown < list.length && (
        <button type="button" onClick={() => setShown((s) => s + PAGE)}
          className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-300 hover:border-white/25">
          Show more ({list.length - shown} left)
        </button>
      )}
    </section>
  );
}
