import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { StartInterview } from "@/lib/schemas";
import { handle, readJson } from "@/lib/http";
import { getPersona, startInterview } from "@/lib/interviews";

/**
 * Start a simulated voice interview with the persona. Pass `session` to the ElevenLabs React SDK:
 *   startSession({ conversationToken })  // webrtc (default)
 *   startSession({ signedUrl })          // websocket
 */
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/personas/[id]/interviews">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await readJson(req, StartInterview);
  const persona = await getPersona(id, user.id);
  const result = await startInterview(persona, body);
  return Response.json(result, { status: 201 });
});

/** Past interviews with this persona. */
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/personas/[id]/interviews">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await getPersona(id, user.id);
  const interviews = await sql(
    `select id, status, duration_secs, created_at, ended_at, elevenlabs_conversation_id
     from interviews where persona_id = $1 order by created_at desc`,
    [id],
  );
  return Response.json({ interviews });
});
