import Link from "next/link";
import { notFound } from "next/navigation";
import { CardImage } from "@/components/CardImage";
import { ColorIndicator, ManaCost } from "@/components/Mana";
import { StartDeckButton } from "@/components/deck/StartDeckButton";
import { TagChip } from "@/components/TagChip";
import { getAllCards, getCommanderSummaryByOracle, getVocab } from "@/lib/data";
import { commandersFor } from "@/lib/suggest";

export async function generateMetadata({
  params,
}: PageProps<"/card/[oracleId]">) {
  const { byId } = await getAllCards();
  return { title: byId.get((await params).oracleId)?.name ?? "Card" };
}

export default async function CardPage({
  params,
}: PageProps<"/card/[oracleId]">) {
  const { oracleId } = await params;
  const { byId } = await getAllCards();
  const card = byId.get(oracleId);
  if (!card) notFound();
  const [commanders, ownSummary, vocab] = await Promise.all([
    card.tagged ? commandersFor([oracleId], 13) : Promise.resolve([]),
    card.commander_eligible
      ? getCommanderSummaryByOracle(oracleId)
      : Promise.resolve(null),
    getVocab(),
  ]);
  const others = commanders
    .filter((c) => c.oracle_id !== oracleId)
    .slice(0, 12);
  const ownThemes = (ownSummary?.themes ?? []).filter((t) =>
    ["ok", "relaxed", "fallback"].includes(t.status ?? "ok"),
  );

  return (
    <div className="space-y-10">
      <section className="grid items-start gap-8 md:grid-cols-[260px_1fr]">
        <CardImage src={card.image} alt={card.name} />
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {card.name}
            </h1>
            <ManaCost cost={card.mana_cost} className="text-xl" />
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-400">
            <span>{card.type_line}</span>
            <span className="inline-flex items-center gap-2">
              <span className="text-zinc-500">Color Identity</span>
              <ColorIndicator
                colors={card.color_identity}
                className="text-xl"
              />
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {card.commander_eligible ? (
              <StartDeckButton
                commander={oracleId}
                name={`${card.name} deck`}
                label="Start a deck with this commander"
              />
            ) : (
              <StartDeckButton
                card={oracleId}
                label="Start a deck with this card"
              />
            )}
          </div>
        </div>
      </section>

      {card.commander_eligible && (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Themes as a commander</h2>
            <p className="text-sm text-zinc-500">
              How {card.name} plays when it leads the deck.
            </p>
          </div>
          {ownThemes.length === 0 ? (
            <p className="text-sm text-zinc-400">
              Themes for this commander are coming soon.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {ownThemes.map((t) => (
                <Link
                  key={t.id}
                  href={`/commander/${ownSummary!.slug}/${t.id}`}
                  className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-lime-400/50"
                >
                  <h3 className="text-lg font-medium">{t.name}</h3>
                  <p className="flex-1 text-sm text-zinc-400">{t.pitch}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {t.tags.map((tt, i) => (
                      <TagChip
                        key={tt.tag}
                        tag={tt.tag}
                        strong={i === 0}
                        title={vocab.tags[tt.tag]?.definition}
                      />
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">
            {card.commander_eligible
              ? "Other commanders this card fits"
              : "Commanders for this card"}
          </h2>
          <p className="text-sm text-zinc-500">
            Commanders whose colors cover it and whose themes it fits.
          </p>
        </div>
        {!card.tagged ? (
          <p className="text-sm text-zinc-400">
            This card hasn&apos;t been analyzed yet, so there are no
            suggestions.
          </p>
        ) : others.length === 0 ? (
          <p className="text-sm text-zinc-400">
            No commander with generated themes fits this card yet.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((s) => (
              <li key={s.oracle_id}>
                <Link
                  href={`/commander/${s.slug}`}
                  className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-lime-400/50"
                >
                  {s.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={s.image}
                      alt=""
                      loading="lazy"
                      className="h-28 w-auto shrink-0 rounded-[5%]"
                    />
                  )}
                  <div className="min-w-0 space-y-1.5">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{s.name}</span>
                      <ColorIndicator
                        colors={s.color_identity}
                        className="shrink-0 text-sm"
                      />
                    </p>
                    {s.theme && (
                      <p className="text-xs text-zinc-400">
                        Fits{" "}
                        <span className="text-zinc-200">{s.theme.name}</span>
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {(s.theme?.tags ?? s.synergyTags).slice(0, 3).map((t) => (
                        <TagChip key={t} tag={t} />
                      ))}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
