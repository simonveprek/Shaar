import { requireUser } from "@/lib/auth";
import { CreateJob } from "@/lib/schemas";
import { handle, must, readJson } from "@/lib/http";
import { createJob } from "@/lib/research";
import { db } from "@/lib/supabase";

/** Start a research job: one Apify run per target. Poll GET /api/research/:id for progress. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req, { visitor: "create" });
  const body = await readJson(req, CreateJob);
  const result = await createJob(user.id, body);
  return Response.json(result, { status: 201 });
});

/** List the user's research jobs, newest first. */
export const GET = handle(async (req: Request) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
  const jobs = must(
    await db()
      .from("research_jobs")
      .select("*, personas(id, status, profile->display_name, profile->one_line_summary)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  return Response.json({ jobs });
});
