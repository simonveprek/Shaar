import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { RunConnector } from "@/lib/schemas";
import { handle, must, readJson } from "@/lib/http";
import { getConnector, describeConnector } from "@/connectors";
import { checkTarget, createJob, getJob, startConnector, type JobRow } from "@/lib/research";
import { db } from "@/lib/supabase";

/** Details for one connector. */
export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/connectors/[platform]">) => {
  const { platform } = await ctx.params;
  return Response.json({ connector: describeConnector(getConnector(platform)) });
});

/**
 * Run a single connector. With `jobId` the run is added to that job (the persona is rebuilt when it
 * finishes); without it, a new job is created.
 */
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/connectors/[platform]">) => {
  const user = await requireUser(req);
  const { platform } = await ctx.params;
  getConnector(platform);
  const body = await readJson(req, RunConnector);
  checkTarget({ platform, target: body.target, maxPosts: body.maxPosts });

  if (!body.jobId) {
    const result = await createJob(user.id, {
      subjectName: body.subjectName ?? body.target,
      targets: [{ platform, target: body.target, maxPosts: body.maxPosts }],
    });
    return Response.json(result, { status: 201 });
  }

  const existing = await getJob(body.jobId, user.id);
  // Start the runs before reopening the job. Otherwise a poll in between would see only the old, finished
  // runs, move on to analysis, and never look at the new ones.
  const runs = await startConnector(existing, { platform, target: body.target, maxPosts: body.maxPosts });
  const job = must(
    await db()
      .from("research_jobs")
      .update({ status: "scraping", error: null })
      .eq("id", existing.id)
      .eq("user_id", user.id)
      .select()
      .single<JobRow>(),
  );
  return Response.json({ job, runs }, { status: 201 });
});
