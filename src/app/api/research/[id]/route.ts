import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { check, handle, maybe } from "@/lib/http";
import { advanceJob, countItems, getJob, type PersonaRow } from "@/lib/research";
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

  return Response.json({ job, runs, persona, itemCounts: await countItems(id) });
});

/** Delete a job and everything scraped for it (and the persona's ElevenLabs agent). */
export const DELETE = handle(async (req: NextRequest, ctx: RouteContext<"/api/research/[id]">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await getJob(id, user.id);

  const persona = maybe(await db().from("personas").select().eq("job_id", id).maybeSingle<PersonaRow>());
  // Delete the data first. If that fails the agent is still needed; a leftover agent is only clutter.
  check(await db().from("research_jobs").delete().eq("id", id).eq("user_id", user.id));
  if (persona?.elevenlabs_agent_id) {
    await deleteAgent(persona.elevenlabs_agent_id).catch((err) => console.warn("Agent delete failed", err));
  }
  return new Response(null, { status: 204 });
});
