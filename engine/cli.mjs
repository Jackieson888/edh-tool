#!/usr/bin/env node
// CLI around the engine, used by the Python pipeline and for eyeballing results.
//
//   node engine/cli.mjs viability --cards C --tags T --themes TH.json --commander NAME
//   node engine/cli.mjs viability-many --cards C --tags T --input IN.json
//        IN = [{oracle_id, themes: [...]}, ...]  →  {oracle_id: {theme_id: n}}; one index load
//        for a whole batch of commanders instead of one Node process per commander
//   node engine/cli.mjs recommend --cards C --tags T --themes CT.jsonl --commander NAME
//        [--theme ID] [--seed S] [--reroll N] [--lambda L] [--config over.json] [--top N]
//        [--art data/art.jsonl --art-tags data/art_tags.jsonl]
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_CONFIG, buildIndex, findByName, mergeConfig, rankTheme, recommend, viability,
} from "./score.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const readJsonl = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const readAny = (p) => (p.endsWith(".jsonl") ? readJsonl(p) : JSON.parse(readFileSync(p, "utf8")));

const cardsPath = opt("cards");
const cards = readJsonl(cardsPath);
const tags = readJsonl(opt("tags"));
// rank ceiling from the full dataset's meta.json so a small pool scores like the real thing
let rankCeiling = opt("rank-ceiling") ? Number(opt("rank-ceiling")) : undefined;
for (const m of [join(dirname(cardsPath), "meta.json"), join(dirname(cardsPath), "..", "meta.json")]) {
  if (rankCeiling == null && existsSync(m)) rankCeiling = JSON.parse(readFileSync(m, "utf8")).max_edhrec_rank;
}
const art = opt("art") ? readJsonl(opt("art")) : [];
const artTags = opt("art-tags") && existsSync(opt("art-tags")) ? readJsonl(opt("art-tags")) : [];
const index = buildIndex(cards, tags, { rankCeiling, art, artTags });
const getCommander = () => {
  const c = findByName(index, opt("commander"));
  if (!c) throw new Error(`commander not found in tagged cards: ${opt("commander")}`);
  return c;
};

let cfg = DEFAULT_CONFIG;
if (opt("config")) cfg = mergeConfig(cfg, JSON.parse(readFileSync(opt("config"), "utf8")));
if (opt("lambda") != null) cfg = mergeConfig(cfg, { popularity: { lambda: Number(opt("lambda")) } });

const viaOpts = () => ({ minFit: Number(opt("min-fit", 0.35)), minQuality: Number(opt("min-quality", 0.35)) });

if (cmd === "viability-many") {
  const out = {};
  for (const row of readAny(opt("input"))) {
    const commander = index.get(row.oracle_id);
    out[row.oracle_id] = commander
      ? Object.fromEntries(row.themes.map((th) => [th.id, viability(index, commander, th, viaOpts())]))
      : null;
  }
  process.stdout.write(JSON.stringify(out));
} else if (cmd === "viability") {
  const commander = getCommander();
  const themes = readAny(opt("themes"));
  const out = {};
  for (const th of themes) {
    out[th.id] = viability(index, commander, th, {
      minFit: Number(opt("min-fit", 0.35)), minQuality: Number(opt("min-quality", 0.35)),
    });
  }
  process.stdout.write(JSON.stringify(out));
} else if (cmd === "recommend") {
  const commander = getCommander();
  const row = readAny(opt("themes")).find((r) => r.oracle_id === commander.card.oracle_id);
  const themes = row.themes.filter((t) => !opt("theme") || t.id === opt("theme"));
  const top = Number(opt("top", 0));
  for (const th of themes) {
    console.log(`\n=== ${th.name} [${th.kind}] — ${th.pitch}`);
    console.log(`    ${th.tags.map((t) => `${t.tag}×${t.weight}${t.role_focus && t.role_focus !== "any" ? `(${t.role_focus})` : ""}`).join("  ")}`);
    if (top) {
      rankTheme(index, commander, th, cfg).slice(0, top).forEach((r, i) => {
        const p = r.parts;
        console.log(`${String(i + 1).padStart(3)}. ${r.name.padEnd(34)} score ${r.score.toFixed(3)}  fit ${p.fit.toFixed(2)}  cmd×${p.commanderMult.toFixed(2)}  q ${p.quality.toFixed(2)}  pop×${p.popularityMult.toFixed(2)} (rank ${p.edhrec_rank})${p.artMatch != null ? `  art×${p.artMult.toFixed(2)} [${p.illustration.set}]` : ""}  [${p.matched.map((m) => m.tag).join(",")}]`);
      });
    } else {
      const { picks, poolSize, eligible } = recommend(index, commander, th, cfg, {
        deckSeed: opt("seed", "demo"), reroll: Number(opt("reroll", 0)),
      });
      console.log(`    ${eligible} eligible, sampling from top ${poolSize}`);
      for (const r of picks) {
        console.log(`  - ${r.name.padEnd(34)} #${String(r.poolRank).padStart(2)} in pool  (${r.parts.primary}/${r.parts.primaryRole}, rank ${r.parts.edhrec_rank})`);
      }
    }
  }
} else {
  console.error("usage: cli.mjs viability|viability-many|recommend ...");
  process.exit(1);
}
