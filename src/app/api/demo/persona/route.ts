import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { seedDemoPersona } from "@/lib/fixtures";
import { handle } from "@/lib/http";

const Body = z.object({ who: z.enum(["mara", "simon"]).default("mara") });

/**
 * A demo subject as a ready persona for the current visitor: Mara Vell (fictional) or Šimon Vepřek (from his
 * public record). Free: no scraping and no AI. Talking to them starts a real ElevenLabs call through
 * POST /api/personas/:id/interviews.
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req, { visitor: "create" });
  const { who } = Body.parse(await req.json().catch(() => ({})));
  return Response.json(await seedDemoPersona(user.id, who));
});
