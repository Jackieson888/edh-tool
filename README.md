# edh-tool

Theme-driven Commander recommendations that surface hidden gems instead of the same
staples everyone plays. Status: **prototype**. The full pipeline runs end to end on one
commander (Agent Frank Horrigan) and a 220-card tagged test pool.

## How it fits together

```
Scryfall bulk file ──► pipeline/load_scryfall.py ──► data/cards.jsonl  (+ data/meta.json)
                                                        │
             vocab/tags.yaml + pipeline/rules.py ───────┤  regex hints, typal tags
                                                        ▼
             prompts/tag_cards.system.md ─► pipeline/tagging.py ─► data/card_tags.jsonl
                                             (Message Batches API)     per card: tags{role,strength}, quality
                                                        │
      prompts/commander_themes.system.md ─► pipeline/themes.py ─► data/commander_themes.jsonl
                                             validates + viability-checks via the engine
                                                        │
                                                        ▼
                         engine/score.mjs  (pure JS: runs in Node, the browser, and the API)
                         rankTheme → sampleRecs → 5 picks per theme, seeded per deck
```

Offline enrichment is Python and runs once over all cards, then only on new sets.
Runtime scoring is one dependency-free JS module, so the site, the API and the tuning
bench all use exactly the same code.

## First real tagging run (221 test cards)

Run with `python -m pipeline.tagging direct` on `claude-sonnet-5-5`. All 221 cards came
back in 92 seconds with 28 requests. Usage:

| input | output | cache write | cache read |
|---|---|---|---|
| 59k | 77k | 7k | 179k |

That's about ×145 for all 32k cards. A batch job bills at roughly half the direct rate,
but the one batch we tried sat in the queue for an hour without starting.

Compared with the hand-tagged pool (`tools/compare_tags.py`):
- **Power estimates:** correlation 0.83, mean absolute gap 0.07. The model compresses the
  top end (Yawgmoth 0.7 vs 0.9, fetch-ramp spells ~0.55), so add more high anchors to the
  prompt before the full run.
- **Tag coverage:** the model tags more per card (5.5 vs 3.8). Most "disagreements" are
  reasonable extras (landfall on land-search ramp, flash, lands_matter). Mean overlap is
  0.69; shared tags differ by 0.09 in strength.
- **Card mismatch bug (fixed):** once the model put one card's tags on its neighbor
  (Predation Steward → Predator Ooze) because it had to copy back 36-character IDs.
  Requests now use short refs (`c1`–`c8`) plus the card name. Answers are matched on both,
  duplicates are refused, and cards with no accepted answer are retried once.

## Model comparison: Sonnet 5.5 vs Haiku 4.5

Both models tagged the same 221 cards, with the same prompt, Tagger hints and new
quality anchors (none of the anchors are pool cards). Results against the hand tags:

| | tag overlap | quality r | quality MAE | weak cards (hand <= 0.3) | Tagger/rule hints dropped |
|---|---|---|---|---|---|
| **Sonnet 5.5** | 0.69 | **0.85** | **0.07** | rated 0.34 | 5 cards |
| Haiku 4.5 | 0.69 | 0.73 | 0.18 | rated **0.59** | 68 cards |

Haiku finds the same tags about as often, but it inflates weak cards. That defeats the
quality floor and the gem gate, which exist to separate "unpopular because unknown" from
"unpopular because bad". Downstream, Haiku's theme top-10s matched the reference as
little as 1/10 (Showdown at the Oil Rig) and 2/10 (Forced Evolution). Sonnet matched
5–9/10.

**Decision: tag the full set with Sonnet 5.5.** The cost lever is the Batch API (about
half price), not a smaller model. The new anchors also fixed Sonnet's compressed top end:
cards hand-rated 0.75+ now average 0.79 (Yawgmoth 0.82, up from 0.70).

Reproduce with `python tools/compare_models.py data/sample/card_tags.jsonl
data/sample/card_tags.<model>.jsonl ...`

## Slim output (cost cut for the full run)

Output tokens were most of the cost (about $51 of a $65–90 batch estimate). The prompt no
longer asks for a per-tag `why`, `vibes` or `notes`; flavor now comes from the Tagger art
tags. Tags are compact `[tag, role, strength]` triples in minified JSON, one card per
line. Flavor text and empty fields are no longer sent in the request. Hints the model
rejects go in `dropped`, so the recall check still works.

Same 221 cards, same model:

| | output tokens | input tokens | tag overlap vs hand | quality r | flagged |
|---|---|---|---|---|---|
| full output | 70,864 | 64,236 | 0.69 | 0.85 | 5 |
| **slim** | **22,410** | **45,696** | 0.70 | 0.83 | 16 |

Slim vs full: tag overlap 0.90, quality r 0.95. Theme top-10s match the full run about as
closely as two full runs match each other.

**Full-run estimate (32,068 cards, ~4,000 requests, Sonnet 5.5 batch at $1/$5 per
MTok): about $27 if the batch reuses the cached system prompt, $50 if not.** That works
out to about $0.85–1.60 per 1,000 cards. Each `.usage.json` records actual usage.

**Actual, first half of the black/green/colorless run (787 requests, 6,296 cards):
$6.61, or about $1.05 per 1,000 cards.** Prompt caching worked partly: 1.9M cache-write
and 3.5M cache-read tokens. 272 cards (4%) are flagged for review. Twelve requests at
first "failed" because the model wrote an array, spotted its own mistake, and wrote a
corrected array after it; `extract_json` now takes the last complete array. A few answers
used tags outside the vocab (`cheat_into_play`, `typal:Changeling`), which suggests a
"put onto the battlefield" tag for the next vocab version.

**Full black/green/colorless run: 12,580 cards for $12.41** ($6.61 + $5.80, plus a few cents
to re-run 4 cards whose answers didn't match). 523 cards (4%) are flagged. The
counter_doubling regex no longer fires on "enters with an additional +1/+1 counter";
that was the biggest source of false flags.

### Horrigan on the full pool

Themes regenerated against the full black/green supply. The theme model thinks before
answering, so `themes.max_tokens` is now 16000; 3000 truncated the answer. The original
six themes were kept (they include Jackson's own names) plus three new ones whose top tag
doesn't overlap them. Viability on the full pool:

| theme | kind | viable cards |
|---|---|---|
| Spontaneous Infection | core | 74 |
| Forced Evolution | core | 1,159 |
| Enclave Super Soldier (new) | core | 283 |
| Time to Die | stretch | 113 |
| Impure Strain | stretch | 64 |
| Vault of Loyalty (new) | stretch | 107 |
| Wasteland Warband (new) | stretch | 281 |
| Hot Zone | core | 10: rejected |
| Showdown at the Oil Rig | stretch | 10: rejected |

Rad and oil counters only have about 10 decent black/green cards each, so those two
themes are below the 40-card floor.

Known tuning issue: in typal themes (Wasteland Warband), strong cards that are merely
Warriors by type line (Kalitas, Chatterfang, Tenacious Underdog) outrank Warrior payoffs.
Type-line membership probably needs a lower strength, or should need a second matched tag.

## Scryfall Tagger oracle tags (free hints)

`data/raw/oracle-tags.jsonl` has 4,557 community-maintained functional tags covering
99.4% of legal cards. `python -m pipeline.tagger_oracle data/raw/oracle-tags.jsonl` maps
them onto our vocabulary (`vocab/oracle_map.yaml`, with exact labels plus families like
`typal-*`, `tutor-*`, `removal-*`) and writes `data/oracle_hints.jsonl`, giving 80% of
cards at least one hint.

Tagger can't replace the model. Against the API tags it has 0.60 recall and 0.77
precision: it misses one-shot proliferate, rad counters, planeswalkers and ETB value, and
it has no strength or power estimate. So its tags go into each request as
`tagger_hints` (treated as strong evidence), and the validator flags
`missed_tagger:<tag>` when the model drops one without saying why. Without hints, the
first run left out a Tagger-confirmed tag on 74 of 221 cards, mostly shrink and spot
removal.

## Card images and art

**Commander-legal only.** The loader keeps only cards whose `legalities.commander` is
`legal` (EDH = Commander): banned, not-legal, token and un-cards never enter the
dataset. That leaves 32,068 cards.

**Images:** Scryfall's bulk data links images for every printing.
- `cards.jsonl` stores `image`, `image_small`, `art_crop`, `artist` and `illustration_id`
  for each card's representative printing.
- `art.jsonl` has one row per (card, illustration), 48,799 in all, with set, artist and
  image links.

**Art tags come from Scryfall Tagger** (`data/raw/art-tags.jsonl`, 11,606
community-maintained labels). `python -m pipeline.tagger_art data/raw/art-tags.jsonl`
writes `data/art_tags.jsonl`, covering 99.9% of illustrations. For each illustration it
records:

- `motifs`: every Tagger label on the art plus its ancestors ("super mutant" also gives
  "mutant" and "fallout (universe)"). Production and meta labels (signature, painting
  medium, framing) are left out via the stoplist in `vocab/art_map.yaml`.
- `mood / setting / palette / lighting / subject`: our fixed art fields, derived from
  those labels through `vocab/art_map.yaml`. Tagger is strong on what is depicted and
  weak on mood, so coverage is setting 29%, palette 27%, mood 14%.

The vision pass (`pipeline/art_tags.py`, writes `art_tags_vision.jsonl`) is now optional.
Use it to fill mood and palette. `tagger_art` merges its rows in when the file exists.

**Art in themes:** a theme can carry an art direction, and its motifs should be real
Tagger labels. `themes build` gives the model an `art_motif_supply` table: distinctive
labels, each with how many legal cards in the commander's colors carry it. `themes
ingest` drops motifs on fewer than `art_motif_min_cards` (10) cards. Horrigan's "Hot
Zone" lost "radiation" (7 cards) this way. Motifs match whole labels or whole words
("oil" matches "phyrexian oil", not "boiler"), both here and in the engine.

The engine's `artMult` goes up to ×1.35 for the best-matching printing, and is exactly 1.0
when either the theme or the card has no art data. It also returns which printing matched
and which art cues it hit, so the site can show that art. For example, Contagion Engine
shows its Secret Lair printing in Time to Die (skeleton/undead) and its Scars of Mirrodin
printing in the oil theme.

**Image hosting:** `cards.scryfall.io` couldn't be reached from the build environments,
and the tuning bench can't load outside images, so the bench shows the chosen printing's
set, artist and matched cues instead of the art. The live site can hotlink Scryfall images
directly. Keep the artist credit with any `art_crop` (Scryfall's guidelines).

## The scoring model

```
score = fit^a × commanderMult × quality^b × popularityMult × artMult
```

| factor | what it is | knobs (engine/score.mjs `DEFAULT_CONFIG`) |
|---|---|---|
| **fit** | best weighted tag match + `secondaryShare` × the other matches. A card that misses the theme's anchor (top-weight) tag is multiplied by `offAnchorPenalty` | `secondaryShare 0.5`, `offAnchorPenalty 0.55`, `minStrength 0.2`, `roleMismatch 0.5` |
| **commanderMult** | 1 + `weight` × the strongest link between the card's tags and the commander's. A complement (commander enables X, card pays off X) counts fully, a same-side link at 0.35. Generic tags like ramp and draw are ignored | `weight 0.5` |
| **quality** | the tagger's estimate of the card's power in a deck that wants it (0–1). It's what makes "unpopular" different from "bad" | `exponent 1.5`, `floor 0.35` |
| **popularityMult** | `exp(λ·(obscurity − 0.5))`, with `obscurity = log(rank)/log(maxRank)`. λ is the Proven ↔ Deep cuts slider. The upside is gated by quality (`gemGate`), so obscure junk doesn't get lifted | `lambda 2.0`, `gemGate [0.35, 0.7]` |

**Sampling:** take the top `poolSize` (40) and draw 5 cards weighted by `(score/top)^(1/T)`,
with T = 0.5. Two nudges shape the draw: a soft role nudge (pick 1 leans enabler, pick 2
leans payoff) and a repeat penalty for cards with the same tag+type signature. The seed is
`deck|theme|reroll`, so a player's list is stable while they work, a reroll changes it,
and two players with the same commander see different cards.

## What the Horrigan test showed

These are the changes the first run forced. Each one is now covered by a test in
`tests/engine.test.mjs`.

1. **Linear rank made the obscurity boost useless.** A rank-400 card and a rank-4,000 card
   came out 0.48× vs 0.56×, while rank-20,000 filler got 1.27×. Popularity is a power law,
   so obscurity now uses log rank.
2. **Deep cuts floated junk.** The deep-cut bonus is now gated by quality. A q 0.36 card at
   rank 30k gets about 1.0×, while a q 0.75 card at rank 25k gets about 2×.
3. **Generic proliferate cards leaked into every theme.** Proliferate is a secondary tag in
   five of the six themes, so Plaguemaw Beast ranked in all of them. Missing the anchor
   tag now damps a card, and viability counts only anchor matches.
4. **Hard role slots forced one card onto everyone.** "Strong" showed up for 100% of
   players in Hot Zone because it was the only payoff. Slots are now a soft ×4 nudge.
5. **The per-primary-tag repeat penalty backfired.** In an infect theme nearly every card's
   primary tag is infect, so the penalty pushed the few non-infect cards (Vraska) to 80%
   exposure. The penalty now applies to a tag+type signature.

Variety after the fixes, measured over 200 simulated players: each theme shows 21–40
distinct cards, and only 28–53% of picks come from the static top 5.

**Theme viability is real data, not a formality.** Black-green has only 14 rad-counter
cards and 16 oil-counter cards across all 32k. With the production threshold
(`viability_min_cards: 40`), "Hot Zone" and "Showdown at the Oil Rig" would be rejected
and regenerated. The test pool uses `--min-cards 8`.

**Rule hints as a recall check.** 63 of 221 cards got `missed_hint` review flags on the first pass (35 after a review round). Most
are noise from the broad `etb_value` regex. A few were real tagger misses, e.g. Recon
Craft Theta's attack trigger.

## Running it

```bash
pip install pyyaml anthropic pytest       # Python 3.11+
# 1. normalize the Scryfall bulk file (Default Cards or Oracle Cards, .json or .jsonl)
python -m pipeline.load_scryfall data/raw/default-cards.jsonl
# 2. tag every card (needs ANTHROPIC_API_KEY in the environment or edh-tool/.env)
python -m pipeline.tagger_oracle data/raw/oracle-tags.jsonl   # free Tagger hints first
python -m pipeline.tagging build
python -m pipeline.tagging direct                  # immediate, full price — or the batch route:
python -m pipeline.tagging submit
python -m pipeline.tagging collect <batch_id>
# 3. themes for every commander (same build/submit/collect flow; `ingest` for a local file)
python -m pipeline.themes build
# 3b. art tags from Scryfall Tagger (free), then optionally fill mood/palette with vision
python -m pipeline.tagger_art data/raw/art-tags.jsonl
python -m pipeline.art_tags build --scope default      # optional, same build/submit/collect flow
# 4. look at results
node engine/cli.mjs recommend --cards data/cards.jsonl --tags data/card_tags.jsonl \
     --themes data/commander_themes.jsonl --commander "Agent Frank Horrigan" [--top 15]
python tools/build_playground.py   # tuning bench → out/playground.html
# tests
node --test tests/*.test.mjs && python -m pytest tests/
```

**Test-pool note:** no API key was available when this was built, so the
`data/sample/` tags and themes were written by Claude in-session, following the same
prompts and schema, and ingested through the same validator
(`data/sample/claude_tagging_run.py`). The batch submit/collect path is written but
hasn't been run against the live API yet. Run it on ~200 cards and diff the results
against `data/sample/card_tags.jsonl` before paying for all 32k.

## Dataset fields to lock before the 30k run

Re-tagging everything is the expensive step, so each card record already carries:

- `tags[]` with `role` and `strength`
- `quality`
- `review_flags`
- `meta` (model, vocab version, prompt hash)

With the meta fields, a vocab change re-tags only stale cards. Open questions before
scaling:

- **Vocab coverage.** 80 tags (v0.2.0 added `shrink` for temporary -X/-X effects). Some gaps may only show up on other commanders: voting,
  dungeon/initiative, day/night, stickers.
- **Quality calibration.** Tag ~50 anchor cards by hand and check the model against them.
  This number drives the whole gem system.
- **Better popularity.** Global `edhrec_rank` is a proxy. A per-commander or per-color
  inclusion rate would be sharper if a source for it can be found.
- **A "works in any Horrigan build" shelf.** Proliferate enablers fit every theme. Instead
  of damping them, show them once in their own row.

## Web app (web/)

Next.js 16 (App Router, TypeScript, Tailwind 4), meant for Vercel. The repo is an npm
workspace: `engine` (the scoring engine, shared with the pipeline and tuning bench) and
`web` (the site). The site runs `engine/score.mjs` on the server, so a score on the site is
the same score as in the bench.

```
npm install                      # once, at the repo root
python -m pipeline.export_web --tags data/card_tags.jsonl --themes data/commander_themes.jsonl
npm run dev                      # http://localhost:3000
```

`export_web` writes `web/data/commanders/<slug>.json`: one bundle per commander, holding
its themes and every tagged card in its color identity, plus `index.json` and
`vocab.json`. Only display and scoring fields are kept.

Routes:
- `/`: commander list.
- `/commander/[slug]`: the commander and its core and stretch themes (static).
- `/commander/[slug]/[theme]?r=N`: five seeded picks. `r` is the reroll number, so a
  batch of picks is a shareable URL. Add `&debug=1` to see the top-40 candidate pool and
  every score part.

Vercel: set the project's Root Directory to `web`. Vercel detects the workspace and
installs from the repo root. The bundles in `web/data` are read at request time;
`outputFileTracingIncludes` in `next.config.ts` ships them with the server functions,
so they need to be committed or generated during the build.

Later: a full black-green bundle is about 40 MB, mostly printings and art tags. The best
printing for each (card, theme) can be computed at export time instead of shipping every
printing. Saved decks and user accounts will need a database (Vercel Postgres/Neon).

## Layout

```
vocab/tags.yaml            base tag vocabulary (the contract everything else uses)
vocab/art.yaml             allowed art values (mood, setting, palette, lighting, subject)
vocab/art_map.yaml         Scryfall Tagger labels -> those values, plus the motif stoplist
vocab/oracle_map.yaml      Scryfall Tagger oracle (function) labels -> our base tags
prompts/                   system prompts for card tagging and theme generation
config/pipeline.yaml       models, batch sizes, viability thresholds
pipeline/                  load_scryfall · rules · tagging · tagger_oracle · themes · tagger_art · art_tags
engine/score.mjs           scoring + sampling (pure JS)   engine/cli.mjs  CLI wrapper
tools/                     playground builder + template
data/sample/               Horrigan test pool, its tags/themes, model-output fixtures
tests/                     node:test engine tests, pytest pipeline tests
```

Card data from [Scryfall](https://scryfall.com). Magic: The Gathering is © Wizards of the
Coast; this is unofficial Fan Content permitted under the Fan Content Policy.

## Database (Postgres / Neon)

`db/schema.sql` defines the catalog (`cards`, `card_tags`, `art`, `art_tags`, `tag_vocab`), the
`commanders` browse table (color-identity bitmask W=1 U=2 B=4 R=8 G=16, a `tags` array with a GIN
index, keyset-pagination key) and anonymous deck tables (`decks`, `deck_cards`, `deck_snapshots`).
`DATABASE_URL=... python -m pipeline.load_db` applies the schema and refreshes the catalog (about
10 s for all 32k cards); it never touches the deck tables. Browse filters: within a color identity
`(ci_mask & ~filter) = 0`, exactly `ci_mask = filter`, tag `tags @> ARRAY['x']`, next page
`(browse_key, oracle_id) > (last_key, last_id)`.
