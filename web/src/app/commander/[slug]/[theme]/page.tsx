import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DEFAULT_CONFIG,
  rankTheme,
  recommend,
  type ScoredCard,
} from "@edh-tool/engine";
import { CardImage } from "@/components/CardImage";
import { HighImpactPool, type PoolRow } from "@/components/HighImpactPool";
import { StartThemeDeckButton } from "@/components/deck/StartThemeDeckButton";
import { TagChip } from "@/components/TagChip";
import { getCommander, getVocab, hydrate } from "@/lib/data";
import { tagLabel } from "@/lib/labels";

// Rendered per request: ?all=1 shows the whole candidate pool, ?debug=1 the scoring table.
export async function generateMetadata({
  params,
}: PageProps<"/commander/[slug]/[theme]">) {
  const { slug, theme } = await params;
  const data = await getCommander(slug);
  const t = data?.themes.find((x) => x.id === theme);
  return { title: t && data ? `${t.name} — ${data.commander.name}` : "Theme" };
}

const GEM_OBSCURITY = 0.82;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ThemePage({
  params,
  searchParams,
}: PageProps<"/commander/[slug]/[theme]">) {
  const [{ slug, theme: themeId }, sp] = await Promise.all([
    params,
    searchParams,
  ]);
  const [data, vocab] = await Promise.all([getCommander(slug), getVocab()]);
  const theme = data?.themes.find((t) => t.id === themeId);
  if (!data || !theme) notFound();

  const all = one(sp.all) === "1";
  const debug = one(sp.debug) === "1";
  const { picks, eligible } = recommend(
    data.index,
    data.entry,
    theme,
    DEFAULT_CONFIG,
    { deckSeed: "anon", reroll: 0 },
  );
  const poolSize = DEFAULT_CONFIG.candidates.poolSize;
  const ranked =
    all || debug
      ? rankTheme(data.index, data.entry, theme).slice(0, poolSize)
      : [];
  const q = (p: { all?: boolean; debug?: boolean }) => {
    const qs = [p.all && "all=1", p.debug && "debug=1"].filter(Boolean);
    return qs.length ? `?${qs.join("&")}` : "?";
  };
  const extra = await hydrate((all ? ranked : picks).map((p) => p.oracle_id)); // the pool leaves images/links out
  const pickedIds = new Set(picks.map((p) => p.oracle_id));
  const rows: PoolRow[] = all
    ? ranked.map((r) => {
        const card = data.index.get(r.oracle_id)!.card;
        const ex = extra.get(r.oracle_id);
        const ill = r.parts.illustration;
        return {
          id: r.oracle_id,
          name: r.name,
          image: ill?.image ?? ex?.image,
          href: ex?.scryfall_uri,
          types: card.types,
          colors: card.color_identity,
          price: card.price_usd != null ? Number(card.price_usd) : null,
          rank: card.edhrec_rank ?? null,
          artist: ill?.artist,
          gem: r.parts.obscurity >= GEM_OBSCURITY,
          picked: pickedIds.has(r.oracle_id),
          score: r.score,
          fit: r.parts.fit,
          commander: r.parts.commanderMult,
          quality: r.parts.quality,
          popularity: r.parts.popularityMult,
          art: r.parts.artMult,
          tags: r.parts.matched
            .filter((m) => m.contrib > 0)
            .map((m) => ({
              tag: m.tag,
              anchor: m.anchor,
              detail: m.role,
            })),
        };
      })
    : [];

  // Sits above the picks, or inside the filter panel when the whole pool is shown.
  const heading = (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          High Impact Cards
        </h2>
        <p className="text-sm text-zinc-500">
          {all
            ? `The top ${Math.min(eligible, poolSize)} of ${eligible} cards that fit`
            : `${picks.length} picks from the top ${Math.min(eligible, poolSize)} of ${eligible} cards that fit`}
        </p>
      </div>
      <Link
        href={all ? q({ debug }) : q({ all: true, debug })}
        scroll={false}
        className="shrink-0 rounded-lg bg-lime-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-lime-300"
      >
        {all ? "Back to Top Picks" : "View All High Impact Cards"}
      </Link>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Link
          href={`/commander/${slug}`}
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          ← {data.commander.name}
        </Link>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {theme.name}
          </h1>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs uppercase tracking-wide text-zinc-400">
            {theme.kind}
          </span>
        </div>
        <p className="max-w-prose text-zinc-400">{theme.pitch}</p>
        <div className="flex flex-wrap gap-1.5">
          {theme.tags.map((t, i) => (
            <TagChip
              key={t.tag}
              tag={t.tag}
              strong={i === 0}
              detail={`×${t.weight}`}
              title={vocab.tags[t.tag]?.definition}
            />
          ))}
        </div>
        <StartThemeDeckButton slug={slug} themeId={themeId} className="pt-2" />
      </div>

      {all ? (
        <HighImpactPool rows={rows} header={heading} />
      ) : (
        <>
          {heading}
          <ul className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-5">
            {picks.map((p) => (
              <Pick
                key={p.oracle_id}
                pick={p}
                data={data}
                extra={extra.get(p.oracle_id)}
              />
            ))}
          </ul>
        </>
      )}

      {debug && <DebugTable ranked={ranked} picked={pickedIds} />}
      {!debug && (
        <Link
          href={q({ all, debug: true })}
          className="block text-xs text-zinc-600 hover:text-zinc-400"
        >
          Show scoring details
        </Link>
      )}
    </div>
  );
}

function Pick({
  pick,
  data,
  extra,
}: {
  pick: ScoredCard;
  data: NonNullable<Awaited<ReturnType<typeof getCommander>>>;
  extra?: { image?: string; scryfall_uri?: string };
}) {
  const card = data.index.get(pick.oracle_id)!.card;
  const ill = pick.parts.illustration;
  // log-scaled obscurity: 0.82 ≈ EDHREC rank 5,000+ out of ~32k
  const gem = pick.parts.obscurity >= GEM_OBSCURITY;
  const why = pick.parts.matched.filter((m) => m.contrib > 0);
  return (
    <li className="space-y-2">
      <a href={extra?.scryfall_uri} target="_blank" rel="noreferrer">
        <CardImage src={ill?.image ?? extra?.image} alt={card.name} />
      </a>
      <div className="flex flex-wrap gap-1 mt-2">
        {gem && (
          <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs mx-1 text-amber-300 ring-1 ring-amber-400/40">
            Hidden gem
          </span>
        )}
        {why.map((m) => (
          <TagChip key={m.tag} tag={m.tag} strong={m.anchor} detail={m.role} />
        ))}
      </div>
      <p className="text-xs text-zinc-500">
        {card.edhrec_rank
          ? `EDHREC #${card.edhrec_rank.toLocaleString()}`
          : "Unranked"}
        {card.price_usd != null && ` · $${Number(card.price_usd).toFixed(2)}`}
        {ill?.artist && ` · art ${ill.artist}`}
      </p>
    </li>
  );
}

function DebugTable({
  ranked,
  picked,
}: {
  ranked: ScoredCard[];
  picked: Set<string>;
}) {
  const f = (n: number) => n.toFixed(2);
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-400">
        Candidate pool (score = fit × commander × quality × popularity × art)
      </h2>
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-left font-mono text-xs">
          <thead className="bg-white/5 text-zinc-400">
            <tr>
              {[
                "#",
                "card",
                "score",
                "fit",
                "cmd",
                "q",
                "pop",
                "art",
                "rank",
                "matched",
              ].map((h) => (
                <th key={h} className="px-2 py-1.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => (
              <tr
                key={r.oracle_id}
                className={`border-t border-white/5 ${picked.has(r.oracle_id) ? "bg-lime-400/10" : ""}`}
              >
                <td className="px-2 py-1">{i + 1}</td>
                <td className="px-2 py-1 font-sans">{r.name}</td>
                <td className="px-2 py-1">{r.score.toFixed(3)}</td>
                <td className="px-2 py-1">{f(r.parts.fit)}</td>
                <td className="px-2 py-1">{f(r.parts.commanderMult)}</td>
                <td className="px-2 py-1">{f(r.parts.quality)}</td>
                <td className="px-2 py-1">{f(r.parts.popularityMult)}</td>
                <td className="px-2 py-1">{f(r.parts.artMult)}</td>
                <td className="px-2 py-1">{r.parts.edhrec_rank ?? "—"}</td>
                <td className="px-2 py-1 font-sans text-zinc-400">
                  {r.parts.matched.map((m) => tagLabel(m.tag)).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
