import { requireUser } from "@/lib/auth";
import { seedDemoPersona } from "@/lib/fixtures";
import { handle } from "@/lib/http";

/**
 * The demo's fictional subject, Mara Vell, as a ready persona for the current visitor. Free: no scraping and no
 * AI. Talking to her starts a real ElevenLabs call through POST /api/personas/:id/interviews.
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req, { visitor: "create" });
  return Response.json(await seedDemoPersona(user.id));
});
