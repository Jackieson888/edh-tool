import type { Metadata } from "next";
import { DeckBuilder } from "@/components/deck/DeckBuilder";

export const metadata: Metadata = { title: "Deck builder" };

export default async function DeckPage({ params }: PageProps<"/decks/[id]">) {
  const { id } = await params;
  return <DeckBuilder id={id} />;
}
