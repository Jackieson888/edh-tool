export type Section = "commander" | "main" | "side" | "maybe";
export type Board = "main" | "maybe";

export interface ParsedEntry {
  line: string;
  qty: number;
  name: string;
  section: Section;
  printing?: string;
  categories?: string[];
}
export interface DeckCardRef {
  oracle_id: string;
  qty: number;
  board: Board;
  printing?: string;
}
export interface Unresolved {
  line: string;
  name: string;
  qty: number;
  section: Section;
}

export function sectionHeader(line: string): Section | null;
export function parseLine(raw: string): { qty: number; name: string; printing?: string; foil?: string; categories?: string[]; section?: Section } | null;
export function parseDecklist(text: string): { entries: ParsedEntry[]; name?: string };
export function normalizeName(name: string): string;
export function buildNameIndex(cards: { oracle_id: string; name: string }[]): Map<string, string>;
export function lookupName(nameIndex: Map<string, string>, name: string): string | null;
export function suggestNames(cards: { oracle_id: string; name: string }[], name: string, limit?: number): { oracle_id: string; name: string; score: number }[];
export function resolveEntries(entries: ParsedEntry[], nameIndex: Map<string, string>): {
  cards: DeckCardRef[];
  commanders: string[];
  unresolved: Unresolved[];
};
export function exportDecklist(
  deck: { commanders: string[]; cards: DeckCardRef[] },
  names: Map<string, string> | Record<string, string>,
  opts?: {
    format?: "text" | "moxfield" | "archidekt";
    printings?: boolean;
    maybeboard?: boolean;
    categories?: Map<string, string> | Record<string, string>;
  },
): string;
