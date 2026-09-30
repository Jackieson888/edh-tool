// Verifies slim bundles rank identically to full ones: node tools/check_slim.mjs <fullDir> <slimDir>
import fs from "node:fs";
import { buildIndex, rankTheme, DEFAULT_CONFIG } from "../engine/score.mjs";
const [fullDir, slimDir] = process.argv.slice(2);
const load = (dir, f) => {
  const b = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
  const index = buildIndex(b.cards, b.tags, { rankCeiling: b.rankCeiling, art: b.art, artTags: b.artTags });
  return { b, index, cmd: index.get(b.commander.oracle_id) };
};
let bad = 0;
for (const f of fs.readdirSync(slimDir).filter((x) => x.endsWith(".json") && x !== "index.json")) {
  const A = load(fullDir, f), B = load(slimDir, f);
  for (const t of A.b.themes) {
    const ra = rankTheme(A.index, A.cmd, t, DEFAULT_CONFIG).slice(0, 100);
    const rb = rankTheme(B.index, B.cmd, t, DEFAULT_CONFIG).slice(0, 100);
    const same = ra.length === rb.length && ra.every((x, i) => x.oracle_id === rb[i].oracle_id && Math.abs(x.score - rb[i].score) < 1e-9);
    if (!same) { bad++; console.log("DIFF", f, t.name, ra.length, rb.length); }
  }
  console.log("checked", f);
}
console.log(bad ? `${bad} themes differ` : "all identical");
