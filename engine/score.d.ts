// Type declarations for score.mjs (the engine stays plain JS so the Python pipeline,
// the tuning bench and the Next.js site all run the exact same code).

export type Role = "enabler" | "payoff" | "both";

export interface Card {
  oracle_id: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line: string;
  types: string[];
  supertypes: string[];
  subtypes?: string[];
  oracle_text?: string;
  power?: string | null;
  toughness?: string | null;
  color_identity: string[];
  commander_legal: boolean;
  commander_eligible?: boolean;
  edhrec_rank?: number | null;
  game_changer?: boolean;
  price_usd?: number | null;
  image?: string | null;
  image_small?: string | null;
  art_crop?: string | null;
  artist?: string | null;
  scryfall_uri?: string;
}

export interface CardTag {
  tag: string;
  role: Role;
  strength: number;
  source?: "llm" | "rule";
}

export interface CardTagsRow {
  oracle_id: string;
  name: string;
  tags: CardTag[];
  quality: number | null;
  review_flags?: string[];
}

export interface ArtRow {
  illustration_id: string;
  oracle_id: string;
  face?: number;
  artist?: string;
  set?: string;
  art_crop?: string;
  image?: string;
}

export interface ArtTagsRow {
  illustration_id: string;
  mood?: string[];
  setting?: string[];
  palette?: string[];
  lighting?: string[];
  subject?: string[];
  motifs?: string[];
}

export interface ThemeTag {
  tag: string;
  weight: number;
  role_focus?: "any" | "enabler" | "payoff";
}

export interface Theme {
  id: string;
  name: string;
  pitch: string;
  kind: "core" | "stretch";
  tags: ThemeTag[];
  art?: Partial<Record<"mood" | "setting" | "palette" | "lighting" | "subject" | "motifs", string[]>>;
  viable_cards?: number;
  status?: string;
}

export interface IndexEntry {
  card: Card;
  tags: Map<string, CardTag>;
  quality: number | null;
  rank?: number | null;
  rankCeiling: number;
  art: (ArtRow & { tags: ArtTagsRow })[];
}

export type Index = Map<string, IndexEntry>;

export interface MatchedTag {
  tag: string;
  weight: number;
  strength: number;
  role: Role;
  roleOk: boolean;
  anchor: boolean;
  contrib: number;
}

export interface ScoredCard {
  oracle_id: string;
  name: string;
  type_line: string;
  score: number;
  poolRank?: number;
  parts: {
    fit: number;
    matched: MatchedTag[];
    offAnchor: boolean;
    primary: string | null;
    primaryRole: Role | null;
    commanderMult: number;
    commanderLinks: unknown[];
    quality: number;
    obscurity: number;
    popularityMult: number;
    artMult: number;
    artMatch: number | null;
    artHits: string[];
    illustration: { illustration_id: string; image?: string; art_crop?: string; artist?: string; set?: string } | null;
    edhrec_rank?: number | null;
  };
}

// Config is a nested object of numbers; see DEFAULT_CONFIG in score.mjs for the knobs.
export type Config = Record<string, any>;
export const DEFAULT_CONFIG: Config;
export function mergeConfig(base: Config, over?: Config): Config;

export function buildIndex(
  cards: Card[],
  cardTags: CardTagsRow[],
  opts?: { rankCeiling?: number; art?: ArtRow[]; artTags?: ArtTagsRow[] },
): Index;
export function findByName(index: Index, name: string): IndexEntry | null;
export function isLegalFor(entry: IndexEntry, commander: IndexEntry): boolean;
export function rankTheme(index: Index, commander: IndexEntry, theme: Theme, cfg?: Config,
  opts?: { exclude?: Set<string> }): ScoredCard[];
export function viability(index: Index, commander: IndexEntry, theme: Theme,
  opts?: { minFit?: number; minQuality?: number }): number;
export function sampleRecs(ranked: ScoredCard[], cfg?: Config, opts?: { seed?: string; k?: number }): ScoredCard[];
export function recommend(index: Index, commander: IndexEntry, theme: Theme, cfg?: Config,
  opts?: { deckSeed?: string; reroll?: number; exclude?: Set<string> }):
  { picks: ScoredCard[]; poolSize: number; eligible: number };

// ---------------------------------------------------------------- deck.mjs

export interface DeckThemeRow {
  themeId: string;
  count: number;
  fitSum: number;
  share: number;
  cards: { oracle_id: string; fit: number }[];
}
export interface DeckProfile {
  themes: DeckThemeRow[];
  analyzed: number;
  notAnalyzed: string[];
  offColor: string[];
}
export interface ThemeState {
  mode: "auto" | "pinned";
  pinned: string[];
}
export interface DeckPick extends ScoredCard {
  deck: { mult: number; shared: { tag: string; deckCards: number }[]; inMaybe: boolean };
}
export interface CommanderSuggestion {
  slug: string;
  oracle_id: string;
  name: string;
  score: number;
  theme: { id: string; name: string; count: number; tags: string[] } | null;
  synergyTags: string[];
  scored: number;
}
