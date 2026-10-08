import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, HttpError } from "@/lib/http";
import { generatePersona, getJob } from "@/lib/research";

/** Regenerate the persona from the job's current scraped data (e.g. after adding a connector). */
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/research/[id]/persona">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const job = await getJob(id, user.id);
  if (job.status === "scraping") throw new HttpError(409, "Wait for scraping to finish first");

  const persona = await generatePersona(job);
  await sql("update research_jobs set status = 'analyzing', error = null, updated_at = now() where id = $1", [id]);
  return Response.json({ persona }, { status: 202 });
});
