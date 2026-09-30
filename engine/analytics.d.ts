export interface AnalyticsCard {
  oracle_id: string; name: string; mana_cost?: string; cmc?: number; type_line?: string; oracle_text?: string;
  produced_mana?: string[]; game_changer?: boolean; price_usd?: number | string | null; tags?: string[];
}
export interface AnalyticsRow { card: AnalyticsCard; qty: number }
export interface RoleStat { id: string; label: string; tags: string[]; min: number; max: number; count: number; status: "low" | "ok" | "high";
  /** Not yet produced by the engine; the panel treats it as optional. */
  cards?: { oracle_id: string; name: string; qty: number; cmc?: number }[] }
export interface DeckAnalytics {
  total: number; lands: number; nonlands: number;
  curve: { mv: number; label: string; count: number }[];
  mv: { avgNonland: number; median: number; avgAll: number; totalNonland: number };
  colors: { color: string; pips: number; pipShare: number; sources: number; landSources: number }[];
  /** Not yet produced by the engine; the panel treats it as optional. */
  sourceTargets?: { color: string; target?: number; status: "low" | "ok" | "high" }[];
  /** Not yet produced by the engine; the panel treats it as optional. */
  landSuggestion?: { min: number; max: number; raw: number; formula: string };
  types: { type: string; count: number }[];
  roles: RoleStat[];
  tags: { tag: string; count: number; share: number }[];
  tagCoverage: number;
  landOdds: {
    library: number; lands: number; nextDraw: number; opening: number[]; keep: number;
    turns: { turn: number; onPlay: number; onDraw: number; expectedLandsPlay: number }[];
  };
  bracket: { bracket: number; name: string; reasons: string[]; gameChangers: string[]; extraTurns: string[];
    massLandDenial: string[]; tutors: string[]; estimate: true };
  priceUsd: number;
}
export const COLORS: string[];
export const TYPE_ORDER: string[];
export const ROLE_TARGETS: { id: string; label: string; tags: string[]; min: number; max: number }[];
export function typeGroup(typeLine?: string): string;
export function isLand(c: { type_line?: string }): boolean;
export function pipsOf(cost?: string): Record<"W" | "U" | "B" | "R" | "G", number>;
export function hypergeom(pop: number, succ: number, draws: number, k: number): number;
export function isTutor(c: { oracle_text?: string; tags?: string[] }): boolean;
export function isExtraTurn(c: { oracle_text?: string }): boolean;
export function isMassLandDenial(c: { name: string; oracle_text?: string }): boolean;
export function estimateBracket(x: { gameChangers: string[]; extraTurns: string[]; massLandDenial: string[]; tutors: string[] }):
  { bracket: number; name: string; reasons: string[] };
export function analyzeDeck(rows: AnalyticsRow[], commanders?: AnalyticsCard[], opts?: { maxTurn?: number }): DeckAnalytics;
