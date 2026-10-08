import { requireUser } from "@/lib/auth";
import { seedCandidates } from "@/lib/fixtures";
import { handle, HttpError } from "@/lib/http";

/*
 * Local testing only (`next dev`): seeds the fictional candidates from fixtures/candidates for the visitor who
 * opens it, so the interview simulator has ready personas without scraping. Open it in the browser once.
 * Safe to repeat: existing fixture personas are updated, not duplicated.
 */
export const GET = handle(async (req: Request) => {
  if (process.env.NODE_ENV === "production") throw new HttpError(404, "Not found");
  const user = await requireUser(req, { visitor: "create" });
  const candidates = await seedCandidates(user.id);
  return Response.json({ candidates });
});
