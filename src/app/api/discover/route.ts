import { requireUser } from "@/lib/auth";
import { startDiscovery } from "@/lib/discovery";
import { handle, readJson } from "@/lib/http";
import { StartDiscovery } from "@/lib/schemas";

/** Start looking for a name's public profiles. Poll GET /api/discover/:id for the candidates. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser(req, { visitor: "create" });
  const body = await readJson(req, StartDiscovery);
  const discovery = await startDiscovery(user.id, body.name, body.purpose ?? null);
  return Response.json({ discovery }, { status: 201 });
});
