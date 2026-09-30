import Link from "next/link";
import { notFound } from "next/navigation";
import { CardImage } from "@/components/CardImage";
import { ColorIndicator, ManaCost } from "@/components/Mana";
import { StartDeckButton } from "@/components/deck/StartDeckButton";
import { TagChip } from "@/components/TagChip";
import { getAllCards } from "@/lib/data";
import { commandersFor } from "@/lib/suggest";

export async function generateMetadata({ params }: PageProps<"/card/[oracleId]">) {
  const { byId } = await getAllCards();
  return { title: byId.get((await params).oracleId)?.name ?? "Card" };
}

export default async function CardPage({ params }: PageProps<"/card/[oracleId]">) {
  const { oracleId } = await params;
  const { byId } = await getAllCards();
  const card = byId.get(oracleId);
  if (!card) notFound();
  const commanders = card.tagged ? await commandersFor([oracleId], 13) : [];
  const own = card.commander_eligible ? commanders.find((c) => c.oracle_id === oracleId) : undefined;
  const others = commanders.filter((c) => c.oracle_id !== oracleId).slice(0, 12);

  return (
    <div className="space-y-10">
      <section className="grid items-start gap-8 md:grid-cols-[260px_1fr]">
        <CardImage src={card.image} alt={card.name} />
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">{card.name}</h1>
            <ManaCost cost={card.mana_cost} className="text-xl" />
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-400">
            <span>{card.type_line}</span>
            <span className="inline-flex items-center gap-2">
              <span className="text-zinc-500">Color identity</span>
              <ColorIndicator colors={card.color_identity} className="text-xl" />
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {own && <Link href={`/commander/${own.slug}`} className="rounded-lg border border-lime-400/50 px-4 py-2 text-sm text-lime-300 hover:bg-lime-400/10">See its themes</Link>}
            {card.commander_eligible
              ? <StartDeckButton commander={oracleId} name={`${card.name} deck`} label="Start a deck with this commander" />
              : <StartDeckButton card={oracleId} label="Start a deck with this card" />}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Commanders for this card</h2>
          <p className="text-sm text-zinc-500">Commanders whose colors cover it and whose themes it fits.</p>
        </div>
        {!card.tagged ? (
          <p className="text-sm text-zinc-400">This card hasn&apos;t been analyzed yet (only black, green and colorless cards are tagged so far), so there are no suggestions.</p>
        ) : others.length === 0 ? (
          <p className="text-sm text-zinc-400">No commander with generated themes fits this card yet.</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((s) => (
              <li key={s.oracle_id}>
                <Link href={`/commander/${s.slug}`} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-lime-400/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {s.image && <img src={s.image} alt="" loading="lazy" className="h-28 w-auto shrink-0 rounded-[5%]" />}
                  <div className="min-w-0 space-y-1.5">
                    <p className="flex items-center gap-2 font-medium"><span className="truncate">{s.name}</span><ColorIndicator colors={s.color_identity} className="shrink-0 text-sm" /></p>
                    {s.theme && <p className="text-xs text-zinc-400">Fits <span className="text-zinc-200">{s.theme.name}</span></p>}
                    <div className="flex flex-wrap gap-1">{(s.theme?.tags ?? s.synergyTags).slice(0, 3).map((t) => <TagChip key={t} tag={t} />)}</div>
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
