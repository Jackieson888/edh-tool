import { LoadingShell, Skel } from "@/components/Skeleton";

export default function Loading() {
  return (
    <LoadingShell label="Loading deck…">
      <Skel className="h-9 w-64" />
      <Skel className="h-12 w-full" />
      <div className="grid gap-6 md:grid-cols-2">
        <Skel className="h-72" /><Skel className="h-72" />
      </div>
    </LoadingShell>
  );
}
