import { LoadingShell, Skel } from "@/components/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Loading card…">
      <div className="grid items-start gap-8 md:grid-cols-[260px_1fr]">
        <Skel className="aspect-[488/680] w-full" />
        <div className="space-y-4">
          <Skel className="h-9 w-2/3" />
          <Skel className="h-4 w-1/2" />
          <Skel className="h-24 w-full max-w-prose" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <Skel key={i} className="h-40" />)}
      </div>
    </LoadingShell>
  );
}
