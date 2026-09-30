import { DEFAULT_CONFIG } from "@edh-tool/engine";
import { activeThemeIds, deckRecommendations, deckThemeProfile } from "@edh-tool/engine/deck";
import { bad, isId, readBody } from "@/lib/api";
import { getCommanderByOracle, withDeckCards } from "@/lib/data";
import type { AnalyzeRequest, AnalyzeResponse } from "@/lib/types";

const GEM_OBSCURITY = 0.82;   // same bar as the theme page's "Hidden gem" badge

// POST AnalyzeRequest → theme profile of the deck + recommendations for the active theme(s).
export async function POST(req: Request) {
  const body = await readBody<AnalyzeRequest>(req);
  if (!body || !isId(body.commander) || !Array.isArray(body.cards) || body.cards.length > 400) {
    return bad("expected { commander, cards, theme, seed }");
  }
  const base = await getCommanderByOracle(body.commander);
  if (!base) return bad("no themes for that commander yet", 404);
  const mainIds = body.cards.filter((c) => c?.board === "main" && isId(c.oracle_id)).map((c) => c.oracle_id);
  const maybeIds = body.cards.filter((c) => c?.board === "maybe" && isId(c.oracle_id)).map((c) => c.oracle_id);
  const data = await withDeckCards(base, [...mainIds, ...maybeIds]); // deck cards outside the slim pool still count as analyzed
  const mode = body.theme?.mode === "pinned" ? "pinned" : "auto";
  const pinned = Array.isArray(body.theme?.pinned) ? body.theme.pinned.filter((x) => typeof x === "string") : [];

  const profile = deckThemeProfile(data.index, data.entry, data.themes, mainIds);
  const inferred = activeThemeIds(profile, data.themes)[0] ?? null;
  const active = activeThemeIds(profile, data.themes, { mode, pinned });
  const seed = `${String(body.seed ?? "deck").slice(0, 64)}|${Number(body.reroll) || 0}`;
  const byId = new Map(profile.themes.map((t) => [t.themeId, t]));
  const best = new Map<string, { fit: number; name: string }>();
  for (const row of profile.themes) {
    const name = data.themes.find((t) => t.id === row.themeId)?.name ?? row.themeId;
    for (const c of row.cards) if ((best.get(c.oracle_id)?.fit ?? 0) < c.fit) best.set(c.oracle_id, { fit: c.fit, name });
  }

  const res: AnalyzeResponse = {
    commander: { oracle_id: data.commander.oracle_id, name: data.commander.name, slug: data.slug,
      color_identity: data.commander.color_identity },
    themes: data.themes.map((t) => ({
      id: t.id, name: t.name, pitch: t.pitch, kind: t.kind, tags: t.tags.map((x) => x.tag),
      count: byId.get(t.id)?.count ?? 0, share: byId.get(t.id)?.share ?? 0,
    })).sort((a, b) => (byId.get(b.id)?.fitSum ?? 0) - (byId.get(a.id)?.fitSum ?? 0)),
    analyzed: profile.analyzed,
    notAnalyzed: profile.notAnalyzed,
    offColor: profile.offColor,
    active,
    inferred,
    cardThemes: Object.fromEntries([...best].map(([id, b]) => [id, b.name])),
    recs: active.map((id) => {
      const theme = data.themes.find((t) => t.id === id)!;
      const { picks, eligible } = deckRecommendations(data.index, data.entry, theme, mainIds, DEFAULT_CONFIG,
        { seed, maybeIds, k: active.length > 1 ? 6 : 10 });
      return {
        themeId: id,
        eligible,
        picks: picks.map((p) => {
          const card = data.index.get(p.oracle_id)!.card;
          return {
            oracle_id: p.oracle_id, name: p.name,
            image: p.parts.illustration?.image ?? card.image ?? undefined,
            gem: p.parts.obscurity >= GEM_OBSCURITY,
            inMaybe: p.deck.inMaybe,
            matched: p.parts.matched.filter((m) => m.contrib > 0).map((m) => ({ tag: m.tag, anchor: m.anchor, role: m.role })),
            shared: p.deck.shared,
            edhrec_rank: card.edhrec_rank, price_usd: card.price_usd,
          };
        }),
      };
    }),
  };
  return Response.json(res);
}
