import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { buildDossier, type DossierItem } from "@/lib/dossier";
import { handle, maybe, must } from "@/lib/http";
import { advanceJob, getJob, type PersonaRow } from "@/lib/research";
import { db } from "@/lib/supabase";

/** The watcher's file for a research job: exposure, routine, presence, circle and their own words. */
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/research/[id]/dossier">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const job = await getJob(id, user.id);
  await advanceJob(id);

  const items = must(
    await db()
      .from("scraped_items")
      .select("platform, kind, author, text, posted_at, url, metrics")
      .eq("job_id", id)
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(3000)
      .returns<DossierItem[]>(),
  );
  const persona = maybe(await db().from("personas").select().eq("job_id", id).maybeSingle<PersonaRow>());

  const dossier = buildDossier({
    jobId: job.id,
    subjectName: job.subject_name,
    items,
    persona: persona?.status === "ready" ? persona.profile : null,
    now: new Date(),
  });
  return Response.json({ dossier, jobStatus: job.status });
});
