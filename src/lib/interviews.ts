import { json, maybeOne, one } from "./db";
import { env } from "./env";
import { HttpError, notFound } from "./http";
import { createPersonaAgent, getConversation, getConversationToken, getSignedUrl, updatePersonaAgent } from "./elevenlabs";
import type { PersonaRow } from "./research";
import type { Difficulty } from "./candidate";
import { FALLBACK_VOICE, pickVoice } from "./voices";

export type InterviewRow = {
  id: string;
  persona_id: string;
  user_id: string;
  elevenlabs_conversation_id: string | null;
  status: "pending" | "active" | "done" | "failed";
  transcript: unknown[] | null;
  analysis: Record<string, unknown> | null;
  duration_secs: number | null;
  created_at: string;
  ended_at: string | null;
  difficulty: Difficulty;
  feelings: FeelingEvent[];
  feedback_status: "none" | "generating" | "ready" | "failed";
  feedback_response_id: string | null;
  feedback: import("./feedback").StoredFeedback | null;
  feedback_error: string | null;
};

/** One `reportFeeling` call from the candidate agent; `t` is seconds into the call. */
export type FeelingEvent = { t: number; feeling: string; intensity: number; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getPersona(personaId: string, userId: string): Promise<PersonaRow> {
  const persona = UUID.test(personaId)
    ? await maybeOne<PersonaRow>("select * from personas where id = $1 and user_id = $2", [personaId, userId])
    : null;
  if (!persona) throw notFound("Persona");
  return persona;
}

export async function getInterview(interviewId: string, userId: string): Promise<InterviewRow> {
  const interview = UUID.test(interviewId)
    ? await maybeOne<InterviewRow>("select * from interviews where id = $1 and user_id = $2", [interviewId, userId])
    : null;
  if (!interview) throw notFound("Interview");
  return interview;
}

const MAX_FEELINGS = 500;

/** Appends `reportFeeling` events from the browser. Batches arrive one after another from a single call. */
export async function addFeelings(interview: InterviewRow, events: FeelingEvent[]): Promise<InterviewRow> {
  if (interview.status === "failed") throw new HttpError(409, "Interview failed");
  const feelings = [...interview.feelings, ...events].sort((a, b) => a.t - b.t).slice(0, MAX_FEELINGS);
  return one<InterviewRow>("update interviews set feelings = $1::jsonb where id = $2 returning *", [json(feelings), interview.id]);
}

/**
 * Ensures the persona has an ElevenLabs agent using the requested voice and the current prompt, creating it or
 * updating it.
 */
export async function ensureAgent(persona: PersonaRow, voiceId?: string): Promise<PersonaRow> {
  if (persona.status !== "ready" || !persona.profile) throw new HttpError(409, "Persona is not ready yet");
  const voice =
    voiceId ??
    persona.voice_id ??
    // Every persona, practice candidate or real person, gets a stock voice matching its gender and age.
    pickVoice(persona.profile.voice) ??
    env().ELEVENLABS_DEFAULT_VOICE_ID ??
    FALLBACK_VOICE;

  // An existing agent is updated before every call, so a changed prompt (like speaking in the first person)
  // reaches agents made before the change. It is one quick request.
  let agentId = persona.elevenlabs_agent_id;
  if (agentId) await updatePersonaAgent(agentId, persona.profile, voice, persona.candidate);
  else agentId = await createPersonaAgent(persona.profile, voice, persona.candidate);

  return one<PersonaRow>(
    "update personas set elevenlabs_agent_id = $1, voice_id = $2, updated_at = now() where id = $3 returning *",
    [agentId, voice, persona.id],
  );
}

/** Starts an interview: returns credentials the browser passes to the ElevenLabs SDK's `startSession`. */
export async function startInterview(
  persona: PersonaRow,
  opts: { voiceId?: string; transport: "webrtc" | "websocket"; difficulty: Difficulty; participantName?: string },
) {
  const ready = await ensureAgent(persona, opts.voiceId);
  const agentId = ready.elevenlabs_agent_id!;

  let session: ({ conversationToken: string } | { signedUrl: string }) & { dynamicVariables?: Record<string, string> };
  let conversationId: string | null = null;
  if (opts.transport === "webrtc") {
    const { token, conversation_id } = await getConversationToken(agentId, opts.participantName);
    session = { conversationToken: token };
    conversationId = conversation_id;
  } else {
    const { signed_url } = await getSignedUrl(agentId);
    session = { signedUrl: signed_url };
    conversationId = new URL(signed_url).searchParams.get("conversation_id");
  }

  const interview = await one<InterviewRow>(
    `insert into interviews (persona_id, user_id, elevenlabs_conversation_id, difficulty)
     values ($1, $2, $3, $4) returning *`,
    [persona.id, persona.user_id, conversationId, opts.difficulty],
  );

  // Candidate agents read {{difficulty}} from their prompt, so every session must carry it.
  if (ready.candidate) session = { ...session, dynamicVariables: { difficulty: opts.difficulty } };

  return { interview, agentId, session };
}

/** Pulls the transcript from ElevenLabs when the post-call webhook hasn't delivered it yet. */
export async function syncInterview(interview: InterviewRow): Promise<InterviewRow> {
  if (interview.status === "done" || interview.status === "failed" || !interview.elevenlabs_conversation_id) {
    return interview;
  }
  let convo;
  try {
    convo = await getConversation(interview.elevenlabs_conversation_id);
  } catch (err) {
    // ElevenLabs 404s until the browser actually connects.
    if (err instanceof HttpError && interview.status === "pending") return interview;
    throw err;
  }
  return applyConversation(interview.id, convo);
}

export async function applyConversation(
  interviewId: string,
  convo: {
    status: string;
    transcript?: unknown[];
    analysis?: Record<string, unknown> | null;
    metadata?: { call_duration_secs?: number };
  },
): Promise<InterviewRow> {
  const status: InterviewRow["status"] =
    convo.status === "done" ? "done" : convo.status === "failed" ? "failed" : "active";
  return one<InterviewRow>(
    `update interviews set status = $1, transcript = $2::jsonb, analysis = $3::jsonb, duration_secs = $4, ended_at = $5
     where id = $6 returning *`,
    [
      status,
      json(convo.transcript ?? null),
      json(convo.analysis ?? null),
      convo.metadata?.call_duration_secs ?? null,
      status === "done" || status === "failed" ? new Date().toISOString() : null,
      interviewId,
    ],
  );
}
