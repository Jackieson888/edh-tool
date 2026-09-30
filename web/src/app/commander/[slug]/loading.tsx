import { LoadingShell, Skel } from "@/components/Skeleton";

// Shown for both the commander page and its theme pages (the first new segment decides the
// boundary), so it stays neutral: a title, a blurb and a grid of cards.
export default function Loading() {
  return (
    <LoadingShell label="Loading…">
      <div className="space-y-3">
        <Skel className="h-9 w-2/3 max-w-lg" />
        <Skel className="h-4 w-full max-w-prose" />
        <Skel className="h-4 w-4/5 max-w-prose" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => <Skel key={i} className="aspect-[488/680]" />)}
      </div>
    </LoadingShell>
  );
}
