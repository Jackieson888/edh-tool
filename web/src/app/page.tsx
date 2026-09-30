import { CommanderBrowser } from "@/components/CommanderBrowser";
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
      <CommanderBrowser commanders={commanders} />
    </div>
  );
}
