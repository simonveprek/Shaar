import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { check, handle, maybe, must } from "@/lib/http";
import { advanceJob, getJob, type PersonaRow } from "@/lib/research";
import { deleteAgent } from "@/lib/elevenlabs";
import { db } from "@/lib/supabase";

/**
 * Job status with its connector runs and persona. Calling this also advances the job
 * (ingests finished Apify runs, checks persona generation), so polling it every few seconds is enough
 * even without webhooks.
 */
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/research/[id]">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await getJob(id, user.id);
  const { job, runs, persona } = await advanceJob(id);

  const counts = must(
    await db().from("scraped_items").select("platform, kind").eq("job_id", id).limit(5000),
  ) as { platform: string; kind: string }[];
  const itemCounts: Record<string, Record<string, number>> = {};
  for (const { platform, kind } of counts) {
    itemCounts[platform] ??= {};
    itemCounts[platform][kind] = (itemCounts[platform][kind] ?? 0) + 1;
  }

  return Response.json({ job, runs, persona, itemCounts });
});

/** Delete a job and everything scraped for it (and the persona's ElevenLabs agent). */
export const DELETE = handle(async (req: NextRequest, ctx: RouteContext<"/api/research/[id]">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await getJob(id, user.id);

  const persona = maybe(await db().from("personas").select().eq("job_id", id).maybeSingle<PersonaRow>());
  if (persona?.elevenlabs_agent_id) {
    await deleteAgent(persona.elevenlabs_agent_id).catch((err) => console.warn("Agent delete failed", err));
  }
  check(await db().from("research_jobs").delete().eq("id", id).eq("user_id", user.id));
  return new Response(null, { status: 204 });
});
