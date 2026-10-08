import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getPersona } from "@/lib/interviews";

export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/personas/[id]">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  return Response.json({ persona: await getPersona(id, user.id) });
});
