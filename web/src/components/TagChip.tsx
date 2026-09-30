import { tagLabel } from "@/lib/labels";

export function TagChip({ tag, detail, title, strong = false }: {
  tag: string; detail?: string; title?: string; strong?: boolean;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${
        strong ? "bg-lime-400/15 text-lime-300 ring-1 ring-lime-400/40" : "bg-white/5 text-zinc-300 ring-1 ring-white/10"
      }`}
    >
      {tagLabel(tag)}
      {detail && <span className="text-zinc-500">{detail}</span>}
    </span>
  );
}
