"use client";
import { useRouter } from "next/navigation";
import { CardSearch } from "@/components/CardSearch";

/** One search for everything: commanders first, then any other Commander-legal card. Every pick opens
 *  the card page, which shows a commander's own themes and the commanders a card fits. */
export function HeaderSearch({ className = "" }: { className?: string }) {
  const router = useRouter();
  return (
    <CardSearch sections placeholder="Search commanders and cards…" className={className}
      listClassName="right-0 w-[min(92vw,26rem)]"
      onPick={(c) => router.push(`/card/${c.oracle_id}`)} />
  );
}
