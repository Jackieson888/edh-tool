// Scryfall symbol text ("{2}{B/P}{T}") -> Mana font classes (https://mana.andrewgioia.com).
// The font's class names follow Scryfall's symbol codes: lowercase, slashes dropped
// ({W/U} -> ms-wu, {2/G} -> ms-2g, {B/G/P} -> ms-bgp, {T} -> ms-tap).

export interface ManaSymbolInfo {
  raw: string;          // "{B/P}"
  classes: string[];    // ["ms-bp"] — without the base "ms"
  label: string;        // "Phyrexian black mana"
  cost: boolean;        // draw it as a round cost pip (ms-cost)
}

const COLOR: Record<string, string> = { W: "white", U: "blue", B: "black", R: "red", G: "green", C: "colorless" };

// Non-mana symbols that show up in costs and rules text.
const NAMED: Record<string, [cls: string, label: string, cost: boolean]> = {
  T: ["tap", "Tap", true],
  Q: ["untap", "Untap", true],
  S: ["s", "Snow mana", true],
  E: ["e", "Energy", false],
  PW: ["planeswalker", "Planeswalker", false],
  CHAOS: ["chaos", "Chaos", false],
  A: ["acorn", "Acorn", false],
  TK: ["ticket", "Ticket", false],
  "∞": ["infinity", "Infinite mana", true],
  "½": ["1-2", "Half generic mana", true],
};

// Generic costs the font actually has glyphs for.
const GENERIC = new Set([...Array.from({ length: 21 }, (_, i) => String(i)), "100", "1000000"]);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Parse one symbol, with or without braces. Returns null for anything the font can't draw. */
export function parseSymbol(symbol: string): ManaSymbolInfo | null {
  const body = symbol.replace(/^\{|\}$/g, "").toUpperCase();
  const raw = `{${body}}`;
  const named = NAMED[body];
  if (named) return { raw, classes: [`ms-${named[0]}`], label: named[1], cost: named[2] };
  if (GENERIC.has(body)) return { raw, classes: [`ms-${body}`], label: `${body} generic mana`, cost: true };
  if (/^[XYZ]$/.test(body)) return { raw, classes: [`ms-${body.toLowerCase()}`], label: `${body} generic mana`, cost: true };
  if (COLOR[body]) return { raw, classes: [`ms-${body.toLowerCase()}`], label: `${cap(COLOR[body])} mana`, cost: true };

  let m = /^H([WUBRG])$/.exec(body); // Unhinged half-mana
  if (m) return { raw, classes: [`ms-${m[1].toLowerCase()}`, "ms-half"], label: `Half ${COLOR[m[1]]} mana`, cost: true };

  m = /^([WUBRG])\/P$/.exec(body); // Phyrexian
  if (m) return { raw, classes: [`ms-${m[1].toLowerCase()}p`], label: `Phyrexian ${COLOR[m[1]]} mana`, cost: true };

  m = /^([WUBRGC2])\/([WUBRG])(\/P)?$/.exec(body); // hybrid, monocolor hybrid, colorless hybrid, phyrexian hybrid
  if (m) {
    const [, a, b, p] = m;
    const first = a === "2" ? "two generic" : COLOR[a];
    return {
      raw,
      classes: [`ms-${(a + b).toLowerCase()}${p ? "p" : ""}`],
      label: `${p ? "Phyrexian " : ""}hybrid ${first} or ${COLOR[b]} mana`.replace(/^./, (c) => c.toUpperCase()),
      cost: true,
    };
  }
  return null;
}

export type ManaToken = { kind: "text"; text: string } | { kind: "symbol"; symbol: ManaSymbolInfo | null; raw: string };

/** Split text into plain runs and {symbols}. Unknown symbols keep their raw text. */
export function tokenize(text: string): ManaToken[] {
  const out: ManaToken[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{[^{}]+\}/g)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "symbol", symbol: parseSymbol(m[0]), raw: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

// Card type -> Mana font type icon. First match wins, so "Artifact Creature" shows as a creature.
const TYPE_ICONS: [type: string, cls: string][] = [
  ["Planeswalker", "planeswalker"],
  ["Battle", "battle"],
  ["Creature", "creature"],
  ["Land", "land"],
  ["Instant", "instant"],
  ["Sorcery", "sorcery"],
  ["Artifact", "artifact"],
  ["Enchantment", "enchantment"],
  ["Kindred", "tribal"],
  ["Tribal", "tribal"],
];

export function typeIconClass(typeLine: string): { cls: string; type: string } | null {
  const front = typeLine.split(" // ")[0].split(" — ")[0];
  const words = new Set(front.split(/\s+/));
  for (const [type, cls] of TYPE_ICONS) if (words.has(type)) return { cls: `ms-${cls}`, type };
  return null;
}

const WUBRG = ["W", "U", "B", "R", "G"];

/** Color indicator classes (the pie-slice dot): ["ms-ci", "ms-ci-2", "ms-ci-bg"]. Colorless gets
 *  our own ms-ci-c (globals.css); the font has no colorless indicator. */
export function colorIndicatorClasses(colors: string[]): string[] {
  const list = WUBRG.filter((c) => colors.includes(c));
  if (!list.length) return ["ms-ci", "ms-ci-c"];
  return ["ms-ci", `ms-ci-${list.length}`, `ms-ci-${list.join("").toLowerCase()}`];
}
