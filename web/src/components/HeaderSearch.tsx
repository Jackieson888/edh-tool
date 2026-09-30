"use client";
import { useRouter } from "next/navigation";
import { CardSearch } from "@/components/CardSearch";

/** Look up any card and see which commanders it fits. */
export function HeaderSearch() {
  const router = useRouter();
  return (
    <CardSearch placeholder="Find commanders for a card…" className="w-full max-w-xs"
      onPick={(c) => router.push(`/card/${c.oracle_id}`)} />
  );
}
