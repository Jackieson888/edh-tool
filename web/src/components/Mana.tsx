import { Fragment } from "react";
import { COLOR_NAMES } from "@/lib/labels";
import {
  colorIndicatorClasses,
  parseSymbol,
  tokenize,
  typeIconClass,
  type ManaSymbolInfo,
} from "@/lib/mana";

// Mana font glyphs (src/styles/mana.css). Size everything with the parent's font-size
// (e.g. className="text-lg"); the glyphs are 1em-based.

function Glyph({
  info,
  decorative = false,
  className = "",
}: {
  info: ManaSymbolInfo;
  decorative?: boolean;
  className?: string;
}) {
  const cls = [
    "ms",
    ...info.classes,
    info.cost ? "ms-cost ms-shadow" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return decorative ? (
    <i className={cls} aria-hidden="true" />
  ) : (
    <i className={cls} role="img" aria-label={info.label} title={info.label} />
  );
}

/** One symbol: "{B}", "B", "{T}", "{G/P}". Falls back to its raw text if the font has no glyph. */
export function ManaSymbol({
  symbol,
  decorative,
  className,
}: {
  symbol: string;
  decorative?: boolean;
  className?: string;
}) {
  const info = parseSymbol(symbol);
  if (!info) return <span className={className}>{symbol}</span>;
  return <Glyph info={info} decorative={decorative} className={className} />;
}

/** A full mana cost like "{5}{B}{G}"; split/DFC costs ("{1}{U} // {3}{R}") keep their separator. */
export function ManaCost({
  cost,
  className = "",
}: {
  cost?: string | null;
  className?: string;
}) {
  if (!cost) return null;
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-[0.12em] ${className}`}
      role="img"
      aria-label={`Mana cost ${cost}`}
    >
      {cost.split(" // ").map((half, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span className="px-1 text-zinc-500" aria-hidden="true">
              {"//"}
            </span>
          )}
          {tokenize(half).map((t, j) =>
            t.kind === "symbol" ? (
              <SymbolToken key={j} token={t} decorative />
            ) : null,
          )}
        </Fragment>
      ))}
    </span>
  );
}

function SymbolToken({
  token,
  decorative,
}: {
  token: Extract<ReturnType<typeof tokenize>[number], { kind: "symbol" }>;
  decorative?: boolean;
}) {
  return token.symbol ? (
    <Glyph
      info={token.symbol}
      decorative={decorative}
      className="mx-[0.06em] text-[0.85em]"
    />
  ) : (
    <span className="font-mono text-[0.85em]">{token.raw}</span>
  );
}

/** Rules text with inline symbols; reminder text in parentheses is italicized. Keeps newlines, so
 *  put it inside something with `whitespace-pre-line`. */
export function ManaText({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <>
      {text.split(/(\([^()]*\))/).map((part, i) => {
        const inner = tokenize(part).map((t, j) =>
          t.kind === "text" ? (
            <Fragment key={j}>{t.text}</Fragment>
          ) : (
            <SymbolToken key={j} token={t} />
          ),
        );
        return part.startsWith("(") ? (
          <i key={i} className="text-zinc-500">
            {inner}
          </i>
        ) : (
          <Fragment key={i}>{inner}</Fragment>
        );
      })}
    </>
  );
}

/** Card type icon (creature, instant, land…) from a type line. */
export function CardTypeIcon({
  typeLine,
  className = "",
}: {
  typeLine?: string | null;
  className?: string;
}) {
  const hit = typeLine ? typeIconClass(typeLine) : null;
  if (!hit) return null;
  return (
    <i
      className={`ms ${hit.cls} ${className}`}
      role="img"
      aria-label={hit.type}
      title={hit.type}
    />
  );
}

/** Color indicator dot (ms-ci): one pie slice per color, e.g. a half-black/half-green disc. */
export function ColorIndicator({
  colors,
  className = "",
}: {
  colors: string[];
  className?: string;
}) {
  const names = colors.length
    ? colors.map((c) => COLOR_NAMES[c] ?? c).join(", ")
    : "Colorless";
  return (
    <i
      className={`ms ${colorIndicatorClasses(colors).join(" ")} ${className}`}
      role="img"
      aria-label={`Color identity: ${names}`}
      title={names}
    />
  );
}
