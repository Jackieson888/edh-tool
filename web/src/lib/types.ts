// Shapes shared by the server (API routes) and the browser (deck builder).

export interface CardLite {
  oracle_id: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  color_identity: string[];
  image?: string;
  art_crop?: string;      // wide art for list headers
  commander_eligible?: boolean;
  game_changer?: boolean;
  any_number?: boolean;   // "A deck can have any number of cards named …"
  tagged?: boolean;       // in the scoring pool (black/green/colorless during testing)
}

export type Board = "main" | "maybe";

export interface DeckCard {
  oracle_id: string;
  qty: number;
  board: Board;
  printing?: string;      // raw "(SET) 123" from an import, written back out on export
}

export interface ThemeState {
  mode: "auto" | "pinned";
  pinned: string[];
}

export interface Deck {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  commanders: string[];   // oracle ids; empty until chosen
  cards: DeckCard[];
  theme: ThemeState;
}

export interface CommanderSuggestionLite {
  slug: string;
  oracle_id: string;
  name: string;
  score: number;
  theme: { id: string; name: string; count: number; tags: string[] } | null;
  synergyTags: string[];
  color_identity: string[];
  image?: string;
}

export interface AnalyzeRequest {
  commander: string;
  cards: DeckCard[];
  theme: ThemeState;
  seed: string;
  reroll?: number;
}

export interface RecCard {
  oracle_id: string;
  name: string;
  image?: string;
  gem: boolean;
  inMaybe: boolean;
  matched: { tag: string; anchor: boolean; role: string }[];
  shared: { tag: string; deckCards: number }[];
  edhrec_rank?: number | null;
  price_usd?: string | number | null;
}

export interface AnalyzeResponse {
  commander: { oracle_id: string; name: string; slug: string; color_identity: string[] };
  themes: { id: string; name: string; pitch: string; kind: string; tags: string[]; count: number; share: number }[];
  analyzed: number;
  notAnalyzed: string[];
  offColor: string[];
  active: string[];
  inferred: string | null;
  recs: { themeId: string; eligible: number; picks: RecCard[] }[];
  cardThemes: Record<string, string>;   // oracle_id → name of the theme that card fits best
}

export interface CutsRequest {
  commander: string;
  cards: { oracle_id: string; qty: number; board: Board }[];
  theme: ThemeState;
}

export interface CutsResponse {
  total: number;                // cards in the main board besides the commander
  limit: number;                // 99
  over: number;
  themes: string[];             // names of the themes the deck is going for
  flagged: number;
  overfullRoles: { id: string; label: string; count: number; max: number }[];
  shortRoles: { id: string; label: string; count: number; min: number }[];
  cuts: (import("@edh-tool/engine/cuts").CutCandidate & { image?: string })[];
}
