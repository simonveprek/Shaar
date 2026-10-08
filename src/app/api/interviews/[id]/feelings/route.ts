import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { ReportFeelings } from "@/lib/schemas";
import { handle, readJson } from "@/lib/http";
import { addFeelings, getInterview } from "@/lib/interviews";

/** Stores the candidate's `reportFeeling` client-tool calls, which feed the mood timeline and the feedback. */
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/interviews/[id]/feelings">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const { events } = await readJson(req, ReportFeelings);
  const interview = await addFeelings(await getInterview(id, user.id), events);
  return Response.json({ feelings: interview.feelings });
});
