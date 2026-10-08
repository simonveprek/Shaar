import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { advanceFeedback } from "@/lib/feedback";
import { getInterview, syncInterview } from "@/lib/interviews";

/**
 * Interview with its transcript and candidate feedback. Fetches the transcript from ElevenLabs if the webhook
 * hasn't arrived yet, and moves feedback generation forward, so poll it until `feedback_status` is final.
 */
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/interviews/[id]">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const interview = await getInterview(id, user.id);
  return Response.json({ interview: await advanceFeedback(await syncInterview(interview)) });
});
