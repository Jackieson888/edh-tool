import { ManaSymbol } from "@/components/Mana";
import { COLOR_NAMES } from "@/lib/labels";

/** Color identity as real mana symbols (colorless -> {C}). */
export function ColorPips({
  colors,
  className = "",
}: {
  colors: string[];
  className?: string;
}) {
  const list = colors.length ? colors : ["C"];
  return (
    <span
      className={`inline-flex items-center gap-[0.15em] ${className}`}
      role="img"
      aria-label={`Color Identity: ${list.map((c) => COLOR_NAMES[c] ?? "Colorless").join(", ")}`}
    >
      {list.map((c) => (
        <ManaSymbol key={c} symbol={c} decorative />
      ))}
    </span>
  );
}
