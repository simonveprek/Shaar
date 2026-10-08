import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DevFeedback } from "@/lib/schemas";
import { handle, HttpError, readJson } from "@/lib/http";
import { getConversation } from "@/lib/elevenlabs";
import { NO_INTERVIEWER, pollFeedbackResponse, spokenTurns, startFeedbackResponse } from "@/lib/feedback";
import { PersonaProfile } from "@/lib/persona";
import { CandidateBrief } from "@/lib/candidate";

/*
 * Local testing only (`next dev`): candidate feedback for a call made on /meet?agent=… with a test agent from
 * `npm run try:agent`, without Supabase or auth. Needs ELEVENLABS_API_KEY and OPENAI_API_KEY. Stateless: the client
 * polls with the returned responseId. The real app uses GET /api/interviews/:id instead.
 */

function devOnly() {
  // Unauthenticated and spends OpenAI credits, so it must never run in a deployed build.
  if (process.env.NODE_ENV === "production") throw new HttpError(404, "Not found");
}

const Fixture = z.object({ profile: PersonaProfile, candidate: CandidateBrief });

/** Start: waits (via 202) until ElevenLabs has processed the call, then starts generation. */
export const POST = handle(async (req: Request) => {
  devOnly();
  const body = await readJson(req, DevFeedback);
  const convo = await getConversation(body.conversationId);
  if (convo.status === "failed") throw new HttpError(409, "The call failed in ElevenLabs");
  if (convo.status !== "done") return Response.json({ state: "processing" }, { status: 202 });

  const transcript = spokenTurns(convo.transcript);
  if (!transcript.some((t) => t.role === "user")) return Response.json({ state: "failed", error: NO_INTERVIEWER });

  const file = path.join(process.cwd(), "fixtures", "candidates", `${body.fixture}.json`);
  const fixture = Fixture.parse(JSON.parse(await readFile(file, "utf8").catch(() => {
    throw new HttpError(404, `Fixture ${body.fixture} not found`);
  })));

  const responseId = await startFeedbackResponse({ ...fixture, difficulty: body.difficulty, feelings: body.feelings, transcript });
  return Response.json({ state: "generating", responseId }, { status: 202 });
});

/** Poll: `?responseId=…&conversationId=…` → { state: generating | ready | failed, feedback? }. */
export const GET = handle(async (req: Request) => {
  devOnly();
  const url = new URL(req.url);
  const responseId = url.searchParams.get("responseId");
  const conversationId = url.searchParams.get("conversationId");
  if (!responseId || !conversationId) throw new HttpError(400, "responseId and conversationId are required");

  const convo = await getConversation(conversationId);
  const poll = await pollFeedbackResponse(responseId, spokenTurns(convo.transcript));
  if (poll.state === "pending") return Response.json({ state: "generating", responseId });
  return Response.json(poll);
});
