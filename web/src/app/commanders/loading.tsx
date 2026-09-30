import { LoadingShell, Skel } from "@/components/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Loading commanders…">
      <Skel className="h-9 w-56" />
      <Skel className="h-12 w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 12 }, (_, i) => <Skel key={i} className="h-52" />)}
      </div>
    </LoadingShell>
  );
}
