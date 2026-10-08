import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getDiscovery, syncDiscovery } from "@/lib/discovery";
import { handle } from "@/lib/http";

/** The search's status and, once ready, the candidate profiles to confirm. Each call moves the search forward. */
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/discover/[id]">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const discovery = await syncDiscovery(await getDiscovery(id, user.id));
  return Response.json({ discovery });
});
