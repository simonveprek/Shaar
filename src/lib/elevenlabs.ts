import { createHmac, timingSafeEqual } from "node:crypto";
import { env, need } from "./env";
import { HttpError } from "./http";
import { agentSystemPrompt, type PersonaProfile } from "./persona";

const BASE_URL = "https://api.elevenlabs.io";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "xi-api-key": need("ELEVENLABS_API_KEY", "ElevenLabs"), "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new HttpError(502, `ElevenLabs ${init.method ?? "GET"} ${path} failed (${res.status})`, body.slice(0, 1000));
  }
  return (await res.json()) as T;
}

function agentConfig(profile: PersonaProfile, voiceId: string) {
  return {
    name: `Persona: ${profile.display_name}`.slice(0, 100),
    tags: ["projstalker", "persona"],
    conversation_config: {
      agent: {
        first_message: profile.interview_first_message,
        language: "en",
        prompt: { prompt: agentSystemPrompt(profile), llm: env().ELEVENLABS_AGENT_LLM },
      },
      tts: { voice_id: voiceId, model_id: env().ELEVENLABS_TTS_MODEL },
    },
  };
}

/** Creates a private ElevenLabs agent that plays the persona. The prompt stays server-side. */
export async function createPersonaAgent(profile: PersonaProfile, voiceId: string): Promise<string> {
  const { agent_id } = await call<{ agent_id: string }>("/v1/convai/agents/create", {
    method: "POST",
    body: JSON.stringify(agentConfig(profile, voiceId)),
  });
  return agent_id;
}

export async function updatePersonaAgent(agentId: string, profile: PersonaProfile, voiceId: string): Promise<void> {
  await call(`/v1/convai/agents/${agentId}`, { method: "PATCH", body: JSON.stringify(agentConfig(profile, voiceId)) });
}

export async function deleteAgent(agentId: string): Promise<void> {
  await call(`/v1/convai/agents/${agentId}`, { method: "DELETE" });
}

/** WebRTC token for the browser SDK: `startSession({ conversationToken })`. */
export async function getConversationToken(agentId: string, participantName?: string) {
  const params = new URLSearchParams({ agent_id: agentId });
  if (participantName) params.set("participant_name", participantName);
  return call<{ token: string; conversation_id: string }>(`/v1/convai/conversation/token?${params}`);
}

/** Signed WebSocket URL for the browser SDK: `startSession({ signedUrl })`. Valid 15 minutes. */
export async function getSignedUrl(agentId: string) {
  const params = new URLSearchParams({ agent_id: agentId, include_conversation_id: "true" });
  return call<{ signed_url: string }>(`/v1/convai/conversation/get-signed-url?${params}`);
}

export type TranscriptTurn = {
  role: "user" | "agent";
  message: string | null;
  time_in_call_secs?: number;
};

export type ConversationDetails = {
  agent_id: string;
  conversation_id: string;
  status: string; // initiated | in-progress | processing | done | failed
  transcript: TranscriptTurn[];
  metadata?: { call_duration_secs?: number; start_time_unix_secs?: number };
  analysis?: Record<string, unknown> | null;
};

export async function getConversation(conversationId: string): Promise<ConversationDetails> {
  return call<ConversationDetails>(`/v1/convai/conversations/${encodeURIComponent(conversationId)}`);
}

/** Streams speech audio (mp3) for arbitrary text. */
export async function textToSpeech(text: string, voiceId: string, modelId?: string): Promise<Response> {
  const res = await fetch(
    `${BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": need("ELEVENLABS_API_KEY", "ElevenLabs"), "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: modelId ?? env().ELEVENLABS_TTS_MODEL }),
    },
  );
  if (!res.ok || !res.body) {
    throw new HttpError(502, `ElevenLabs text-to-speech failed (${res.status})`, (await res.text()).slice(0, 1000));
  }
  return res;
}

/**
 * Verifies the `ElevenLabs-Signature: t=<unix>,v0=<hex>` header:
 * HMAC-SHA256(secret, `${t}.${rawBody}`), rejecting timestamps older than 30 minutes.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!parts.v0 || !Number.isFinite(t)) return false;
  if (Math.abs(Date.now() / 1000 - t) > 30 * 60) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v0);
  return a.length === b.length && timingSafeEqual(a, b);
}
