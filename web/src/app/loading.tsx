import { LoadingShell, Skel } from "@/components/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Loading…">
      <Skel className="h-10 w-2/3 max-w-xl" />
      <Skel className="h-4 w-full max-w-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <Skel key={i} className="h-64" />)}
      </div>
    </LoadingShell>
  );
}
