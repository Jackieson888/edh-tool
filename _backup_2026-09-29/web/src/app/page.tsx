/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ColorPips } from "@/components/ColorPips";
import { listCommanders } from "@/lib/data";

export default async function Home() {
  const commanders = await listCommanders();
  return (
    <div className="space-y-8">
      <section className="max-w-2xl space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">
          Find the deck nobody else is building.
        </h1>
        <p className="text-zinc-400">
          Find the deck nobody else is building. EDH Tool breaks each commander
          into themed play styles and surfaces hidden-gem cards that fit them,
          the stuff that won&apos;t top an EDHREC page. It works best alongside
          EDHREC and Scryfall: they show you what&apos;s popular and help you
          search, and we help you get creative.
        </p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {commanders.map((c) => (
          <Link
            key={c.slug}
            href={`/commander/${c.slug}`}
            className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] transition hover:border-lime-400/50"
          >
            {c.art_crop && (
              <img
                src={c.art_crop}
                alt=""
                className="aspect-[4/3] w-full object-cover opacity-90 transition group-hover:opacity-100"
              />
            )}
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-medium">{c.name}</h2>
                <ColorPips colors={c.color_identity} />
              </div>
              <p className="text-sm text-zinc-400">
                {c.themes.length} themes · {c.pool.toLocaleString()} tagged
                cards
              </p>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
