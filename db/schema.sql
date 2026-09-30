-- edh-tool Postgres schema (Neon-compatible; needs the pg_trgm extension).
-- The catalog tables are rebuilt from the pipeline JSONL by `python -m pipeline.load_db`;
-- the deck tables are user data and are never touched by the loader.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------------ catalog (read-only)

CREATE TABLE IF NOT EXISTS tag_vocab (
  tag         text PRIMARY KEY,
  category    text NOT NULL,
  definition  text NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  oracle_id          uuid PRIMARY KEY,
  name               text NOT NULL,
  name_norm          text NOT NULL,              -- lower-cased, accents stripped: search + import matching
  mana_cost          text,
  cmc                real NOT NULL DEFAULT 0,
  type_line          text NOT NULL,
  types              text[] NOT NULL DEFAULT '{}',
  supertypes         text[] NOT NULL DEFAULT '{}',
  subtypes           text[] NOT NULL DEFAULT '{}',
  oracle_text        text,
  power              text,
  toughness          text,
  color_identity     text[] NOT NULL DEFAULT '{}',
  ci_mask            smallint NOT NULL DEFAULT 0, -- W=1 U=2 B=4 R=8 G=16; colorless = 0
  produced_mana      text[] NOT NULL DEFAULT '{}', -- for mana-base analytics
  keywords           text[] NOT NULL DEFAULT '{}',
  commander_legal    boolean NOT NULL,
  commander_eligible boolean NOT NULL DEFAULT false,
  edhrec_rank        integer,
  game_changer       boolean NOT NULL DEFAULT false,
  price_usd          numeric(10,2),
  quality            real,                        -- tagger's 0..1 card quality
  image              text,
  image_small        text,
  art_crop           text,
  artist             text,
  scryfall_uri       text
);
CREATE INDEX IF NOT EXISTS cards_name_trgm ON cards USING gin (name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cards_ci_mask ON cards (ci_mask) WHERE commander_legal;

CREATE TABLE IF NOT EXISTS card_tags (
  oracle_id  uuid NOT NULL REFERENCES cards ON DELETE CASCADE,
  tag        text NOT NULL,
  role       text NOT NULL CHECK (role IN ('enabler','payoff','both')),
  strength   real NOT NULL,
  PRIMARY KEY (oracle_id, tag)
);
-- "every card with tag X" (theme pools, tag browsing)
CREATE INDEX IF NOT EXISTS card_tags_by_tag ON card_tags (tag, strength DESC);

-- one row per printing's illustration; vision tags in art_tags
CREATE TABLE IF NOT EXISTS art (
  illustration_id  uuid PRIMARY KEY,
  oracle_id        uuid NOT NULL REFERENCES cards ON DELETE CASCADE,
  face             smallint,
  artist           text,
  set_code         text,
  image            text
);
CREATE INDEX IF NOT EXISTS art_by_card ON art (oracle_id);
-- source-file order: keeps the choice between equally good printings stable
ALTER TABLE art ADD COLUMN IF NOT EXISTS seq integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS art_tags (
  illustration_id uuid PRIMARY KEY REFERENCES art ON DELETE CASCADE,
  mood text[] NOT NULL DEFAULT '{}', setting text[] NOT NULL DEFAULT '{}',
  palette text[] NOT NULL DEFAULT '{}', lighting text[] NOT NULL DEFAULT '{}',
  subject text[] NOT NULL DEFAULT '{}', motifs text[] NOT NULL DEFAULT '{}'
);

-- ------------------------------------------------------------------ commanders (browse + themes)

-- Every commander-eligible card. `themes` is the engine's theme array (jsonb) once generated.
CREATE TABLE IF NOT EXISTS commanders (
  oracle_id     uuid PRIMARY KEY REFERENCES cards ON DELETE CASCADE,
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  ci_mask       smallint NOT NULL,
  tags          text[] NOT NULL DEFAULT '{}',   -- commander's own tags (strength >= 0.5) + theme tags
  themes        jsonb,                          -- NULL until themes are generated
  themes_status text,                           -- ok | partial | needs_regeneration
  rank_ceiling  integer,
  browse_key    integer NOT NULL                -- stable sort for endless scroll (EDHREC rank, unranked last)
);
CREATE INDEX IF NOT EXISTS commanders_browse ON commanders (browse_key, oracle_id);
CREATE INDEX IF NOT EXISTS commanders_ci ON commanders (ci_mask, browse_key, oracle_id);
CREATE INDEX IF NOT EXISTS commanders_tags ON commanders USING gin (tags);

-- ------------------------------------------------------------------ decks (user data, anonymous for now)

-- No accounts yet: whoever holds edit_token can edit; share_slug is the public read link.
-- Only the token's hash is stored. Add an owner_id column when accounts arrive.
CREATE TABLE IF NOT EXISTS decks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_slug      text NOT NULL UNIQUE,
  edit_token_hash text NOT NULL,
  commander_id    uuid REFERENCES cards,
  partner_id      uuid REFERENCES cards,
  name            text NOT NULL DEFAULT 'Untitled deck',
  theme_id        text,                          -- theme the deck was started from, if any
  is_public       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deck_cards (
  deck_id    uuid NOT NULL REFERENCES decks ON DELETE CASCADE,
  oracle_id  uuid NOT NULL REFERENCES cards,
  qty        smallint NOT NULL DEFAULT 1 CHECK (qty > 0),
  zone       text NOT NULL DEFAULT 'main' CHECK (zone IN ('main','maybe','side')),
  PRIMARY KEY (deck_id, oracle_id, zone)
);

-- cheap change history: a snapshot per meaningful save
CREATE TABLE IF NOT EXISTS deck_snapshots (
  id          bigserial PRIMARY KEY,
  deck_id     uuid NOT NULL REFERENCES decks ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  cards       jsonb NOT NULL                     -- [{oracle_id, qty, zone}]
);
CREATE INDEX IF NOT EXISTS deck_snapshots_by_deck ON deck_snapshots (deck_id, created_at DESC);
