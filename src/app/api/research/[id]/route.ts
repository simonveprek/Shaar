import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { deleteAgent } from "@/lib/elevenlabs";
import { handle } from "@/lib/http";
import { advanceJob, getJob, loadPersona } from "@/lib/research";

/**
 * Job status with its connector runs and persona. Calling this also advances the job
 * (ingests finished Apify runs, checks persona generation), so polling it every few seconds is enough.
 */
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/research/[id]">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await getJob(id, user.id);
  const { job, runs, persona } = await advanceJob(id);

  const counts = await sql<{ platform: string; kind: string; n: number }>(
    "select platform, kind, count(*)::int as n from scraped_items where job_id = $1 group by platform, kind",
    [id],
  );
  const itemCounts: Record<string, Record<string, number>> = {};
  for (const { platform, kind, n } of counts) {
    itemCounts[platform] ??= {};
    itemCounts[platform][kind] = n;
  }

  return Response.json({ job, runs, persona, itemCounts });
});

/** Delete a job and everything scraped for it (and the persona's ElevenLabs agent). */
export const DELETE = handle(async (req: NextRequest, ctx: RouteContext<"/api/research/[id]">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await getJob(id, user.id);

  const persona = await loadPersona(id);
  if (persona?.elevenlabs_agent_id) {
    await deleteAgent(persona.elevenlabs_agent_id).catch((err) => console.warn("Agent delete failed", err));
  }
  await sql("delete from research_jobs where id = $1 and user_id = $2", [id, user.id]);
  return new Response(null, { status: 204 });
});
