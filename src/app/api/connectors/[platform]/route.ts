import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { RunConnector } from "@/lib/schemas";
import { one } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { getConnector, describeConnector } from "@/connectors";
import { createJob, getJob, startConnector, type JobRow } from "@/lib/research";

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
  const user = await requireUser(req, { visitor: "create" });
  const { platform } = await ctx.params;
  getConnector(platform);
  const body = await readJson(req, RunConnector);

  if (!body.jobId) {
    const result = await createJob(user.id, {
      subjectName: body.subjectName ?? body.target,
      targets: [{ platform, target: body.target, maxPosts: body.maxPosts }],
    });
    return Response.json(result, { status: 201 });
  }

  await getJob(body.jobId, user.id);
  const job = await one<JobRow>(
    "update research_jobs set status = 'scraping', error = null, updated_at = now() where id = $1 returning *",
    [body.jobId],
  );
  const runs = await startConnector(job, { platform, target: body.target, maxPosts: body.maxPosts });
  return Response.json({ job, runs }, { status: 201 });
});
