import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, must } from "@/lib/http";
import { getJob } from "@/lib/research";
import { db } from "@/lib/supabase";

/**
 * Scraped items for the frontend: GET /api/research/:id/items?platform=instagram&kind=post&limit=50&offset=0
 * Add `raw=1` to include the original Apify item.
 */
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/research/[id]/items">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await getJob(id, user.id);

  const params = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50), 1), 200);
  const offset = Math.max(Number(params.get("offset") ?? 0), 0);
  const columns = "id, platform, kind, external_id, url, author, text, posted_at, metrics, media" + (params.get("raw") ? ", data" : "");

  let query = db()
    .from("scraped_items")
    .select(columns, { count: "exact" })
    .eq("job_id", id)
    .order("posted_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);
  const platform = params.get("platform");
  const kind = params.get("kind");
  if (platform) query = query.eq("platform", platform);
  if (kind) query = query.eq("kind", kind);

  const result = await query;
  const items = must(result);
  return Response.json({ items, total: result.count ?? 0, limit, offset });
});
