import { LoadingShell, Skel, Spinner } from "@/components/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Scoring cards for this theme…">
      <div className="flex items-center gap-3 text-sm text-zinc-400"><Spinner /> Scoring cards for this theme…</div>
      <Skel className="h-9 w-1/2" />
      <Skel className="h-4 w-full max-w-prose" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }, (_, i) => <Skel key={i} className="aspect-[488/680]" />)}
      </div>
    </LoadingShell>
  );
}
