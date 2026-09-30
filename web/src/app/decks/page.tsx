import type { Metadata } from "next";
import { DeckList } from "@/components/deck/DeckList";

export const metadata: Metadata = { title: "My decks" };

export default function DecksPage() {
  return <DeckList />;
}
