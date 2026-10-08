import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, maybe, notFound } from "@/lib/http";
import { syncInterview, type InterviewRow } from "@/lib/interviews";
import { db } from "@/lib/supabase";

/** Interview with its transcript. Fetches the transcript from ElevenLabs if the webhook hasn't arrived yet. */
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/interviews/[id]">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const interview = maybe(
    await db().from("interviews").select().eq("id", id).eq("user_id", user.id).maybeSingle<InterviewRow>(),
  );
  if (!interview) throw notFound("Interview");
  return Response.json({ interview: await syncInterview(interview) });
});
