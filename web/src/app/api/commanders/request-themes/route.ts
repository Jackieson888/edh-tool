import { bad, isId, readBody } from "@/lib/api";
import { db } from "@/lib/db";

// POST { oracle_id, client_id } → records one request for themes on a commander that has none yet.
// Each browser (client_id, a random uuid kept in localStorage) counts once per commander, so
// request_count is a number of distinct requesters, not clicks.
export async function POST(req: Request) {
  const body = await readBody<{ oracle_id?: unknown; client_id?: unknown }>(req, 2_000);
  if (!body || !isId(body.oracle_id) || !isId(body.client_id)) return bad("expected { oracle_id, client_id }");

  const client = await db().connect();
  try {
    const c = await client.query(
      `SELECT themes IS NULL OR jsonb_array_length(themes) = 0 AS pending FROM commanders WHERE oracle_id = $1`,
      [body.oracle_id]);
    if (!c.rowCount) return bad("unknown commander", 404);
    if (!c.rows[0].pending) return Response.json({ ok: true, alreadyHasThemes: true });

    await client.query("BEGIN");
    const v = await client.query(
      `INSERT INTO theme_request_votes (oracle_id, voter_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [body.oracle_id, body.client_id]);
    if (v.rowCount) {
      await client.query(
        `INSERT INTO theme_requests (oracle_id, request_count) VALUES ($1, 1)
         ON CONFLICT (oracle_id) DO UPDATE
           SET request_count = theme_requests.request_count + 1, last_requested_at = now()`,
        [body.oracle_id]);
    }
    await client.query("COMMIT");
    return Response.json({ ok: true, counted: (v.rowCount ?? 0) > 0 });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("request-themes failed", e);
    return bad("couldn't save your request", 500);
  } finally {
    client.release();
  }
}
