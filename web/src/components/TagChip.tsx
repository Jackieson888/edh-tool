import { tagLabel } from "@/lib/labels";

// Role details render as arrows; any other detail (e.g. "×3") stays text.
const ROLE_ICON: Record<string, { icon: string; label: string }> = {
  enabler: { icon: "arrow-top-right", label: "Enabler" },
  payoff: { icon: "star-four-points-circle-outline", label: "Payoff" },
  both: {
    icon: "arrow-top-right-thin-circle-outline",
    label: "Enabler and payoff",
  },
};

function RoleIcon({ role }: { role: string }) {
  const { icon, label } = ROLE_ICON[role];
  const url = `url(/imgs/${icon}.svg)`;
  // the SVGs are unfilled paths, so use them as a mask to take the text color
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-block size-3.5 bg-current text-zinc-500"
      style={{
        maskImage: url,
        WebkitMaskImage: url,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}

export function TagChip({
  tag,
  detail,
  title,
  strong = false,
}: {
  tag: string;
  detail?: string;
  title?: string;
  strong?: boolean;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${
        strong
          ? "bg-lime-400/15 text-lime-300 ring-1 ring-lime-400/40"
          : "bg-white/5 text-zinc-300 ring-1 ring-white/10"
      }`}
    >
      {tagLabel(tag)}
      {detail &&
        (detail in ROLE_ICON ? (
          <RoleIcon role={detail} />
        ) : (
          <span className="text-zinc-500">{detail}</span>
        ))}
    </span>
  );
}
