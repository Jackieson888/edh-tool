import type { NextRequest } from "next/server";
import { browse } from "@/lib/browse";

// The catalog only changes when the pipeline loader runs, so let the CDN hold responses for an hour.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const res = await browse({
    colors: sp.get("colors") ?? "",
    mode: sp.get("mode") === "exact" ? "exact" : "within",
    tag: sp.get("tag") ?? undefined,
    q: sp.get("q") ?? undefined,
    themed: sp.get("themed") === "1",
    after: sp.get("after") ?? undefined,
  });
  return Response.json(res, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
