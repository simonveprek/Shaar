import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { createJob } from "@/lib/research";
import { CreateJob } from "@/lib/schemas";

/** Start a research job: one Apify run per target. Poll GET /api/research/:id for progress. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req, { visitor: "create" });
  const body = await readJson(req, CreateJob);
  const result = await createJob(user.id, body);
  return Response.json(result, { status: 201 });
});

/** List the visitor's research jobs, newest first, each with its persona's name and summary. */
export const GET = handle(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 100);
  const jobs = await sql(
    `select j.*,
       case when p.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
         'id', p.id, 'status', p.status,
         'display_name', p.profile->'display_name', 'one_line_summary', p.profile->'one_line_summary')) end as personas
     from research_jobs j left join personas p on p.job_id = j.id
     where j.user_id = $1 order by j.created_at desc limit $2`,
    [user.id, limit],
  );
  return Response.json({ jobs });
});
