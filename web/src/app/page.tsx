/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ColorPips } from "@/components/ColorPips";
import { TagChip } from "@/components/TagChip";
import { featured } from "@/lib/browse";

// The featured picks are random; regenerating the page hourly rotates them for everyone at once.
export const revalidate = 3600;

export default async function Home() {
  const picks = await featured(8);
  return (
    <div className="space-y-4">
      <section className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Find the deck nobody else is building.
        </h1>
        <p className="text-zinc-400">
          Explore each commander through flavorful, unique archetypes, find the
          cards that bring your chosen theme to life, then build and analyze
          your deck right in the browser. Use it alongside EDHREC and Scryfall:
          they show what&apos;s popular, and EDH Tool helps you build a deck
          that feels like yours.
        </p>
      </section>
      <hr className="opacity-10" />
      <section className="space-y-4">
        <div className="flex flex-col items-baseline justify-between gap-1">
          <h2 className="text-xl font-semibold">Featured Commander Themes</h2>
          <Link
            href="/commanders"
            className="text-sm text-lime-300 hover:text-lime-200"
          >
            Browse All Commanders
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {picks.map((c) => (
            <Link
              key={c.slug}
              href={
                c.theme
                  ? `/commander/${c.slug}/${c.theme.id}`
                  : `/commander/${c.slug}`
              }
              className="group flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] transition hover:border-lime-400/50"
            >
              {c.art_crop && (
                <img
                  src={c.art_crop}
                  alt=""
                  className="aspect-[4/3] w-full object-cover opacity-90 transition group-hover:opacity-100"
                />
              )}
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium leading-tight">
                    {c.name}
                  </h3>
                  <ColorPips colors={c.color_identity} />
                </div>
                {c.theme && (
                  <>
                    <p className="text-base font-semibold leading-tight text-lime-300">
                      {c.theme.name}
                    </p>
                    <p className="line-clamp-3 flex-1 text-xs text-zinc-400">
                      {c.theme.pitch}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {c.theme.tags.map((t, i) => (
                        <TagChip key={t} tag={t} strong={i === 0} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
