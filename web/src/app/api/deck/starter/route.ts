import { bad, readBody } from "@/lib/api";
import { getCommander } from "@/lib/data";
import { buildStarter } from "@/lib/starter";

// POST { slug, theme, seed? } → a starter deck (theme cards, staples, 20 lands) for the client to save.
export async function POST(req: Request) {
  const body = await readBody<{ slug?: unknown; theme?: unknown; seed?: unknown }>(req);
  if (!body || typeof body.slug !== "string" || typeof body.theme !== "string") return bad("expected { slug, theme }");
  const data = await getCommander(body.slug);
  if (!data) return bad("unknown commander", 404);
  const seed = typeof body.seed === "string" ? body.seed.slice(0, 64) : String(Math.random());
  const s = await buildStarter(data, body.theme, seed);
  if (!s) return bad("unknown theme", 404);
  return Response.json({ commander: data.commander.oracle_id, themeId: body.theme, ...s });
}
