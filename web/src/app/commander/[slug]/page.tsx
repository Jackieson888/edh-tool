 
import Link from "next/link";
import { notFound } from "next/navigation";
import { ColorPips } from "@/components/ColorPips";
import { CardImage } from "@/components/CardImage";
import { TagChip } from "@/components/TagChip";
import { getCommanderSummary, getVocab } from "@/lib/data";

// Rendered on first visit, then cached; the catalog only changes when the loader runs.
export const revalidate = 3600;
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/commander/[slug]">) {
  const data = await getCommanderSummary((await params).slug);
  return { title: data?.commander.name ?? "Commander" };
}

export default async function CommanderPage({ params }: PageProps<"/commander/[slug]">) {
  const { slug } = await params;
  const [data, vocab] = await Promise.all([getCommanderSummary(slug), getVocab()]);
  if (!data) notFound();
  const { commander, themes } = data;
  const core = themes.filter((t) => t.kind === "core");
  const stretch = themes.filter((t) => t.kind === "stretch");

  return (
    <div className="space-y-10">
      <section className="grid items-start gap-8 md:grid-cols-[260px_1fr]">
        <CardImage src={commander.image} alt={commander.name} />
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{commander.name}</h1>
            <ColorPips colors={commander.color_identity} />
          </div>
          <p className="max-w-prose whitespace-pre-line text-zinc-400">{commander.oracle_text}</p>
          <div className="flex flex-wrap gap-1.5">
            {data.tags.map((t) => (
              <TagChip key={t.tag} tag={t.tag} title={vocab.tags[t.tag]?.definition} />
            ))}
          </div>
          <p className="text-sm text-zinc-500">
            {themes.length ? "How do you want this deck to play?" : "Themes for this commander are coming soon."}
          </p>
        </div>
      </section>

      {[["Core themes", "What the commander does best.", core],
        ["Stretch themes", "Off the beaten path, but they work.", stretch]].map(([title, sub, list]) =>
        (list as typeof themes).length ? (
          <section key={title as string} className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">{title as string}</h2>
              <p className="text-sm text-zinc-500">{sub as string}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {(list as typeof themes).map((t) => (
                <Link key={t.id} href={`/commander/${slug}/${t.id}`}
                  className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-lime-400/50">
                  <h3 className="text-lg font-medium">{t.name}</h3>
                  <p className="flex-1 text-sm text-zinc-400">{t.pitch}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {t.tags.map((tt, i) => (
                      <TagChip key={tt.tag} tag={tt.tag} strong={i === 0}
                        title={vocab.tags[tt.tag]?.definition} />
                    ))}
                  </div>
                  {t.viable_cards != null && (
                    <p className="text-xs text-zinc-500">
                      {t.viable_cards} cards fit this theme
                      {(t.status === "relaxed" || t.status === "fallback") && " · broad picks, looser fit"}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}
