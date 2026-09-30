import type { CommanderSuggestion, Config, DeckPick, DeckProfile, Index, IndexEntry, Theme, ThemeState } from "./score";

export const DECK_CONFIG: Config;
export function deckThemeProfile(index: Index, commander: IndexEntry, themes: Theme[], deckIds: string[], dcfg?: Config): DeckProfile;
export function activeThemeIds(profile: DeckProfile, themes: Theme[], state?: ThemeState): string[];
export function deckRecommendations(
  index: Index, commander: IndexEntry, theme: Theme, deckIds: string[], cfg?: Config,
  opts?: { seed?: string; k?: number; maybeIds?: string[]; dcfg?: Config },
): { picks: DeckPick[]; eligible: number; support: Record<string, number> };
export function suggestCommanders(
  index: Index,
  commanders: { slug: string; entry: IndexEntry; themes: Theme[] }[],
  input: { oracle_id: string; color_identity: string[] }[],
  opts?: { limit?: number; dcfg?: Config },
): CommanderSuggestion[];
