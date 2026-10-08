import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle } from "@/lib/http";
import { getJob } from "@/lib/research";

/**
 * Scraped items for the frontend: GET /api/research/:id/items?platform=instagram&kind=post&limit=50&offset=0
 * Add `raw=1` to include the original Apify item.
 */
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/research/[id]/items">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await getJob(id, user.id);

  const params = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(params.get("offset") ?? 0) || 0, 0);
  const columns = "id, platform, kind, external_id, url, author, text, posted_at, metrics, media" + (params.get("raw") ? ", data" : "");

  // Optional filters are passed as null and skipped in SQL, so the query text never depends on input.
  const where = "job_id = $1 and ($2::text is null or platform = $2) and ($3::text is null or kind = $3)";
  const filters = [id, params.get("platform"), params.get("kind")];
  const [items, [{ total }]] = await Promise.all([
    sql(`select ${columns} from scraped_items where ${where} order by posted_at desc nulls last limit $4 offset $5`, [
      ...filters,
      limit,
      offset,
    ]),
    sql<{ total: number }>(`select count(*)::int as total from scraped_items where ${where}`, filters),
  ]);
  return Response.json({ items, total, limit, offset });
});
