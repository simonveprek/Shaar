import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { handle, maybe } from "@/lib/http";
import { advanceJob, type RunRow } from "@/lib/research";
import { db } from "@/lib/supabase";

/**
 * Called by Apify when a connector run finishes (registered per run when PUBLIC_API_URL is set).
 * The payload is only used to find the run; its real status is re-read from the Apify API.
 */
export const POST = handle(async (req: NextRequest) => {
  const secret = req.nextUrl.searchParams.get("secret") ?? "";
  const expected = env().APIFY_WEBHOOK_SECRET;
  if (secret.length !== expected.length || !timingSafeEqual(Buffer.from(secret), Buffer.from(expected))) {
    return Response.json({ error: "Invalid secret" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => null)) as { eventData?: { actorRunId?: string } } | null;
  const apifyRunId = payload?.eventData?.actorRunId;
  if (!apifyRunId) return Response.json({ error: "Missing eventData.actorRunId" }, { status: 400 });

  const run = maybe(
    await db().from("connector_runs").select().eq("apify_run_id", apifyRunId).maybeSingle<RunRow>(),
  );
  if (!run) return Response.json({ ok: true, ignored: "unknown run" });

  const { job } = await advanceJob(run.job_id);
  return Response.json({ ok: true, jobStatus: job.status });
});
