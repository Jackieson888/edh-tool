import type { Metadata } from "next";
import { CommanderBrowser } from "@/components/CommanderBrowser";
import { tagCounts } from "@/lib/browse";

export const metadata: Metadata = { title: "Commanders" };
export const revalidate = 3600;

export default async function CommandersPage() {
  const tags = await tagCounts();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          Browse Commanders
        </h1>
        <p className="text-sm text-zinc-500">
          Filter by colors or theme tag to find a commander worth building
          around.
        </p>
      </div>
      <CommanderBrowser tags={tags} />
    </div>
  );
}
