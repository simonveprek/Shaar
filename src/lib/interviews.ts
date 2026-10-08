import { db } from "./supabase";
import { need } from "./env";
import { HttpError, maybe, must, notFound } from "./http";
import { createPersonaAgent, getConversation, getConversationToken, getSignedUrl, updatePersonaAgent } from "./elevenlabs";
import type { PersonaRow } from "./research";

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
};

export async function getPersona(personaId: string, userId: string): Promise<PersonaRow> {
  const persona = maybe(
    await db().from("personas").select().eq("id", personaId).eq("user_id", userId).maybeSingle<PersonaRow>(),
  );
  if (!persona) throw notFound("Persona");
  return persona;
}

/** Ensures the persona has an ElevenLabs agent using the requested voice, creating or updating it as needed. */
export async function ensureAgent(persona: PersonaRow, voiceId?: string): Promise<PersonaRow> {
  if (persona.status !== "ready" || !persona.profile) throw new HttpError(409, "Persona is not ready yet");
  const voice = voiceId ?? persona.voice_id ?? need("ELEVENLABS_DEFAULT_VOICE_ID", "A default voice");

  if (persona.elevenlabs_agent_id && persona.voice_id === voice) return persona;

  let agentId = persona.elevenlabs_agent_id;
  if (agentId) await updatePersonaAgent(agentId, persona.profile, voice);
  else agentId = await createPersonaAgent(persona.profile, voice);

  return must(
    await db()
      .from("personas")
      .update({ elevenlabs_agent_id: agentId, voice_id: voice })
      .eq("id", persona.id)
      .select()
      .single<PersonaRow>(),
  );
}

/** Starts an interview: returns credentials the browser passes to the ElevenLabs SDK's `startSession`. */
export async function startInterview(
  persona: PersonaRow,
  opts: { voiceId?: string; transport: "webrtc" | "websocket"; participantName?: string },
) {
  const ready = await ensureAgent(persona, opts.voiceId);
  const agentId = ready.elevenlabs_agent_id!;

  let session: { conversationToken: string } | { signedUrl: string };
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

  const interview = must(
    await db()
      .from("interviews")
      .insert({ persona_id: persona.id, user_id: persona.user_id, elevenlabs_conversation_id: conversationId })
      .select()
      .single<InterviewRow>(),
  );

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
  return must(
    await db()
      .from("interviews")
      .update({
        status,
        transcript: convo.transcript ?? null,
        analysis: convo.analysis ?? null,
        duration_secs: convo.metadata?.call_duration_secs ?? null,
        ended_at: status === "done" || status === "failed" ? new Date().toISOString() : null,
      })
      .eq("id", interviewId)
      .select()
      .single<InterviewRow>(),
  );
}
