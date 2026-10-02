import { activeThemeIds, deckThemeProfile } from "@edh-tool/engine/deck";
import { suggestCuts } from "@edh-tool/engine/cuts";
import { bad, isId, readBody } from "@/lib/api";
import { getCommanderByOracle, hydrate, withDeckCards } from "@/lib/data";
import type { CutsRequest, CutsResponse } from "@/lib/types";

// POST { commander, cards: [{ oracle_id, qty, board }], theme } → the weakest cards in the main
// board and why: off-theme, redundant in a role or tag the deck already covers, too expensive, weak.
export async function POST(req: Request) {
  const body = await readBody<CutsRequest>(req);
  if (!body || !isId(body.commander) || !Array.isArray(body.cards) || body.cards.length > 400
    || !body.cards.every((c) => isId(c?.oracle_id) && Number.isInteger(c.qty) && c.qty > 0 && c.qty < 500)) {
    return bad("expected { commander, cards: { oracle_id, qty, board }[], theme }");
  }
  const base = await getCommanderByOracle(body.commander);
  if (!base) return bad("no themes for that commander yet", 404);
  const main = body.cards.filter((c) => c.board === "main");
  const mainIds = main.map((c) => c.oracle_id);
  const data = await withDeckCards(base, mainIds);
  const mode = body.theme?.mode === "pinned" ? "pinned" : "auto";
  const pinned = Array.isArray(body.theme?.pinned) ? body.theme.pinned.filter((x) => typeof x === "string") : [];
  const profile = deckThemeProfile(data.index, data.entry, data.themes, mainIds);
  const active = activeThemeIds(profile, data.themes, { mode, pinned });

  // The 99: everything in the main board except the commander itself.
  const total = main.filter((c) => c.oracle_id !== data.commander.oracle_id).reduce((a, c) => a + c.qty, 0);
  const limit = 99;
  const res = suggestCuts(data.index, data.entry, data.themes, main.map((c) => ({ oracle_id: c.oracle_id, qty: c.qty })),
    { activeIds: active, over: Math.max(0, total - limit) });
  const themeNames = active.map((id) => data.themes.find((t) => t.id === id)?.name).filter((x): x is string => !!x);
  const imgs = await hydrate(res.cuts.map((c) => c.oracle_id));
  const out: CutsResponse = {
    ...res,
    total, limit,
    themes: themeNames,
    cuts: res.cuts.map((c) => ({ ...c, image: imgs.get(c.oracle_id)?.image })),
  };
  return Response.json(out);
}
