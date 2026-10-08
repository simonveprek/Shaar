import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, HttpError } from "@/lib/http";
import { startFeedback } from "@/lib/feedback";
import { getInterview, syncInterview } from "@/lib/interviews";

/** Regenerate the candidate's feedback. Poll GET /api/interviews/:id for the result. */
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/interviews/[id]/feedback">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const interview = await syncInterview(await getInterview(id, user.id));
  if (interview.status !== "done") throw new HttpError(409, "The interview has not finished yet");
  return Response.json({ interview: await startFeedback(interview, { force: true }) }, { status: 202 });
});
